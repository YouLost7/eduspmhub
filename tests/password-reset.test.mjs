import test from "node:test";
import assert from "node:assert/strict";
import { getDb, sqlite } from "../server/sqlite.js";
import { insertUser } from "../server/db.js";
import {
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  invalidatePasswordResetTokensForUser,
} from "../server/passwordReset.js";

function makeUser(overrides = {}) {
  const id = overrides.id || `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const email = overrides.email || `${id}@example.test`;
  return {
    passwordHash: "x",
    role: "student",
    verified: true,
    fullName: "Test Student",
    createdAt: new Date().toISOString(),
    ...overrides,
    id,
    email,
  };
}

test("createPasswordResetToken issues a token that validates and consumes exactly once", async () => {
  const user = makeUser();
  await insertUser(user);

  const { rawToken, expiresAt } = await createPasswordResetToken(user.id);
  assert.ok(rawToken.length >= 32);
  assert.ok(expiresAt instanceof Date);

  const valid = await findValidPasswordResetToken(rawToken);
  assert.equal(valid.userId, user.id);

  const consumed = await consumePasswordResetToken(rawToken);
  assert.equal(consumed.userId, user.id);

  // Using the same token again must fail — single use.
  const reused = await consumePasswordResetToken(rawToken);
  assert.equal(reused, null);
  const stillValid = await findValidPasswordResetToken(rawToken);
  assert.equal(stillValid, null);
});

test("consumePasswordResetToken rejects unknown tokens", async () => {
  const result = await consumePasswordResetToken("not-a-real-token");
  assert.equal(result, null);
});

test("consumePasswordResetToken rejects an expired token", async () => {
  const user = makeUser();
  await insertUser(user);
  const { rawToken } = await createPasswordResetToken(user.id);

  // Force the token into the past directly, since the real TTL is 1 hour.
  const db = await getDb();
  await sqlite.run(
    db,
    `UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?`,
    [new Date(Date.now() - 1000).toISOString(), user.id]
  );

  const result = await consumePasswordResetToken(rawToken);
  assert.equal(result, null);
});

test("concurrent consumePasswordResetToken calls for the same token only let one succeed", async () => {
  const user = makeUser();
  await insertUser(user);
  const { rawToken } = await createPasswordResetToken(user.id);

  const results = await Promise.all(
    Array.from({ length: 5 }, () => consumePasswordResetToken(rawToken))
  );
  const successes = results.filter((r) => r !== null);
  assert.equal(successes.length, 1);
});

test("invalidatePasswordResetTokensForUser invalidates outstanding tokens", async () => {
  const user = makeUser();
  await insertUser(user);
  const { rawToken: tokenA } = await createPasswordResetToken(user.id);
  const { rawToken: tokenB } = await createPasswordResetToken(user.id);

  await invalidatePasswordResetTokensForUser(user.id);

  assert.equal(await findValidPasswordResetToken(tokenA), null);
  assert.equal(await findValidPasswordResetToken(tokenB), null);
});
