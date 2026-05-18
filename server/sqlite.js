import sqlite3 from "sqlite3";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, "eduspmhub.sqlite");

const USERS_JSON_PATH = join(DATA_DIR, "users.json");
const ENROLLMENTS_JSON_PATH = join(DATA_DIR, "enrollments.json");
const COURSES_JSON_PATH = join(DATA_DIR, "educator-courses.json");

let dbPromise = null;

function openDb(path) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

async function readJsonMaybe(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function migrateLegacyJsonIfNeeded(db) {
  const usersRow = await get(db, "SELECT COUNT(*) AS n FROM users");
  if ((usersRow?.n || 0) === 0) {
    const users = await readJsonMaybe(USERS_JSON_PATH, []);
    if (Array.isArray(users)) {
      for (const u of users) {
        if (!u || typeof u !== "object") continue;
        const id = String(u.id || "").trim();
        const email = String(u.email || "").trim().toLowerCase();
        if (!id || !email) continue;
        await run(
          db,
          "INSERT OR REPLACE INTO users (id, email, data) VALUES (?, ?, ?)",
          [id, email, JSON.stringify(u)]
        );
      }
    }
  }

  const enrollRow = await get(db, "SELECT COUNT(*) AS n FROM enrollments");
  if ((enrollRow?.n || 0) === 0) {
    const enroll = await readJsonMaybe(ENROLLMENTS_JSON_PATH, {});
    if (enroll && typeof enroll === "object") {
      for (const [uid, ids] of Object.entries(enroll)) {
        const list = Array.isArray(ids) ? ids : [];
        await run(
          db,
          "INSERT OR REPLACE INTO enrollments (user_id, data) VALUES (?, ?)",
          [String(uid), JSON.stringify(list)]
        );
      }
    }
  }

  const courseRow = await get(db, "SELECT COUNT(*) AS n FROM educator_courses");
  if ((courseRow?.n || 0) === 0) {
    const list = await readJsonMaybe(COURSES_JSON_PATH, []);
    if (Array.isArray(list)) {
      for (const c of list) {
        if (!c || typeof c !== "object") continue;
        const id = String(c.id || "").trim();
        if (!id) continue;
        await run(
          db,
          "INSERT OR REPLACE INTO educator_courses (id, educator_id, status, updated_at, data) VALUES (?, ?, ?, ?, ?)",
          [
            id,
            String(c.educatorId || ""),
            String(c.status || ""),
            String(c.updatedAt || c.createdAt || ""),
            JSON.stringify(c),
          ]
        );
      }
    }
  }
}

async function ensureDb() {
  await mkdir(dirname(DB_PATH), { recursive: true });
  const db = await openDb(DB_PATH);
  await run(db, "PRAGMA journal_mode = WAL");
  await run(db, "PRAGMA foreign_keys = ON");
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS enrollments (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS educator_courses (
      id TEXT PRIMARY KEY,
      educator_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      provider_payment_intent_id TEXT,
      provider_event_id TEXT,
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      receipt_url TEXT,
      payment_method_type TEXT,
      raw_payload TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      course_title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      paid_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS payment_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, event_id)
    )`
  );
  await run(db, "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_educator_courses_owner ON educator_courses(educator_id)"
  );
  await run(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_unique_user_course ON purchase_items(user_id, course_id)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_purchase_items_user ON purchase_items(user_id)"
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)"
  );
  await run(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_session ON payments(provider, provider_session_id)"
  );
  await run(
    db,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_intent ON payments(provider, provider_payment_intent_id)"
  );
  await migrateLegacyJsonIfNeeded(db);
  return db;
}

export async function getDb() {
  if (!dbPromise) dbPromise = ensureDb();
  return dbPromise;
}

export const sqlite = {
  run,
  get,
  all,
};
