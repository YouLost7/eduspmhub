import test from "node:test";
import assert from "node:assert/strict";
import { secretEquals } from "../server/validation.js";
import {
  replaceAvailabilityForTutor,
  reserveTutoringBooking,
} from "../server/tutoring/availability.js";
import {
  insertListing,
  insertOrder,
  updateOrderStatus,
} from "../server/marketplace/store.js";
import {
  createWithdrawalRequest,
  markWithdrawalPaid,
  cancelWithdrawal,
  getBalanceSummary,
  creditCourseSale,
} from "../server/marketplace/balance.js";

test("secretEquals is correct for matching, mismatching, and different-length secrets", () => {
  assert.equal(secretEquals("abc123", "abc123"), true);
  assert.equal(secretEquals("abc123", "abc124"), false);
  assert.equal(secretEquals("short", "a-much-longer-secret"), false);
  assert.equal(secretEquals("", ""), false);
  assert.equal(secretEquals(undefined, "x"), false);
});

test("reserveTutoringBooking rejects a second booking that overlaps an already-reserved slot", async () => {
  const tutorId = `tutor_${Date.now()}`;
  await replaceAvailabilityForTutor(tutorId, [
    { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
  ]);

  const scheduledStart = "2099-01-05T10:00:00.000Z"; // a Monday
  const scheduledEnd = "2099-01-05T11:00:00.000Z";

  const first = await reserveTutoringBooking({
    tutorId,
    scheduledStart,
    scheduledEnd,
    insertParams: {
      studentId: "student_a",
      status: "paid",
      hours: 1,
      hourlyRateCents: 2000,
      amountCents: 2000,
    },
  });
  assert.equal(first.ok, true);

  const second = await reserveTutoringBooking({
    tutorId,
    scheduledStart,
    scheduledEnd,
    insertParams: {
      studentId: "student_b",
      status: "paid",
      hours: 1,
      hourlyRateCents: 2000,
      amountCents: 2000,
    },
  });
  assert.equal(second.ok, false);
});

test("concurrent reserveTutoringBooking calls for the same slot only let one succeed", async () => {
  const tutorId = `tutor_race_${Date.now()}`;
  await replaceAvailabilityForTutor(tutorId, [
    { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
  ]);

  const scheduledStart = "2099-01-06T10:00:00.000Z"; // a Tuesday
  const scheduledEnd = "2099-01-06T11:00:00.000Z";

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      reserveTutoringBooking({
        tutorId,
        scheduledStart,
        scheduledEnd,
        insertParams: {
          studentId: `student_${i}`,
          status: "paid",
          hours: 1,
          hourlyRateCents: 2000,
          amountCents: 2000,
        },
      })
    )
  );

  const successes = results.filter((r) => r.ok);
  assert.equal(successes.length, 1);
});

test("updateOrderStatus with fromStatus rejects a transition once another request already moved it", async () => {
  const listing = await insertListing({
    sellerId: `seller_${Date.now()}`,
    itemType: "physical",
    category: "books",
    title: "Test book",
    priceCents: 500,
  });
  const order = await insertOrder({
    listingId: listing.id,
    buyerId: `buyer_${Date.now()}`,
    sellerId: listing.sellerId,
    status: "paid",
    itemType: "physical",
    title: listing.title,
    amountCents: 500,
  });

  const first = await updateOrderStatus(order.id, {
    status: "seller_ready",
    fromStatus: "paid",
  });
  assert.ok(first);
  assert.equal(first.status, "seller_ready");

  // A second attempt from the stale "paid" expectation must not apply, since
  // the order already moved on.
  const second = await updateOrderStatus(order.id, {
    status: "seller_ready",
    fromStatus: "paid",
  });
  assert.equal(second, null);
});

test("markWithdrawalPaid and cancelWithdrawal cannot both succeed for the same withdrawal", async () => {
  const sellerId = `seller_wd_${Date.now()}`;
  await creditCourseSale({
    educatorId: sellerId,
    paymentId: `payment_${Date.now()}`,
    grossCents: 10000,
    title: "Course for withdrawal test",
  });

  const before = await getBalanceSummary(sellerId);
  const { withdrawal, error } = await createWithdrawalRequest({
    userId: sellerId,
    amountCents: 3000,
    bankName: "Test Bank",
    accountHolder: "Test Seller",
    accountNumber: "1234567890",
  });
  assert.equal(error, undefined);

  const [paidResult, cancelResult] = await Promise.all([
    markWithdrawalPaid(withdrawal.id),
    cancelWithdrawal(withdrawal.id),
  ]);

  // Exactly one of the two concurrent admin actions should have won.
  const oneWon = (paidResult === null) !== (cancelResult === null);
  assert.ok(oneWon, "expected exactly one of markWithdrawalPaid/cancelWithdrawal to succeed");

  const after = await getBalanceSummary(sellerId);
  if (cancelResult) {
    // Cancelled: the held amount should be back in the available balance.
    assert.equal(after.availableCents, before.availableCents);
  } else {
    // Paid: the held amount stays deducted (already reserved at request time).
    assert.equal(after.availableCents, before.availableCents - 3000);
  }
});
