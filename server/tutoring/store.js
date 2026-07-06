import { randomUUID } from "node:crypto";
import { getDb, sqlite } from "../sqlite.js";

const BOOKING_STATUSES = new Set([
  "awaiting_payment",
  "paid",
  "accepted",
  "completed",
  "declined",
  "cancelled",
]);

export function formatMoneyLabel(cents, currency = "myr") {
  const value = (Number(cents) || 0) / 100;
  const cc = String(currency || "myr").toUpperCase();
  if (cc === "MYR") return `RM${value.toFixed(2)}`;
  return `${cc} ${value.toFixed(2)}`;
}

export function normalizeHours(raw) {
  const n = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n < 0.5 || n > 8) return null;
  const rounded = Math.round(n * 2) / 2;
  return rounded;
}

export function normalizeHourlyRateCents(raw) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 200) return 0;
  return n;
}

function rowToBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    tutorId: row.tutor_id,
    status: row.status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    hours: Number(row.hours),
    hourlyRateCents: Number(row.hourly_rate_cents),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency || "myr").toLowerCase(),
    studentMessage: row.student_message || "",
    paymentId: row.payment_id || null,
    tutorNotifiedPaidAt: row.tutor_notified_paid_at || null,
    studentNotifiedAcceptedAt: row.student_notified_accepted_at || null,
    studentNotifiedCompleteAt: row.student_notified_complete_at || null,
    studentNotifiedDeclinedAt: row.student_notified_declined_at || null,
    reminder24hSentAt: row.reminder_24h_sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertBooking({
  id,
  studentId,
  tutorId,
  status,
  scheduledStart,
  scheduledEnd,
  hours,
  hourlyRateCents,
  amountCents,
  studentMessage = "",
  paymentId = null,
}) {
  if (!BOOKING_STATUSES.has(status)) {
    throw new Error(`Invalid booking status: ${status}`);
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const bookingId = id || randomUUID();
  await sqlite.run(
    db,
    `INSERT INTO tutoring_bookings (
      id, student_id, tutor_id, status, scheduled_start, scheduled_end,
      hours, hourly_rate_cents, amount_cents, currency, student_message,
      payment_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'myr', ?, ?, ?, ?)`,
    [
      bookingId,
      String(studentId),
      String(tutorId),
      status,
      String(scheduledStart),
      String(scheduledEnd),
      Number(hours),
      Number(hourlyRateCents),
      Number(amountCents),
      String(studentMessage || "").slice(0, 2000),
      paymentId ? String(paymentId) : null,
      now,
      now,
    ]
  );
  return getBookingById(bookingId);
}

/** @deprecated Prefer pay-first checkout; only used for legacy rows. */
export async function createBooking(params) {
  return insertBooking({ ...params, status: "awaiting_payment" });
}

export async function cleanupUnpaidTutoringAndPayments() {
  const db = await getDb();
  await sqlite.run(
    db,
    "DELETE FROM tutoring_bookings WHERE status IN ('awaiting_payment', 'cancelled')"
  );
  await sqlite.run(db, "DELETE FROM payments WHERE status = 'pending'");
}

export async function getBookingById(id) {
  const db = await getDb();
  const row = await sqlite.get(db, "SELECT * FROM tutoring_bookings WHERE id = ?", [
    String(id),
  ]);
  return rowToBooking(row);
}

/**
 * @param {object} extra
 * @param {string|string[]} [extra.expectedStatus] If given, the update only
 *   applies when the row's current status matches (atomically, in the same
 *   statement) — used to guard against two concurrent requests both acting
 *   on the same booking (e.g. accept + decline, or two decline clicks).
 *   Returns null if the row didn't match (another request already moved it).
 */
export async function updateBookingStatus(id, status, extra = {}) {
  if (!BOOKING_STATUSES.has(status)) {
    throw new Error(`Invalid booking status: ${status}`);
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const paymentId =
    extra.paymentId !== undefined ? extra.paymentId : undefined;
  const expected = extra.expectedStatus
    ? Array.isArray(extra.expectedStatus)
      ? extra.expectedStatus
      : [extra.expectedStatus]
    : null;
  const guardClause = expected
    ? ` AND status IN (${expected.map(() => "?").join(", ")})`
    : "";
  const guardParams = expected || [];

  let result;
  if (paymentId !== undefined) {
    result = await sqlite.run(
      db,
      `UPDATE tutoring_bookings
       SET status = ?, payment_id = ?, updated_at = ?
       WHERE id = ?${guardClause}`,
      [status, paymentId ? String(paymentId) : null, now, String(id), ...guardParams]
    );
  } else {
    result = await sqlite.run(
      db,
      `UPDATE tutoring_bookings SET status = ?, updated_at = ? WHERE id = ?${guardClause}`,
      [status, now, String(id), ...guardParams]
    );
  }
  if (expected && !(result?.changes > 0)) return null;
  return getBookingById(id);
}

export async function listBookingsForStudent(studentId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM tutoring_bookings
     WHERE student_id = ?
       AND status NOT IN ('awaiting_payment', 'cancelled')
     ORDER BY scheduled_start DESC
     LIMIT 300`,
    [String(studentId)]
  );
  return rows.map(rowToBooking);
}

export async function listBookingsForTutor(tutorId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM tutoring_bookings
     WHERE tutor_id = ?
       AND status NOT IN ('awaiting_payment', 'cancelled')
     ORDER BY scheduled_start DESC
     LIMIT 300`,
    [String(tutorId)]
  );
  return rows.map(rowToBooking);
}

/**
 * Batched version of `getTutorReviewStats` for N tutors in one query
 * instead of N — used by the tutoring browse list, which would otherwise
 * run one aggregate query per listed tutor.
 */
export async function getTutorReviewStatsForTutors(tutorIds) {
  const ids = [...new Set((tutorIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await sqlite.all(
    db,
    `SELECT tutor_id,
            COUNT(*)::int AS review_count,
            COALESCE(AVG(rating), 0)::float AS average_rating
       FROM tutor_reviews
      WHERE tutor_id IN (${placeholders})
      GROUP BY tutor_id`,
    ids
  );
  for (const row of rows) {
    const count = Number(row.review_count || 0);
    const avg = Number(row.average_rating || 0);
    map.set(String(row.tutor_id), {
      reviewCount: count,
      averageRating: count > 0 ? Math.round(avg * 10) / 10 : 0,
    });
  }
  return map;
}

export async function getTutorReviewStats(tutorId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `SELECT
       COUNT(*)::int AS review_count,
       COALESCE(AVG(rating), 0)::float AS average_rating
     FROM tutor_reviews
     WHERE tutor_id = ?`,
    [String(tutorId)]
  );
  const count = Number(row?.review_count || 0);
  const avg = Number(row?.average_rating || 0);
  return {
    reviewCount: count,
    averageRating: count > 0 ? Math.round(avg * 10) / 10 : 0,
  };
}

export async function listReviewsForTutor(tutorId, limit = 20) {
  const db = await getDb();
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = await sqlite.all(
    db,
    `SELECT id, booking_id, student_id, tutor_id, rating, comment, created_at
     FROM tutor_reviews
     WHERE tutor_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [String(tutorId), lim]
  );
  return rows.map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    studentId: r.student_id,
    tutorId: r.tutor_id,
    rating: Number(r.rating),
    comment: r.comment || "",
    createdAt: r.created_at,
  }));
}

/**
 * Batched version of `getReviewForBooking` for N bookings in one query
 * instead of N — used by the bookings list, which would otherwise run one
 * lookup per completed booking shown to a student.
 */
export async function getReviewsForBookings(bookingIds) {
  const ids = [...new Set((bookingIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await sqlite.all(
    db,
    `SELECT * FROM tutor_reviews WHERE booking_id IN (${placeholders})`,
    ids
  );
  for (const row of rows) {
    map.set(String(row.booking_id), {
      id: row.id,
      bookingId: row.booking_id,
      studentId: row.student_id,
      tutorId: row.tutor_id,
      rating: Number(row.rating),
      comment: row.comment || "",
      createdAt: row.created_at,
    });
  }
  return map;
}

export async function getReviewForBooking(bookingId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM tutor_reviews WHERE booking_id = ? LIMIT 1",
    [String(bookingId)]
  );
  if (!row) return null;
  return {
    id: row.id,
    bookingId: row.booking_id,
    studentId: row.student_id,
    tutorId: row.tutor_id,
    rating: Number(row.rating),
    comment: row.comment || "",
    createdAt: row.created_at,
  };
}

export async function insertReview({ bookingId, studentId, tutorId, rating, comment }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  await sqlite.run(
    db,
    `INSERT INTO tutor_reviews (id, booking_id, student_id, tutor_id, rating, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(bookingId),
      String(studentId),
      String(tutorId),
      Number(rating),
      String(comment || "").slice(0, 2000),
      now,
    ]
  );
  return {
    id,
    bookingId,
    studentId,
    tutorId,
    rating: Number(rating),
    comment: String(comment || ""),
    createdAt: now,
  };
}

export function tutoringPaymentCourseId(bookingId) {
  return `tutoring:${String(bookingId)}`;
}

export function isTutoringPaymentCourseId(courseId) {
  return String(courseId || "").startsWith("tutoring:");
}
