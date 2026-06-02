/** Marketplace seller payouts via Stripe Connect Express (destination charges). */

export const MARKETPLACE_PLATFORM_FEE_BPS = 1000;

export function marketplaceApplicationFeeCents(amountCents) {
  const n = Number(amountCents) || 0;
  return Math.max(0, Math.round((n * MARKETPLACE_PLATFORM_FEE_BPS) / 10000));
}

export async function getConnectAccountStatus(stripe, accountId) {
  if (!stripe || !accountId) {
    return {
      connected: false,
      accountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }
  const acct = await stripe.accounts.retrieve(String(accountId));
  return {
    connected: true,
    accountId: acct.id,
    chargesEnabled: Boolean(acct.charges_enabled),
    payoutsEnabled: Boolean(acct.payouts_enabled),
    detailsSubmitted: Boolean(acct.details_submitted),
    ready: Boolean(acct.charges_enabled && acct.payouts_enabled),
  };
}

export async function ensureConnectAccount(stripe, user) {
  if (user.stripeConnectAccountId) {
    return { accountId: user.stripeConnectAccountId, created: false };
  }
  const account = await stripe.accounts.create({
    type: "express",
    country: "MY",
    email: String(user.email || "").trim() || undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      product_description: "Educational materials sold on EduSPM Hub marketplace",
    },
    metadata: {
      eduspmUserId: String(user.id),
    },
  });
  return { accountId: account.id, created: true };
}

export async function createConnectOnboardingLink(stripe, accountId, APP_BASE_URL) {
  return stripe.accountLinks.create({
    account: String(accountId),
    refresh_url: `${APP_BASE_URL}/marketplace/sell?tab=payouts&connect=refresh`,
    return_url: `${APP_BASE_URL}/marketplace/sell?tab=payouts&connect=done`,
    type: "account_onboarding",
  });
}

export function buildCheckoutConnectPaymentIntentData(amountCents, sellerConnectAccountId) {
  if (!sellerConnectAccountId) return undefined;
  const fee = marketplaceApplicationFeeCents(amountCents);
  return {
    application_fee_amount: fee,
    transfer_data: {
      destination: String(sellerConnectAccountId),
    },
  };
}
