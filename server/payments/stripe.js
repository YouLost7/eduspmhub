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
