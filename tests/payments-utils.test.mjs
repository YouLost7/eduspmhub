import test from "node:test";
import assert from "node:assert/strict";
import { priceToCents, isPaidPrice } from "../server/payments/store.js";
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
