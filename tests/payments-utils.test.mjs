import test from "node:test";
import assert from "node:assert/strict";
import { priceToCents, isPaidPrice, upsertPaymentRecord, getPaymentBySessionId } from "../server/payments/store.js";
import { getDb, sqlite } from "../server/sqlite.js";

test("priceToCents treats free-like values as zero", () => {
  assert.equal(priceToCents(""), 0);
  assert.equal(priceToCents("RM0"), 0);
  assert.equal(priceToCents("RM0.00"), 0);
  assert.equal(priceToCents("RM1.99"), 0);
  assert.equal(priceToCents("free"), 0);
});

test("priceToCents parses RM values to cents", () => {
  assert.equal(priceToCents("RM12"), 1200);
  assert.equal(priceToCents("RM12.50"), 1250);
  assert.equal(priceToCents("RM2.00"), 200);
  assert.equal(priceToCents("12.99"), 1299);
});

test("isPaidPrice distinguishes free vs paid", () => {
  assert.equal(isPaidPrice("RM0.00"), false);
  assert.equal(isPaidPrice("RM1.99"), false);
  assert.equal(isPaidPrice("RM2.00"), true);
  assert.equal(isPaidPrice("RM10.00"), true);
});

test("database bootstrap includes payment tables", async () => {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('payments', 'purchase_items', 'payment_events', 'tutoring_bookings', 'tutor_reviews', 'tutor_availability', 'marketplace_listings', 'marketplace_orders', 'marketplace_reports', 'seller_balances', 'balance_transactions', 'withdrawal_requests')
      ORDER BY table_name`
  );
  assert.deepEqual(rows.map((r) => r.name), [
    "balance_transactions",
    "marketplace_listings",
    "marketplace_orders",
    "marketplace_reports",
    "payment_events",
    "payments",
    "purchase_items",
    "seller_balances",
    "tutor_availability",
    "tutor_reviews",
    "tutoring_bookings",
    "withdrawal_requests",
  ]);
});

test("upsertPaymentRecord is idempotent for the same Stripe session", async () => {
  const sessionId = `cs_smoke_${Date.now()}`;
  const firstId = `pay_first_${Date.now()}`;
  const secondId = `pay_second_${Date.now()}`;
  const userId = `user_${Date.now()}`;
  const courseId = `course_${Date.now()}`;

  const canonicalId = await upsertPaymentRecord({
    id: firstId,
    provider: "stripe",
    providerSessionId: sessionId,
    userId,
    courseId,
    courseTitle: "Smoke course",
    amountCents: 500,
    status: "paid",
    paidAt: new Date().toISOString(),
  });
  assert.equal(canonicalId, firstId);

  const resolvedId = await upsertPaymentRecord({
    id: secondId,
    provider: "stripe",
    providerSessionId: sessionId,
    userId,
    courseId,
    courseTitle: "Smoke course",
    amountCents: 500,
    status: "paid",
    paidAt: new Date().toISOString(),
  });
  assert.equal(resolvedId, firstId);

  const row = await getPaymentBySessionId("stripe", sessionId);
  assert.equal(row?.id, firstId);
});
