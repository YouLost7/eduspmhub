import test from "node:test";
import assert from "node:assert/strict";
import { creditCourseSale, getBalanceSummary } from "../server/marketplace/balance.js";
import { marketplaceSellerCreditCents } from "../server/marketplace/fees.js";

test("creditCourseSale credits the seller net of the platform fee", async () => {
  const educatorId = `educator_${Date.now()}`;
  const paymentId = `payment_${Date.now()}`;
  const grossCents = 1000;

  const result = await creditCourseSale({
    educatorId,
    paymentId,
    grossCents,
    title: "Test course",
  });
  assert.equal(result.credited, true);
  assert.equal(result.netCents, marketplaceSellerCreditCents(grossCents));

  const summary = await getBalanceSummary(educatorId);
  assert.equal(summary.availableCents, marketplaceSellerCreditCents(grossCents));
});

test("creditCourseSale is idempotent for the same paymentId", async () => {
  const educatorId = `educator_dup_${Date.now()}`;
  const paymentId = `payment_dup_${Date.now()}`;
  const grossCents = 500;

  const first = await creditCourseSale({ educatorId, paymentId, grossCents, title: "Course" });
  assert.equal(first.credited, true);

  const second = await creditCourseSale({ educatorId, paymentId, grossCents, title: "Course" });
  assert.equal(second.credited, false);
  assert.equal(second.duplicate, true);

  const summary = await getBalanceSummary(educatorId);
  assert.equal(summary.availableCents, marketplaceSellerCreditCents(grossCents));
});

test("concurrent creditCourseSale calls for the same paymentId credit exactly once", async () => {
  // Regression check: the balance update used to happen before the ledger
  // insert's duplicate check could take effect, so two racing calls for the
  // same sale could both increment the balance. The insert now happens
  // first (atomically claiming the sale via a unique index) and the balance
  // is only touched by whichever call wins that insert.
  const educatorId = `educator_race_${Date.now()}`;
  const paymentId = `payment_race_${Date.now()}`;
  const grossCents = 800;

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      creditCourseSale({ educatorId, paymentId, grossCents, title: "Course" })
    )
  );

  const creditedCount = results.filter((r) => r.credited).length;
  assert.equal(creditedCount, 1);

  const summary = await getBalanceSummary(educatorId);
  assert.equal(summary.availableCents, marketplaceSellerCreditCents(grossCents));
});
