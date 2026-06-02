import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvOnce } from "./env.js";

loadEnvOnce();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const USERS_JSON_PATH = join(DATA_DIR, "users.json");
const ENROLLMENTS_JSON_PATH = join(DATA_DIR, "enrollments.json");
const COURSES_JSON_PATH = join(DATA_DIR, "educator-courses.json");

let dbPromise = null;
let pool = null;

function intEnv(name, fallback) {
  const n = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toPgParams(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => `$${++i}`);
}

async function run(_db, sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return { ...res, changes: res.rowCount ?? 0 };
}

async function all(_db, sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows;
}

async function get(_db, sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows[0] || null;
}

async function readJsonMaybe(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function tableCount(client, tableName) {
  const q = await client.query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
  return Number(q.rows[0]?.n || 0);
}

async function migrateLegacyJsonIfNeeded(client) {
  if ((await tableCount(client, "users")) === 0) {
    const users = await readJsonMaybe(USERS_JSON_PATH, []);
    if (Array.isArray(users)) {
      for (const u of users) {
        if (!u || typeof u !== "object") continue;
        const id = String(u.id || "").trim();
        const email = String(u.email || "").trim().toLowerCase();
        if (!id || !email) continue;
        await client.query(
          `INSERT INTO users (id, email, data)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET email = excluded.email, data = excluded.data`,
          [id, email, JSON.stringify(u)]
        );
      }
    }
  }

  if ((await tableCount(client, "enrollments")) === 0) {
    const enroll = await readJsonMaybe(ENROLLMENTS_JSON_PATH, {});
    if (enroll && typeof enroll === "object") {
      for (const [uid, ids] of Object.entries(enroll)) {
        const list = Array.isArray(ids) ? ids : [];
        await client.query(
          `INSERT INTO enrollments (user_id, data)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET data = excluded.data`,
          [String(uid), JSON.stringify(list)]
        );
      }
    }
  }

  if ((await tableCount(client, "educator_courses")) === 0) {
    const list = await readJsonMaybe(COURSES_JSON_PATH, []);
    if (Array.isArray(list)) {
      for (const c of list) {
        if (!c || typeof c !== "object") continue;
        const id = String(c.id || "").trim();
        if (!id) continue;
        await client.query(
          `INSERT INTO educator_courses (id, educator_id, status, updated_at, data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             educator_id = excluded.educator_id,
             status = excluded.status,
             updated_at = excluded.updated_at,
             data = excluded.data`,
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
  const connectionTimeoutMillis = intEnv("PG_CONNECT_TIMEOUT_MS", 8000);
  const queryTimeoutMillis = intEnv("PG_QUERY_TIMEOUT_MS", 15000);
  pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: intEnv("PGPORT", 5432),
    database: process.env.PGDATABASE || "eduspmhub",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: queryTimeoutMillis,
    ssl: false,
  });
  const client = await pool.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS enrollments (
      user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS educator_courses (
      id TEXT PRIMARY KEY,
      educator_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    )`
  );
  await client.query(
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
  await client.query(
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
  await client.query(
    `CREATE TABLE IF NOT EXISTS payment_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, event_id)
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expires_at BIGINT NOT NULL,
      data TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS tutoring_bookings (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      tutor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_start TEXT NOT NULL,
      scheduled_end TEXT NOT NULL,
      hours REAL NOT NULL,
      hourly_rate_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'myr',
      student_message TEXT,
      payment_id TEXT,
      tutor_notified_paid_at TEXT,
      student_notified_accepted_at TEXT,
      student_notified_complete_at TEXT,
      student_notified_declined_at TEXT,
      reminder_24h_sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS tutor_availability (
      id TEXT PRIMARY KEY,
      tutor_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_minutes INTEGER NOT NULL,
      end_minutes INTEGER NOT NULL
    )`
  );
  const bookingAlters = [
    "ALTER TABLE tutoring_bookings ADD COLUMN IF NOT EXISTS tutor_notified_paid_at TEXT",
    "ALTER TABLE tutoring_bookings ADD COLUMN IF NOT EXISTS student_notified_accepted_at TEXT",
    "ALTER TABLE tutoring_bookings ADD COLUMN IF NOT EXISTS student_notified_complete_at TEXT",
    "ALTER TABLE tutoring_bookings ADD COLUMN IF NOT EXISTS student_notified_declined_at TEXT",
    "ALTER TABLE tutoring_bookings ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TEXT",
  ];
  for (const sql of bookingAlters) {
    await client.query(sql);
  }
  await client.query(
    `CREATE TABLE IF NOT EXISTS tutor_reviews (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL UNIQUE,
      student_id TEXT NOT NULL,
      tutor_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      status TEXT NOT NULL,
      item_type TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'myr',
      condition TEXT NOT NULL DEFAULT '',
      pickup_area TEXT NOT NULL DEFAULT '',
      pickup_notes TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      form_level TEXT NOT NULL DEFAULT '',
      photo_keys TEXT NOT NULL DEFAULT '[]',
      digital_file_key TEXT NOT NULL DEFAULT '',
      digital_file_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sold_at TEXT
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS marketplace_reports (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      UNIQUE (listing_id, reporter_id)
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      status TEXT NOT NULL,
      item_type TEXT NOT NULL,
      title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'myr',
      payment_id TEXT,
      buyer_notes TEXT NOT NULL DEFAULT '',
      seller_ready_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await client.query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)");
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_educator_courses_owner ON educator_courses(educator_id)"
  );
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_unique_user_course ON purchase_items(user_id, course_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_purchase_items_user ON purchase_items(user_id)"
  );
  await client.query("CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)");
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_session ON payments(provider, provider_session_id)"
  );
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_intent ON payments(provider, provider_payment_intent_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_tutoring_bookings_student ON tutoring_bookings(student_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_tutoring_bookings_tutor ON tutoring_bookings(tutor_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_tutoring_bookings_status ON tutoring_bookings(status)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_tutor_reviews_tutor ON tutor_reviews(tutor_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_tutor_availability_tutor ON tutor_availability(tutor_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller ON marketplace_listings(seller_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status ON marketplace_listings(status)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer ON marketplace_orders(buyer_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_orders_seller ON marketplace_orders(seller_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_reports_listing ON marketplace_reports(listing_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_marketplace_reports_status ON marketplace_reports(status)"
  );

  await migrateLegacyJsonIfNeeded(client);
  await client.query(
    "DELETE FROM tutoring_bookings WHERE status IN ('awaiting_payment', 'cancelled')"
  );
  await client.query("DELETE FROM payments WHERE status = 'pending'");
  client.release();
  return pool;
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
