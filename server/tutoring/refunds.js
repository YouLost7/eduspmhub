import { getDb, sqlite } from "../sqlite.js";
import { upsertPaymentRecord } from "../payments/store.js";
import { tutoringPaymentCourseId } from "./store.js";

export async function getPaymentForBooking(bookingId) {
  const db = await getDb();
  const courseId = tutoringPaymentCourseId(bookingId);
  return sqlite.get(
    db,
    `SELECT * FROM payments
     WHERE course_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [courseId]
  );
}

export async function refundTutoringBooking(booking, stripe, { allowMock = false } = {}) {
  if (!booking?.paymentId && !booking?.id) {
    return { refunded: false, reason: "no_payment" };
  }

  const payment =
    (booking.paymentId &&
      (await sqlite.get(
        await getDb(),
        "SELECT * FROM payments WHERE id = ? LIMIT 1",
        [String(booking.paymentId)]
      ))) ||
    (await getPaymentForBooking(booking.id));

  if (!payment) return { refunded: false, reason: "payment_not_found" };
  if (payment.status === "refunded") return { refunded: true, reason: "already_refunded" };

  const provider = String(payment.provider || "");
  const intentId = String(payment.provider_payment_intent_id || "").trim();
  const sessionId = String(payment.provider_session_id || "").trim();

  if (provider === "mock" && allowMock) {
    await upsertPaymentRecord({
      id: payment.id,
      provider: "mock",
      userId: payment.user_id,
      courseId: payment.course_id,
      courseTitle: payment.course_title,
      amountCents: payment.amount_cents,
      currency: payment.currency,
      status: "refunded",
      paidAt: payment.paid_at,
    });
    return { refunded: true, provider: "mock" };
  }

  if (!stripe) return { refunded: false, reason: "stripe_not_configured" };

  let paymentIntentId = intentId;
  if (!paymentIntentId && sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (typeof session?.payment_intent === "string") {
      paymentIntentId = session.payment_intent;
    }
  }
  if (!paymentIntentId) {
    return { refunded: false, reason: "no_payment_intent" };
  }

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    reason: "requested_by_customer",
  });

  await upsertPaymentRecord({
    id: payment.id,
    provider: "stripe",
    providerSessionId: sessionId || null,
    providerPaymentIntentId: paymentIntentId,
    userId: payment.user_id,
    courseId: payment.course_id,
    courseTitle: payment.course_title,
    amountCents: payment.amount_cents,
    currency: payment.currency,
    status: "refunded",
    receiptUrl: payment.receipt_url,
    rawPayload: { refund },
    paidAt: payment.paid_at,
  });

  return { refunded: true, provider: "stripe", refundId: refund.id };
}
