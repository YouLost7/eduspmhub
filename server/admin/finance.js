import { getDb, sqlite } from "../sqlite.js";
import { formatMoneyLabel } from "../marketplace/store.js";

function money(cents) {
  const n = Number(cents) || 0;
  return { cents: n, label: formatMoneyLabel(n) };
}

function productTypeFromCourseId(courseId) {
  const id = String(courseId || "");
  if (id.startsWith("marketplace:")) return "marketplace";
  if (id.startsWith("tutoring:")) return "tutoring";
  return "course";
}

export async function getAdminFinanceSummary() {
  const db = await getDb();

  const paidRows = await sqlite.all(
    db,
    `SELECT amount_cents, provider, course_id, status
     FROM payments
     WHERE status IN ('paid', 'refunded')`
  );

  let stripePaidCents = 0;
  let stripePaidCount = 0;
  let mockPaidCents = 0;
  let mockPaidCount = 0;
  let refundedCents = 0;
  let refundedCount = 0;
  const byProduct = { course: 0, tutoring: 0, marketplace: 0 };
  const byProductCount = { course: 0, tutoring: 0, marketplace: 0 };

  for (const row of paidRows) {
    const cents = Number(row.amount_cents) || 0;
    const provider = String(row.provider || "");
    const status = String(row.status || "");

    if (status === "refunded") {
      refundedCents += cents;
      refundedCount += 1;
      continue;
    }

    if (provider === "stripe") {
      stripePaidCents += cents;
      stripePaidCount += 1;
    } else if (provider === "mock") {
      mockPaidCents += cents;
      mockPaidCount += 1;
    }

    const pt = productTypeFromCourseId(row.course_id);
    byProduct[pt] = (byProduct[pt] || 0) + cents;
    byProductCount[pt] = (byProductCount[pt] || 0) + 1;
  }

  const balRow = await sqlite.get(
    db,
    `SELECT
       COALESCE(SUM(available_cents), 0)::int AS available,
       COALESCE(SUM(lifetime_earned_cents), 0)::int AS lifetime
     FROM seller_balances`
  );

  const pendingWd = await sqlite.get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
     FROM withdrawal_requests WHERE status = 'pending'`
  );

  const paidWd = await sqlite.get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
     FROM withdrawal_requests WHERE status = 'paid'`
  );

  const feeRow = await sqlite.get(
    db,
    `SELECT COALESCE(SUM(ABS(amount_cents)), 0)::int AS total
     FROM balance_transactions WHERE type = 'platform_fee'`
  );

  const creditRow = await sqlite.get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
     FROM balance_transactions WHERE type = 'sale_credit'`
  );

  const tutoringPendingCredit = await sqlite.get(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
     FROM tutoring_bookings
     WHERE status IN ('paid', 'accepted')`
  );

  const availableCents = Number(balRow?.available) || 0;
  const pendingWdCents = Number(pendingWd?.total) || 0;
  const liabilityCents = availableCents + pendingWdCents;
  const platformFeeCents = Number(feeRow?.total) || 0;
  const netStripeCents = Math.max(0, stripePaidCents - refundedCents);
  const tutoringHeldCents = Number(tutoringPendingCredit?.total) || 0;
  const tutoringHeldNetCents = Math.round(tutoringHeldCents * 0.9);

  const estimatedPlatformCashCents = Math.max(
    0,
    netStripeCents - liabilityCents - (Number(paidWd?.total) || 0)
  );

  return {
    stripeCollected: { ...money(stripePaidCents), count: stripePaidCount },
    mockCollected: { ...money(mockPaidCents), count: mockPaidCount },
    refunded: { ...money(refundedCents), count: refundedCount },
    netStripeIn: { ...money(netStripeCents), count: stripePaidCount },
    byProduct: {
      courses: { ...money(byProduct.course), count: byProductCount.course },
      tutoring: { ...money(byProduct.tutoring), count: byProductCount.tutoring },
      marketplace: { ...money(byProduct.marketplace), count: byProductCount.marketplace },
    },
    wallet: {
      available: { ...money(availableCents) },
      pendingWithdrawals: {
        ...money(pendingWdCents),
        count: Number(pendingWd?.n) || 0,
      },
      totalLiability: { ...money(liabilityCents) },
      lifetimeCredited: { ...money(Number(creditRow?.total) || 0) },
      paidOut: {
        ...money(Number(paidWd?.total) || 0),
        count: Number(paidWd?.n) || 0,
      },
    },
    platform: {
      feesFromLedger: { ...money(platformFeeCents) },
      estimatedCashRetained: { ...money(estimatedPlatformCashCents) },
      feePercent: 10,
    },
    tutoring: {
      awaitingCompletion: {
        ...money(tutoringHeldCents),
        count: Number(tutoringPendingCredit?.n) || 0,
        note: "Paid/accepted sessions not yet credited to tutors",
      },
      futureLiabilityEstimate: { ...money(tutoringHeldNetCents) },
    },
    notes: [
      "Stripe collected = paid charges on your platform Stripe account.",
      "Wallet liability = seller available balance + pending withdrawal requests.",
      "Platform fees (ledger) = 10% recorded when seller earnings are credited.",
      "Estimated cash retained ≈ net Stripe in − wallet liability − already paid out (excludes Stripe processing fees).",
    ],
  };
}
