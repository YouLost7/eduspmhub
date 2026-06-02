/**
 * Optional email: set RESEND_API_KEY + MAIL_FROM, or SMTP_* for a simple HTTP relay.
 * Without config, messages are logged to the server console (dev-friendly).
 */

const MAIL_FROM = String(process.env.MAIL_FROM || "EduSPM Hub <noreply@eduspmhub.local>").trim();
const APP_NAME = "EduSPM Hub";

export function isMailConfigured() {
  return Boolean(
    String(process.env.RESEND_API_KEY || "").trim() ||
      (String(process.env.SMTP_URL || "").trim() && String(process.env.MAIL_FROM || "").trim())
  );
}

async function sendViaResend({ to, subject, text, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject,
      text,
      html: html || undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}

export async function sendMail({ to, subject, text, html }) {
  const email = String(to || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { sent: false, reason: "invalid_to" };

  try {
    if (process.env.RESEND_API_KEY) {
      await sendViaResend({ to: email, subject, text, html });
      return { sent: true, provider: "resend" };
    }
  } catch (e) {
    console.error("[mail] Resend failed:", e.message || e);
    return { sent: false, reason: "resend_error" };
  }

  console.log(`[${APP_NAME} mail] To: ${email}`);
  console.log(`[${APP_NAME} mail] Subject: ${subject}`);
  console.log(`[${APP_NAME} mail] ---`);
  console.log(text);
  console.log(`[${APP_NAME} mail] ---`);
  return { sent: false, provider: "console", reason: "not_configured" };
}
