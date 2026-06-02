/** Marketplace platform fee (basis points). 1000 = 10%. */
export const MARKETPLACE_PLATFORM_FEE_BPS = 1000;

/** Minimum withdrawal request (RM20). */
export const MIN_WITHDRAWAL_CENTS = 2000;

export function marketplacePlatformFeeCents(amountCents) {
  const n = Number(amountCents) || 0;
  return Math.max(0, Math.round((n * MARKETPLACE_PLATFORM_FEE_BPS) / 10000));
}

export function marketplaceSellerCreditCents(amountCents) {
  const gross = Number(amountCents) || 0;
  return Math.max(0, gross - marketplacePlatformFeeCents(gross));
}
