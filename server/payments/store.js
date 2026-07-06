import { getDb, sqlite } from "../sqlite.js";

const MIN_PAID_PRICE_CENTS = 200;

export function priceToCents(priceLike) {
  const raw = String(priceLike ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^RM\s*/i, "").replace(/,/g, "");
  const num = Number.parseFloat(cleaned.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const cents = Math.round(num * 100);
  return cents < MIN_PAID_PRICE_CENTS ? 0 : cents;
}

export function isPaidPrice(priceLike) {
  return priceToCents(priceLike) > 0;
}

export async function hasPurchaseEntitlement(userId, courseId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT id FROM purchase_items WHERE user_id = ? AND course_id = ? LIMIT 1",
    [String(userId), String(courseId)]
  );
  return Boolean(row);
}

export async function insertPaymentEventIfNew(provider, eventId) {
  const db = await getDb();
  const now = new Date().toISOString();
  const inserted = await sqlite.run(
    db,
    "INSERT INTO payment_events (provider, event_id, created_at) VALUES (?, ?, ?) ON CONFLICT (provider, event_id) DO NOTHING",
    [String(provider), String(eventId), now]
  );
  return inserted?.changes > 0;
}

export async function upsertPaymentRecord({
  id,
  provider = "stripe",
  providerSessionId = null,
  providerPaymentIntentId = null,
  providerEventId = null,
  userId,
  courseId,
  courseTitle,
  amountCents,
  currency = "myr",
  status,
  receiptUrl = null,
  paymentMethodType = null,
  rawPayload = null,
  paidAt = null,
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const params = [
    String(id),
    String(provider),
    providerSessionId ? String(providerSessionId) : null,
    providerPaymentIntentId ? String(providerPaymentIntentId) : null,
    providerEventId ? String(providerEventId) : null,
    String(userId),
    String(courseId),
    String(courseTitle || "Course"),
    Number(amountCents) || 0,
    String(currency || "myr").toLowerCase(),
    String(status || "pending"),
    receiptUrl ? String(receiptUrl) : null,
    paymentMethodType ? String(paymentMethodType) : null,
    rawPayload ? JSON.stringify(rawPayload) : null,
    paidAt ? String(paidAt) : null,
    now,
    now,
  ];

  if (providerSessionId) {
    await sqlite.run(
      db,
      `INSERT INTO payments (
        id, provider, provider_session_id, provider_payment_intent_id, provider_event_id,
        user_id, course_id, course_title, amount_cents, currency, status, receipt_url,
        payment_method_type, raw_payload, paid_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (provider, provider_session_id) DO UPDATE SET
        provider_payment_intent_id = COALESCE(excluded.provider_payment_intent_id, payments.provider_payment_intent_id),
        provider_event_id = COALESCE(excluded.provider_event_id, payments.provider_event_id),
        status = excluded.status,
        receipt_url = COALESCE(excluded.receipt_url, payments.receipt_url),
        payment_method_type = COALESCE(excluded.payment_method_type, payments.payment_method_type),
        raw_payload = COALESCE(excluded.raw_payload, payments.raw_payload),
        paid_at = COALESCE(excluded.paid_at, payments.paid_at),
        updated_at = excluded.updated_at`,
      params
    );
    const row = await getPaymentBySessionId(provider, providerSessionId);
    return row?.id ? String(row.id) : String(id);
  }

  await sqlite.run(
    db,
    `INSERT INTO payments (
      id, provider, provider_session_id, provider_payment_intent_id, provider_event_id,
      user_id, course_id, course_title, amount_cents, currency, status, receipt_url,
      payment_method_type, raw_payload, paid_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_session_id = excluded.provider_session_id,
      provider_payment_intent_id = excluded.provider_payment_intent_id,
      provider_event_id = excluded.provider_event_id,
      status = excluded.status,
      receipt_url = excluded.receipt_url,
      payment_method_type = excluded.payment_method_type,
      raw_payload = excluded.raw_payload,
      paid_at = excluded.paid_at,
      updated_at = excluded.updated_at`,
    params
  );
  return String(id);
}

export async function upsertPaymentBySessionId({
  provider = "stripe",
  providerSessionId,
  providerPaymentIntentId = null,
  providerEventId = null,
  status,
  receiptUrl = null,
  paymentMethodType = null,
  rawPayload = null,
  paidAt = null,
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `UPDATE payments
       SET provider_payment_intent_id = COALESCE(?, provider_payment_intent_id),
           provider_event_id = COALESCE(?, provider_event_id),
           status = ?,
           receipt_url = COALESCE(?, receipt_url),
           payment_method_type = COALESCE(?, payment_method_type),
           raw_payload = COALESCE(?, raw_payload),
           paid_at = COALESCE(?, paid_at),
           updated_at = ?
     WHERE provider = ? AND provider_session_id = ?`,
    [
      providerPaymentIntentId ? String(providerPaymentIntentId) : null,
      providerEventId ? String(providerEventId) : null,
      String(status),
      receiptUrl ? String(receiptUrl) : null,
      paymentMethodType ? String(paymentMethodType) : null,
      rawPayload ? JSON.stringify(rawPayload) : null,
      paidAt ? String(paidAt) : null,
      now,
      String(provider),
      String(providerSessionId),
    ]
  );
}

export async function getPaymentBySessionId(provider, providerSessionId) {
  const db = await getDb();
  return sqlite.get(
    db,
    "SELECT * FROM payments WHERE provider = ? AND provider_session_id = ? LIMIT 1",
    [String(provider), String(providerSessionId)]
  );
}

export async function getPaymentByIntentId(provider, providerPaymentIntentId) {
  const db = await getDb();
  return sqlite.get(
    db,
    "SELECT * FROM payments WHERE provider = ? AND provider_payment_intent_id = ? LIMIT 1",
    [String(provider), String(providerPaymentIntentId)]
  );
}

export async function insertPurchaseItemIfMissing({
  id,
  paymentId,
  userId,
  courseId,
  courseTitle,
  amountCents,
  currency = "myr",
  paidAt,
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `INSERT INTO purchase_items (
      id, payment_id, user_id, course_id, course_title, amount_cents, currency, paid_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
    [
      String(id),
      String(paymentId),
      String(userId),
      String(courseId),
      String(courseTitle || "Course"),
      Number(amountCents) || 0,
      String(currency || "myr").toLowerCase(),
      String(paidAt || now),
      now,
    ]
  );
}

export async function listUserTransactions(userId) {
  const db = await getDb();
  return sqlite.all(
    db,
    `SELECT
       p.id,
       p.status,
       p.amount_cents,
       p.currency,
       p.course_id,
       p.course_title,
       p.receipt_url,
       p.payment_method_type,
       p.provider,
       p.provider_session_id,
       p.provider_payment_intent_id,
       p.paid_at,
       p.created_at,
       p.updated_at
     FROM payments p
     WHERE p.user_id = ?
       AND p.status != 'pending'
     ORDER BY COALESCE(p.paid_at, p.created_at) DESC
     LIMIT 300`,
    [String(userId)]
  );
}

export async function getUserTransactionById(userId, paymentId) {
  const db = await getDb();
  return sqlite.get(
    db,
    `SELECT
       p.id,
       p.status,
       p.amount_cents,
       p.currency,
       p.course_id,
       p.course_title,
       p.receipt_url,
       p.payment_method_type,
       p.provider,
       p.provider_session_id,
       p.provider_payment_intent_id,
       p.paid_at,
       p.created_at,
       p.updated_at
     FROM payments p
     WHERE p.user_id = ? AND p.id = ?
     LIMIT 1`,
    [String(userId), String(paymentId)]
  );
}

export async function listPurchasedCourseIds(userId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    "SELECT course_id FROM purchase_items WHERE user_id = ? ORDER BY created_at DESC",
    [String(userId)]
  );
  return rows.map((r) => String(r.course_id));
}
