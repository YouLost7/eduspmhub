import { randomUUID } from "node:crypto";
import {
  priceToCents,
  hasPurchaseEntitlement,
  insertPaymentEventIfNew,
  upsertPaymentRecord,
  upsertPaymentBySessionId,
  getPaymentBySessionId,
  getPaymentByIntentId,
  insertPurchaseItemIfMissing,
  listUserTransactions,
  getUserTransactionById,
} from "../payments/store.js";
import {
  createStripeClient,
  verifyStripeWebhookEvent,
  fetchStripeReceiptUrl,
} from "../payments/stripe.js";
import { buildReceiptPdfBuffer } from "../payments/receiptPdf.js";
import { grantPaidTutoringFromSession } from "./tutoringRoutes.js";
import { isTutoringPaymentCourseId } from "../tutoring/store.js";
import { isMarketplacePaymentCourseId } from "../marketplace/store.js";
import { grantPaidMarketplaceFromSession } from "./marketplaceRoutes.js";

function formatMoneyLabel(cents, currency = "myr") {
  const value = (Number(cents) || 0) / 100;
  const cc = String(currency || "myr").toUpperCase();
  if (cc === "MYR") return `RM${value.toFixed(2)}`;
  return `${cc} ${value.toFixed(2)}`;
}

function toTransactionDto(row) {
  return {
    id: row.id,
    status: row.status,
    amountCents: Number(row.amount_cents || 0),
    amountLabel: formatMoneyLabel(row.amount_cents, row.currency),
    currency: String(row.currency || "myr").toLowerCase(),
    courseId: row.course_id,
    courseTitle: row.course_title,
    productType: isMarketplacePaymentCourseId(row.course_id)
      ? "marketplace"
      : isTutoringPaymentCourseId(row.course_id)
        ? "tutoring"
        : "course",
    receiptUrl: row.receipt_url || "",
    paymentMethodType: row.payment_method_type || "",
    provider: row.provider || "stripe",
    providerSessionId: row.provider_session_id || "",
    providerPaymentIntentId: row.provider_payment_intent_id || "",
    paidAt: row.paid_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatDateLabel(isoLike) {
  if (!isoLike) return "n/a";
  const d = new Date(String(isoLike));
  if (Number.isNaN(d.getTime())) return "n/a";
  return d.toLocaleString();
}

function formatStatusLabel(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function safeReceiptFileName(paymentId) {
  const id = String(paymentId || "receipt")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return id || "receipt";
}

function buildCourseSnapshot(course) {
  const amountCents = priceToCents(course?.price);
  return {
    id: String(course?.id || ""),
    title: String(course?.title || "Course"),
    amountCents,
    currency: "myr",
  };
}

export function registerPaymentRoutes(app, deps) {
  const {
    requireAuth,
    loadUsers,
    findUserById,
    loadEnrollments,
    saveEnrollments,
    loadEducatorCourses,
    CATALOG,
    APP_BASE_URL,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    isProd,
    allowMockPayments = !isProd,
  } = deps;
  if ((!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) && isProd) {
    throw new Error(
      "Missing Stripe configuration: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required."
    );
  }
  const stripe = STRIPE_SECRET_KEY ? createStripeClient(STRIPE_SECRET_KEY) : null;
  const STRIPE_MIN_AMOUNT_CENTS_MYR = 200;

  async function completeMockPurchase({
    userId,
    courseId,
    courseTitle,
    amountCents,
    currency,
    reason,
  }) {
    const now = new Date().toISOString();
    const paymentId = randomUUID();
    await upsertPaymentRecord({
      id: paymentId,
      provider: "mock",
      userId,
      courseId,
      courseTitle,
      amountCents,
      currency,
      status: "paid",
      paymentMethodType: "mock",
      receiptUrl: `${APP_BASE_URL}/transactions`,
      rawPayload: { mode: "mock", reason },
      paidAt: now,
    });
    await insertPurchaseItemIfMissing({
      id: randomUUID(),
      paymentId,
      userId,
      courseId,
      courseTitle,
      amountCents,
      currency,
      paidAt: now,
    });
    const enroll = await loadEnrollments();
    const list = enroll[userId] || [];
    if (!list.includes(courseId)) {
      list.push(courseId);
      enroll[userId] = list;
      await saveEnrollments(enroll);
    }
    return {
      checkoutUrl: `${APP_BASE_URL}/my-courses?payment=success&mock=1`,
      sessionId: `mock_${paymentId}`,
      paymentId,
      mock: true,
    };
  }

  async function resolveCourseForCheckout(courseId) {
    const cid = typeof courseId === "string" ? courseId.trim() : String(courseId || "");
    if (!cid) return null;
    const built = CATALOG.find((c) => c.id === cid);
    if (built) return built;
    const list = await loadEducatorCourses();
    const c = list.find((x) => x.id === cid && x.status === "published");
    return c || null;
  }

  async function grantPaidCourseAccessFromSession(session, providerEventId = null) {
    const userId = String(session?.metadata?.userId || session?.client_reference_id || "").trim();
    const courseId = String(session?.metadata?.courseId || "").trim();
    const sessionId = String(session?.id || "").trim();
    const paymentIntentId =
      typeof session?.payment_intent === "string" ? session.payment_intent : "";
    if (!userId || !courseId || !sessionId) {
      throw new Error("Missing checkout metadata");
    }

    const existing = await getPaymentBySessionId("stripe", sessionId);
    const amountCents = Number(session?.amount_total ?? existing?.amount_cents ?? 0);
    const currency = String(session?.currency || existing?.currency || "myr").toLowerCase();
    const courseTitle = String(existing?.course_title || "Course");
    const paidAt = new Date().toISOString();
    const receiptUrl = await fetchStripeReceiptUrl(stripe, paymentIntentId);
    const paymentId = existing?.id || randomUUID();

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

    await insertPurchaseItemIfMissing({
      id: randomUUID(),
      paymentId,
      userId,
      courseId,
      courseTitle,
      amountCents,
      currency,
      paidAt,
    });

    const enroll = await loadEnrollments();
    const list = enroll[userId] || [];
    if (!list.includes(courseId)) {
      list.push(courseId);
      enroll[userId] = list;
      await saveEnrollments(enroll);
    }
    return { userId, courseId, paymentId };
  }

  async function ensureStripeReceiptUrl(row) {
    if (!row || row.provider !== "stripe" || !stripe) return row;
    if (row.receipt_url) return row;
    let paymentIntentId = String(row.provider_payment_intent_id || "").trim();
    try {
      if (!paymentIntentId && row.provider_session_id) {
        const session = await stripe.checkout.sessions.retrieve(String(row.provider_session_id));
        if (typeof session?.payment_intent === "string") {
          paymentIntentId = session.payment_intent;
        }
      }
      if (!paymentIntentId) return row;
      const receiptUrl = await fetchStripeReceiptUrl(stripe, paymentIntentId);
      if (!receiptUrl) return row;
      await upsertPaymentBySessionId({
        provider: "stripe",
        providerSessionId: row.provider_session_id,
        providerPaymentIntentId: paymentIntentId,
        status: row.status || "paid",
        receiptUrl,
      });
      return {
        ...row,
        provider_payment_intent_id: paymentIntentId,
        receipt_url: receiptUrl,
      };
    } catch {
      return row;
    }
  }

  app.post("/api/payments/checkout", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const users = await loadUsers();
      const u = findUserById(users, userId);
      if (!u || u.role !== "student") {
        return res.status(403).json({ error: "Only students can purchase courses" });
      }
      const courseId = String(req.body?.courseId || "").trim();
      if (!courseId) return res.status(400).json({ error: "courseId required" });
      const course = await resolveCourseForCheckout(courseId);
      if (!course) return res.status(404).json({ error: "Course not found" });
      const snap = buildCourseSnapshot(course);
      if (snap.amountCents <= 0) {
        return res.status(400).json({ error: "This course is free. Use normal enrolment." });
      }
      if (await hasPurchaseEntitlement(userId, courseId)) {
        return res.status(409).json({ error: "You already purchased this course." });
      }
      const enroll = await loadEnrollments();
      if ((enroll[userId] || []).includes(courseId)) {
        return res.status(409).json({ error: "You already have access to this course." });
      }
      if (snap.currency === "myr" && snap.amountCents < STRIPE_MIN_AMOUNT_CENTS_MYR) {
        if (allowMockPayments) {
          const mock = await completeMockPurchase({
            userId,
            courseId: snap.id,
            courseTitle: snap.title,
            amountCents: snap.amountCents,
            currency: snap.currency,
            reason: "amount_below_stripe_minimum",
          });
          return res.json(mock);
        }
        return res.status(400).json({
          error:
            "Stripe minimum for MYR is RM2.00. Set this course to free (RM0.00) or raise the price.",
          code: "AMOUNT_TOO_SMALL",
        });
      }
      if (!stripe) {
        if (!allowMockPayments) {
          return res.status(503).json({
            error:
              "Payments are not configured yet. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
          });
        }
        return res.json(
          await completeMockPurchase({
            userId,
            courseId: snap.id,
            courseTitle: snap.title,
            amountCents: snap.amountCents,
            currency: snap.currency,
            reason: "stripe_not_configured",
          })
        );
      }
      const successUrl = `${APP_BASE_URL}/my-courses?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${APP_BASE_URL}/browse?course=${encodeURIComponent(courseId)}&payment=cancelled`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: String(userId),
        metadata: {
          userId: String(userId),
          courseId: String(courseId),
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: snap.currency,
              unit_amount: snap.amountCents,
              product_data: {
                name: snap.title,
                description: `EduSPM Hub course purchase`,
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
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not start checkout" });
    }
  });

  app.post("/api/payments/webhook", async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Stripe is not configured" });
      }
      const sig = req.get("stripe-signature");
      if (!sig) return res.status(400).json({ error: "Missing Stripe signature" });
      const rawBody = req.rawBody;
      if (!rawBody) return res.status(400).json({ error: "Missing raw webhook payload" });
      const event = verifyStripeWebhookEvent(stripe, rawBody, sig, STRIPE_WEBHOOK_SECRET);
      const isNew = await insertPaymentEventIfNew("stripe", event.id);
      if (!isNew) {
        return res.json({ received: true, duplicate: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const productType = String(session?.metadata?.productType || "");
        if (productType === "tutoring") {
          await grantPaidTutoringFromSession(session, {
            stripe,
            providerEventId: event.id,
            loadUsers,
            findUserById,
            APP_BASE_URL,
          });
        } else if (productType === "marketplace") {
          await grantPaidMarketplaceFromSession(session, {
            stripe,
            providerEventId: event.id,
            loadUsers,
            findUserById,
          });
        } else {
          await grantPaidCourseAccessFromSession(session, event.id);
        }
      } else if (event.type === "payment_intent.payment_failed") {
        const pi = event.data.object;
        const intentId = String(pi?.id || "");
        const payment = await getPaymentByIntentId("stripe", intentId);
        if (payment) {
          await upsertPaymentBySessionId({
            provider: "stripe",
            providerSessionId: payment.provider_session_id,
            providerPaymentIntentId: intentId,
            providerEventId: event.id,
            status: "failed",
            rawPayload: pi,
          });
        }
      } else if (event.type === "charge.refunded") {
        const ch = event.data.object;
        const intentId = String(ch?.payment_intent || "");
        const payment = await getPaymentByIntentId("stripe", intentId);
        if (payment) {
          await upsertPaymentBySessionId({
            provider: "stripe",
            providerSessionId: payment.provider_session_id,
            providerPaymentIntentId: intentId,
            providerEventId: event.id,
            status: "refunded",
            receiptUrl: String(ch?.receipt_url || payment.receipt_url || ""),
            rawPayload: ch,
          });
        }
      }

      res.json({ received: true });
    } catch (e) {
      console.error("Stripe webhook error", e);
      res.status(400).json({ error: "Invalid webhook" });
    }
  });

  app.get("/api/payments/transactions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const rows = await listUserTransactions(userId);
      res.json({ transactions: rows.map(toTransactionDto) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load transactions" });
    }
  });

  app.post("/api/payments/confirm-session", requireAuth, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({ error: "Stripe is not configured" });
      }
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u) {
        return res.status(401).json({ error: "Not signed in" });
      }
      const sessionId = String(req.body?.sessionId || "").trim();
      if (!sessionId) return res.status(400).json({ error: "sessionId required" });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const ownerId = String(
        session?.metadata?.userId || session?.client_reference_id || ""
      ).trim();
      if (!ownerId || ownerId !== String(req.session.userId)) {
        return res.status(403).json({ error: "This checkout session is not yours." });
      }
      if (session.payment_status !== "paid") {
        return res.status(409).json({ error: "Payment is not completed yet." });
      }
      const productType = String(session?.metadata?.productType || "");
      if (productType === "tutoring") {
        await grantPaidTutoringFromSession(session, {
          stripe,
          providerEventId: null,
          loadUsers,
          findUserById,
          APP_BASE_URL,
        });
      } else if (productType === "marketplace") {
        await grantPaidMarketplaceFromSession(session, {
          stripe,
          providerEventId: null,
          loadUsers,
          findUserById,
        });
      } else {
        await grantPaidCourseAccessFromSession(session, null);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not confirm payment session" });
    }
  });

  app.get("/api/payments/receipt/:id", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const row = await getUserTransactionById(userId, req.params.id);
      if (!row) return res.status(404).json({ error: "Receipt not found" });
      const enriched = await ensureStripeReceiptUrl(row);
      res.json({ receipt: toTransactionDto(enriched) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load receipt" });
    }
  });

  app.get("/api/payments/receipt/:id/pdf", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const row = await getUserTransactionById(userId, req.params.id);
      if (!row) return res.status(404).json({ error: "Receipt not found" });
      const enriched = await ensureStripeReceiptUrl(row);
      const dto = toTransactionDto(enriched);

      const bodyLines = [
        `Receipt ID: ${dto.id}`,
        `Status: ${formatStatusLabel(dto.status)}`,
        `Course: ${dto.courseTitle || "Course purchase"}`,
        `Course ID: ${dto.courseId || "n/a"}`,
        `Amount: ${dto.amountLabel}`,
        `Currency: ${String(dto.currency || "myr").toUpperCase()}`,
        `Provider: ${String(dto.provider || "stripe").toUpperCase()}`,
        `Payment method: ${dto.paymentMethodType || "n/a"}`,
        `Paid at: ${formatDateLabel(dto.paidAt)}`,
        `Recorded at: ${formatDateLabel(dto.createdAt)}`,
        `Provider session ID: ${dto.providerSessionId || "n/a"}`,
        `Provider intent ID: ${dto.providerPaymentIntentId || "n/a"}`,
      ];
      if (dto.receiptUrl) {
        bodyLines.push(`Stripe receipt URL: ${dto.receiptUrl}`);
      }
      bodyLines.push(`Generated at: ${new Date().toLocaleString()}`);

      const pdf = buildReceiptPdfBuffer({
        title: "EduSPM Hub Payment Receipt",
        bodyLines,
      });
      const fileName = safeReceiptFileName(dto.id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="receipt-${fileName}.pdf"`
      );
      res.status(200).send(pdf);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not build receipt PDF" });
    }
  });
}
