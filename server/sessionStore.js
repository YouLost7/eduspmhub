import session from "express-session";
import { getDb, sqlite } from "./sqlite.js";

function resolveExpiryMs(sess, defaultTtlMs) {
  const now = Date.now();
  const exp = sess?.cookie?.expires;
  if (exp) {
    const t = new Date(exp).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  const maxAge = Number(sess?.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) return now + maxAge;
  return now + defaultTtlMs;
}

export class SqliteSessionStore extends session.Store {
  constructor({ ttlMs = 7 * 24 * 60 * 60 * 1000, cleanupIntervalMs = 5 * 60 * 1000 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this._tableReady = null;
    this._cleanupTimer = null;
    this.startCleanup();
  }

  async ensureTable() {
    if (!this._tableReady) {
      this._tableReady = (async () => {
        const db = await getDb();
        await sqlite.run(
          db,
          `CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL,
            data TEXT NOT NULL
          )`
        );
        await sqlite.run(
          db,
          "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"
        );
      })();
    }
    await this._tableReady;
  }

  startCleanup() {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(() => {
      this.clearExpired(() => {});
    }, this.cleanupIntervalMs);
    this._cleanupTimer.unref?.();
  }

  clearExpired(cb) {
    this.ensureTable()
      .then(getDb)
      .then((db) =>
        sqlite.run(db, "DELETE FROM sessions WHERE expires_at <= ?", [Date.now()])
      )
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  get(sid, cb) {
    this.ensureTable()
      .then(getDb)
      .then((db) => sqlite.get(db, "SELECT data, expires_at FROM sessions WHERE sid = ?", [sid]))
      .then(async (row) => {
        if (!row) {
          cb?.(null, null);
          return;
        }
        if (Number(row.expires_at) <= Date.now()) {
          const db = await getDb();
          await sqlite.run(db, "DELETE FROM sessions WHERE sid = ?", [sid]);
          cb?.(null, null);
          return;
        }
        let payload = null;
        try {
          payload = JSON.parse(row.data);
        } catch {
          payload = null;
        }
        cb?.(null, payload);
      })
      .catch((err) => cb?.(err));
  }

  set(sid, sess, cb) {
    const expiresAt = resolveExpiryMs(sess, this.ttlMs);
    this.ensureTable()
      .then(getDb)
      .then((db) =>
        sqlite.run(
          db,
          `INSERT INTO sessions (sid, expires_at, data)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data`,
          [sid, expiresAt, JSON.stringify(sess || {})]
        )
      )
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  destroy(sid, cb) {
    this.ensureTable()
      .then(getDb)
      .then((db) => sqlite.run(db, "DELETE FROM sessions WHERE sid = ?", [sid]))
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  touch(sid, sess, cb) {
    const expiresAt = resolveExpiryMs(sess, this.ttlMs);
    this.ensureTable()
      .then(getDb)
      .then((db) =>
        sqlite.run(db, "UPDATE sessions SET expires_at = ? WHERE sid = ?", [expiresAt, sid])
      )
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }
}
