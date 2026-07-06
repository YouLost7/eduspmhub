import Stripe from "stripe";

const DEFAULT_API_VERSION = "2024-06-20";

export function createStripeClient(secretKey) {
  return new Stripe(secretKey, {
    apiVersion: DEFAULT_API_VERSION,
  });
}

export function verifyStripeWebhookEvent(stripe, rawBody, signature, webhookSecret) {
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Best-effort refund for a checkout that already captured payment but
 * couldn't be fulfilled (e.g. lost a race for the last unit of inventory).
 * Returns whether the refund actually succeeded; callers should still mark
 * the payment record accordingly either way so staff can follow up on a
 * failed auto-refund.
 */
export async function refundStripePaymentIntent(stripe, paymentIntentId) {
  if (!stripe || !paymentIntentId) return false;
  try {
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
    });
    return true;
  } catch (e) {
    console.error("[stripe] auto-refund failed", e);
    return false;
  }
}

export async function fetchStripeReceiptUrl(stripe, paymentIntentId) {
  if (!paymentIntentId) return "";
  try {
    const pi = await stripe.paymentIntents.retrieve(String(paymentIntentId), {
      expand: ["latest_charge"],
    });
    const charge = pi?.latest_charge;
    if (charge && typeof charge === "object" && "receipt_url" in charge) {
      return String(charge.receipt_url || "");
    }
    return "";
  } catch {
    return "";
  }
}
