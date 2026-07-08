import { randomBytes, randomUUID, createHash } from "node:crypto";
import { getDb, sqlite } from "./sqlite.js";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken) {
  return createHash("sha256").update(String(rawToken)).digest("hex");
}

/**
 * Creates a one-time password reset token for a user. Only the SHA-256
 * hash is stored (same reasoning as not storing plaintext passwords): a
 * database leak shouldn't hand out directly-usable reset links. The raw
 * token is returned once, for embedding in the emailed link, and is never
 * persisted.
 */
export async function createPasswordResetToken(userId) {
  const db = await getDb();
  const rawToken = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  await sqlite.run(
    db,
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), String(userId), hashToken(rawToken), expiresAt.toISOString(), now.toISOString()]
  );
  return { rawToken, expiresAt };
}

/**
 * Validates a reset token without consuming it (used to give the reset
 * password page a friendly "this link expired" state before the user
 * finishes typing a new password).
 */
export async function findValidPasswordResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      LIMIT 1`,
    [hashToken(token), new Date().toISOString()]
  );
  return row ? { userId: row.user_id } : null;
}

/**
 * Atomically marks a token as used and returns the user it belongs to, or
 * null if the token is missing/expired/already used. The `used_at IS NULL`
 * guard is in the UPDATE's WHERE clause (not a separate check-then-act), so
 * two concurrent requests with the same token can't both succeed.
 */
export async function consumePasswordResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const db = await getDb();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const result = await sqlite.run(
    db,
    `UPDATE password_reset_tokens
        SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    [now, tokenHash, now]
  );
  if (!(result?.changes > 0)) return null;
  const row = await sqlite.get(
    db,
    `SELECT user_id FROM password_reset_tokens WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  return row ? { userId: row.user_id } : null;
}

/** Invalidates any other outstanding reset tokens for a user (e.g. after a successful reset, or before issuing a new one). */
export async function invalidatePasswordResetTokensForUser(userId) {
  const db = await getDb();
  await sqlite.run(
    db,
    `UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
    [new Date().toISOString(), String(userId)]
  );
}
