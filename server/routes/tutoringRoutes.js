import { randomUUID } from "node:crypto";
import {
  getBookingById,
  insertBooking,
  updateBookingStatus,
  listBookingsForStudent,
  listBookingsForTutor,
  getReviewForBooking,
  insertReview,
  getTutorReviewStats,
  normalizeHours,
  normalizeHourlyRateCents,
  formatMoneyLabel,
  tutoringPaymentCourseId,
} from "../tutoring/store.js";
import {
  upsertPaymentRecord,
  getPaymentBySessionId,
} from "../payments/store.js";
import { createStripeClient, fetchStripeReceiptUrl } from "../payments/stripe.js";
import {
  listAvailabilityForTutor,
  replaceAvailabilityForTutor,
  validateBookingAgainstAvailability,
  listBookableSlots,
} from "../tutoring/availability.js";
import { notifyTutoringEvent } from "../tutoring/notifications.js";
import { refundTutoringBooking } from "../tutoring/refunds.js";
import { creditTutoringSession } from "../marketplace/balance.js";

function parseScheduledStart(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= Date.now() + 30 * 60 * 1000) return null;
  return d.toISOString();
}

function addHoursIso(isoStart, hours) {
  const d = new Date(isoStart);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

function enrichBooking(booking, users, findUserById) {
  const student = findUserById(users, booking.studentId);
  const tutor = findUserById(users, booking.tutorId);
  return {
    ...booking,
    amountLabel: formatMoneyLabel(booking.amountCents, booking.currency),
    hourlyRateLabel: formatMoneyLabel(booking.hourlyRateCents, booking.currency),
    studentName: student?.fullName || "Student",
    tutorName: tutor?.fullName || "Tutor",
    tutorSubject: tutor?.educatorSubject || "",
  };
}

function notifyDeps(deps) {
  return {
    loadUsers: deps.loadUsers,
    findUserById: deps.findUserById,
    APP_BASE_URL: deps.APP_BASE_URL,
  };
}

export async function grantPaidTutoringFromSession(session, deps) {
  const { stripe, providerEventId = null } = deps;
  const m = session?.metadata || {};
  const bookingId = String(m.bookingId || "").trim();
  const userId = String(m.userId || session?.client_reference_id || "").trim();
  const tutorId = String(m.tutorId || "").trim();
  const sessionId = String(session?.id || "").trim();
  const paymentIntentId =
    typeof session?.payment_intent === "string" ? session.payment_intent : "";
  if (!bookingId || !userId || !tutorId || !sessionId) {
    throw new Error("Missing tutoring checkout metadata");
  }

  const existing = await getPaymentBySessionId("stripe", sessionId);
  const amountCents = Number(session?.amount_total ?? existing?.amount_cents ?? m.amountCents ?? 0);
  const currency = String(session?.currency || existing?.currency || "myr").toLowerCase();
  const paidAt = new Date().toISOString();
  let receiptUrl = null;
  if (stripe && paymentIntentId) {
    receiptUrl = await fetchStripeReceiptUrl(stripe, paymentIntentId);
  }
  const paymentId = existing?.id || randomUUID();
  const courseId = tutoringPaymentCourseId(bookingId);
  const hours = Number(m.hours);
  const courseTitle = `1-on-1 tutoring (${hours}h)`;

  await upsertPaymentRecord({
    id: paymentId,
    provider: "stripe",
    providerSessionId: sessionId,
    providerPaymentIntentId: paymentIntentId || null,
    providerEventId,
    userId,
    courseId,
    courseTitle,
    amountCents,
    currency,
    status: "paid",
    receiptUrl: receiptUrl || null,
    paymentMethodType: "card",
    rawPayload: session,
    paidAt,
  });

  let booking = await getBookingById(bookingId);
  if (!booking) {
    const scheduledStart = String(m.scheduledStart || "");
    const scheduledEnd = String(m.scheduledEnd || "");
    const slotCheck = await validateBookingAgainstAvailability(
      tutorId,
      scheduledStart,
      scheduledEnd
    );
    if (!slotCheck.ok) {
      throw new Error(slotCheck.error || "Session slot no longer available");
    }
    booking = await insertBooking({
      id: bookingId,
      studentId: userId,
      tutorId,
      status: "paid",
      scheduledStart,
      scheduledEnd,
      hours,
      hourlyRateCents: Number(m.hourlyRateCents) || 0,
      amountCents,
      studentMessage: String(m.studentMessage || ""),
      paymentId,
    });
    notifyTutoringEvent({
      type: "paid",
      bookingId,
      ...notifyDeps(deps),
    }).catch((e) => console.error("[notify paid]", e));
  } else {
    if (booking.studentId !== userId) {
      throw new Error("Booking does not belong to this student");
    }
    if (booking.status === "awaiting_payment") {
      await updateBookingStatus(bookingId, "paid", { paymentId });
      notifyTutoringEvent({
        type: "paid",
        bookingId,
        ...notifyDeps(deps),
      }).catch((e) => console.error("[notify paid]", e));
    } else if (booking.status === "paid" && !booking.paymentId) {
      await updateBookingStatus(bookingId, "paid", { paymentId });
    }
  }
  return { bookingId, paymentId, userId };
}

async function resolveTutoringCheckoutRequest(req, { loadUsers, findUserById }) {
  const users = await loadUsers();
  const student = findUserById(users, req.session.userId);
  if (!student || student.role !== "student") {
    return { error: { status: 403, message: "Only students can book 1-on-1 sessions" } };
  }

  const tutorId = String(req.body?.tutorId || "").trim();
  const tutor = findUserById(users, tutorId);
  if (!tutor || tutor.role !== "educator") {
    return { error: { status: 404, message: "Tutor not found" } };
  }
  if (!tutor.verified) {
    return {
      error: {
        status: 403,
        message: "This tutor is not verified yet and cannot accept paid bookings.",
      },
    };
  }
  if (!tutor.offersOneToOne) {
    return { error: { status: 400, message: "This tutor is not offering 1-on-1 sessions." } };
  }

  const hourlyRateCents = normalizeHourlyRateCents(tutor.hourlyRateCents);
  if (hourlyRateCents < 200) {
    return {
      error: {
        status: 400,
        message: "This tutor has not set a valid hourly rate (minimum RM2.00/hour).",
      },
    };
  }

  const hours = normalizeHours(req.body?.hours);
  if (!hours) {
    return { error: { status: 400, message: "Hours must be between 0.5 and 8." } };
  }

  const scheduledStart = parseScheduledStart(req.body?.scheduledStart);
  if (!scheduledStart) {
    return {
      error: {
        status: 400,
        message: "Choose a session start time at least 30 minutes from now.",
      },
    };
  }

  const scheduledEnd = addHoursIso(scheduledStart, hours);
  const slotCheck = await validateBookingAgainstAvailability(
    tutor.id,
    scheduledStart,
    scheduledEnd
  );
  if (!slotCheck.ok) {
    return { error: { status: 400, message: slotCheck.error } };
  }

  const amountCents = Math.round(hourlyRateCents * hours);
  if (amountCents < 200) {
    return {
      error: {
        status: 400,
        message: "Total session cost must be at least RM2.00 for card payment.",
      },
    };
  }

  return {
    student,
    tutor,
    tutorName: tutor.fullName || "Tutor",
    bookingId: randomUUID(),
    hours,
    scheduledStart,
    scheduledEnd,
    hourlyRateCents,
    amountCents,
    studentMessage: String(req.body?.message || "").trim(),
  };
}

export function registerTutoringRoutes(app, deps) {
  const {
    requireAuth,
    loadUsers,
    findUserById,
    toPublicTutorProfile,
    APP_BASE_URL,
    STRIPE_SECRET_KEY,
    isProd,
    allowMockPayments = !isProd,
  } = deps;

  const stripe = STRIPE_SECRET_KEY ? createStripeClient(STRIPE_SECRET_KEY) : null;
  const STRIPE_MIN_AMOUNT_CENTS_MYR = 200;

  app.get("/api/tutoring/bookings", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u) return res.status(401).json({ error: "Not signed in" });

      const list =
        u.role === "educator"
          ? await listBookingsForTutor(u.id)
          : u.role === "student"
            ? await listBookingsForStudent(u.id)
            : [];

      const bookings = await Promise.all(
        list.map(async (b) => {
          const enriched = enrichBooking(b, users, findUserById);
          const review =
            u.role === "student" && b.status === "completed"
              ? await getReviewForBooking(b.id)
              : null;
          return { ...enriched, myReview: review };
        })
      );
      res.json({ bookings });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load bookings" });
    }
  });

  /** Pay-first: no unpaid booking row until Stripe succeeds. */
  app.post("/api/tutoring/checkout", requireAuth, async (req, res) => {
    try {
      const resolved = await resolveTutoringCheckoutRequest(req, {
        loadUsers,
        findUserById,
      });
      if (resolved.error) {
        return res.status(resolved.error.status).json({ error: resolved.error.message });
      }

      const {
        student,
        tutor,
        tutorName,
        bookingId,
        hours,
        scheduledStart,
        scheduledEnd,
        hourlyRateCents,
        amountCents,
        studentMessage,
      } = resolved;

      if (!stripe) {
        if (!allowMockPayments) {
          return res.status(503).json({
            error: "Payments are not configured. Set STRIPE_SECRET_KEY.",
          });
        }
        const paymentId = randomUUID();
        const now = new Date().toISOString();
        await insertBooking({
          id: bookingId,
          studentId: student.id,
          tutorId: tutor.id,
          status: "paid",
          scheduledStart,
          scheduledEnd,
          hours,
          hourlyRateCents,
          amountCents,
          studentMessage,
          paymentId,
        });
        await upsertPaymentRecord({
          id: paymentId,
          provider: "mock",
          userId: student.id,
          courseId: tutoringPaymentCourseId(bookingId),
          courseTitle: `1-on-1 with ${tutorName}`,
          amountCents,
          currency: "myr",
          status: "paid",
          paymentMethodType: "mock",
          paidAt: now,
        });
        notifyTutoringEvent({
          type: "paid",
          bookingId,
          ...notifyDeps(deps),
        }).catch((e) => console.error("[notify paid mock]", e));
        return res.json({
          checkoutUrl: `${APP_BASE_URL}/bookings?payment=success&booking=${encodeURIComponent(bookingId)}&mock=1`,
          sessionId: `mock_${paymentId}`,
          bookingId,
          mock: true,
        });
      }

      const successUrl = `${APP_BASE_URL}/bookings?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${APP_BASE_URL}/tutor/${encodeURIComponent(tutor.id)}?booking=cancelled`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: String(student.id),
        metadata: {
          productType: "tutoring",
          userId: String(student.id),
          bookingId: String(bookingId),
          tutorId: String(tutor.id),
          scheduledStart,
          scheduledEnd,
          hours: String(hours),
          hourlyRateCents: String(hourlyRateCents),
          amountCents: String(amountCents),
          studentMessage,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "myr",
              unit_amount: amountCents,
              product_data: {
                name: `1-on-1 tutoring with ${tutorName}`,
                description: `${hours} hour(s) · ${new Date(scheduledStart).toLocaleString()}`,
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      res.json({
        checkoutUrl: session.url,
        sessionId: session.id,
        bookingId,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not start checkout" });
    }
  });

  app.patch("/api/tutoring/bookings/:id/accept", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const tutor = findUserById(users, req.session.userId);
      if (!tutor || tutor.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      const booking = await getBookingById(req.params.id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.tutorId !== tutor.id) {
        return res.status(403).json({ error: "Not your booking" });
      }
      if (booking.status !== "paid") {
        return res.status(409).json({ error: "Only paid bookings can be accepted." });
      }
      const updated = await updateBookingStatus(booking.id, "accepted");
      notifyTutoringEvent({
        type: "accepted",
        bookingId: booking.id,
        ...notifyDeps(deps),
      }).catch((e) => console.error("[notify accepted]", e));
      res.json({ booking: enrichBooking(updated, users, findUserById) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not accept booking" });
    }
  });

  app.patch("/api/tutoring/bookings/:id/decline", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const tutor = findUserById(users, req.session.userId);
      if (!tutor || tutor.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      const booking = await getBookingById(req.params.id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.tutorId !== tutor.id) {
        return res.status(403).json({ error: "Not your booking" });
      }
      if (!["paid", "accepted"].includes(booking.status)) {
        return res.status(409).json({ error: "This booking cannot be declined." });
      }
      const refund = await refundTutoringBooking(booking, stripe, {
        allowMock: allowMockPayments,
      });
      const updated = await updateBookingStatus(booking.id, "declined");
      notifyTutoringEvent({
        type: "declined_refunded",
        bookingId: booking.id,
        ...notifyDeps(deps),
      }).catch((e) => console.error("[notify declined]", e));
      res.json({
        booking: enrichBooking(updated, users, findUserById),
        refund,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not decline booking" });
    }
  });

  app.patch("/api/tutoring/bookings/:id/complete", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const tutor = findUserById(users, req.session.userId);
      if (!tutor || tutor.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      const booking = await getBookingById(req.params.id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.tutorId !== tutor.id) {
        return res.status(403).json({ error: "Not your booking" });
      }
      if (booking.status !== "accepted") {
        return res.status(409).json({ error: "Only accepted sessions can be marked complete." });
      }
      const updated = await updateBookingStatus(booking.id, "completed");
      await creditTutoringSession({
        tutorId: booking.tutorId,
        bookingId: booking.id,
        grossCents: booking.amountCents,
        hours: booking.hours,
      });
      notifyTutoringEvent({
        type: "completed",
        bookingId: booking.id,
        ...notifyDeps(deps),
      }).catch((e) => console.error("[notify completed]", e));
      res.json({ booking: enrichBooking(updated, users, findUserById) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not complete booking" });
    }
  });

  app.get("/api/tutoring/availability", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u || u.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      const slots = await listAvailabilityForTutor(u.id);
      res.json({ slots });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load availability" });
    }
  });

  app.put("/api/tutoring/availability", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u || u.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      if (!u.verified) {
        return res.status(403).json({
          error: "Set availability after your educator account is verified.",
        });
      }
      const slots = await replaceAvailabilityForTutor(
        u.id,
        Array.isArray(req.body?.slots) ? req.body.slots : []
      );
      res.json({ slots });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not save availability" });
    }
  });

  app.get("/api/tutoring/tutors/:tutorId/availability", requireAuth, async (req, res) => {
    try {
      const tutorId =
        typeof req.params.tutorId === "string"
          ? req.params.tutorId.trim()
          : req.params.tutorId;
      const users = await loadUsers();
      const tutor = findUserById(users, tutorId);
      if (!tutor || tutor.role !== "educator") {
        return res.status(404).json({ error: "Tutor not found" });
      }
      const slots = await listAvailabilityForTutor(tutor.id);
      res.json({ slots });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load availability" });
    }
  });

  app.get("/api/tutoring/tutors/:tutorId/slots", requireAuth, async (req, res) => {
    try {
      const tutorId =
        typeof req.params.tutorId === "string"
          ? req.params.tutorId.trim()
          : req.params.tutorId;
      const users = await loadUsers();
      const tutor = findUserById(users, tutorId);
      if (!tutor || tutor.role !== "educator") {
        return res.status(404).json({ error: "Tutor not found" });
      }
      if (!tutor.verified || !tutor.offersOneToOne) {
        return res.json({ slots: [] });
      }
      const hours = normalizeHours(req.query.hours) || 1;
      const daysAhead = Number.parseInt(String(req.query.days || "21"), 10);
      const slots = await listBookableSlots(tutor.id, hours, daysAhead);
      const hourlyRateCents = normalizeHourlyRateCents(tutor.hourlyRateCents);
      res.json({
        slots,
        hours,
        estimatedTotalCents: Math.round(hourlyRateCents * hours),
        estimatedTotalLabel: formatMoneyLabel(Math.round(hourlyRateCents * hours)),
        hourlyRateLabel: formatMoneyLabel(hourlyRateCents) + "/hr",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load bookable slots" });
    }
  });

  app.post("/api/tutoring/bookings/:id/review", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const student = findUserById(users, req.session.userId);
      if (!student || student.role !== "student") {
        return res.status(403).json({ error: "Only students can leave reviews" });
      }
      const booking = await getBookingById(req.params.id);
      if (!booking) return res.status(404).json({ error: "Booking not found" });
      if (booking.studentId !== student.id) {
        return res.status(403).json({ error: "Not your booking" });
      }
      if (booking.status !== "completed") {
        return res.status(409).json({
          error: "You can review a tutor only after the session is marked complete.",
        });
      }
      const existing = await getReviewForBooking(booking.id);
      if (existing) {
        return res.status(409).json({ error: "You already reviewed this session." });
      }

      const rating = Number.parseInt(String(req.body?.rating ?? ""), 10);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5." });
      }
      const comment = String(req.body?.comment || "").trim();
      const review = await insertReview({
        bookingId: booking.id,
        studentId: student.id,
        tutorId: booking.tutorId,
        rating,
        comment,
      });
      res.status(201).json({ review });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not save review" });
    }
  });

  app.get("/api/tutoring/tutors", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const tutors = users.filter(
        (u) =>
          u.role === "educator" &&
          u.verified &&
          u.offersOneToOne &&
          normalizeHourlyRateCents(u.hourlyRateCents) >= STRIPE_MIN_AMOUNT_CENTS_MYR
      );
      const out = [];
      for (const u of tutors) {
        const slots = await listAvailabilityForTutor(u.id);
        if (slots.length === 0) continue;
        const profile = toPublicTutorProfile(u);
        if (!profile) continue;
        const stats = await getTutorReviewStats(u.id);
        out.push({
          ...profile,
          ...stats,
          hourlyRateCents: normalizeHourlyRateCents(u.hourlyRateCents),
          hourlyRateLabel: formatMoneyLabel(u.hourlyRateCents, "myr") + "/hr",
        });
      }
      out.sort((a, b) => {
        if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
        return a.fullName.localeCompare(b.fullName);
      });
      res.json({ tutors: out });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load tutors" });
    }
  });
}
