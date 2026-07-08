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

/**
 * Runs `fn` against a single client wrapped in BEGIN/COMMIT, rolling back on
 * error. Use whenever multiple statements must be applied atomically as a
 * unit (e.g. writes across more than one table that other reads join on).
 */
async function withTransaction(_db, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      run: async (sql, params = []) => {
        const res = await client.query(toPgParams(sql), params);
        return { ...res, changes: res.rowCount ?? 0 };
      },
      get: async (sql, params = []) => {
        const res = await client.query(toPgParams(sql), params);
        return res.rows[0] || null;
      },
      all: async (sql, params = []) => {
        const res = await client.query(toPgParams(sql), params);
        return res.rows;
      },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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

  if ((await tableCount(client, "course_enrollments")) === 0) {
    const enroll = await readJsonMaybe(ENROLLMENTS_JSON_PATH, {});
    if (enroll && typeof enroll === "object") {
      const now = new Date().toISOString();
      for (const [uid, ids] of Object.entries(enroll)) {
        const list = Array.isArray(ids) ? ids : [];
        for (const cid of list) {
          const courseId = String(cid || "").trim();
          if (!courseId) continue;
          await client.query(
            `INSERT INTO course_enrollments (user_id, course_id, enrolled_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, course_id) DO NOTHING`,
            [String(uid), courseId, now]
          );
        }
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

async function migrateCourseProgressCompletionsIfNeeded(client) {
  const cols = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'course_progress' AND column_name = 'completed_lessons'`
  );
  if (cols.rowCount === 0) return;

  const { rows } = await client.query(
    `SELECT user_id, course_id, completed_lessons, updated_at FROM course_progress`
  );
  for (const row of rows) {
    let arr = [];
    try {
      const parsed = JSON.parse(row.completed_lessons || "[]");
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
    for (const n of arr) {
      const idx = Number.parseInt(String(n), 10);
      if (!Number.isFinite(idx) || idx < 0) continue;
      await client.query(
        `INSERT INTO course_lesson_completions (user_id, course_id, lesson_index, completed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, course_id, lesson_index) DO NOTHING`,
        [row.user_id, row.course_id, idx, row.updated_at || new Date().toISOString()]
      );
    }
  }
  await client.query(`ALTER TABLE course_progress DROP COLUMN completed_lessons`);
}

async function migrateEnrollmentsTableIfNeeded(client) {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'enrollments'`
  );
  if (exists.rowCount === 0) return;

  const { rows } = await client.query(`SELECT user_id, data FROM enrollments`);
  const now = new Date().toISOString();
  for (const row of rows) {
    let list = [];
    try {
      const parsed = JSON.parse(row.data || "[]");
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
    for (const cid of list) {
      const courseId = String(cid || "").trim();
      if (!courseId) continue;
      await client.query(
        `INSERT INTO course_enrollments (user_id, course_id, enrolled_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [row.user_id, courseId, now]
      );
    }
  }
  await client.query(`DROP TABLE enrollments`);
}

function buildPoolConfig() {
  const connectionTimeoutMillis = intEnv("PG_CONNECT_TIMEOUT_MS", 8000);
  const queryTimeoutMillis = intEnv("PG_QUERY_TIMEOUT_MS", 15000);
  const common = {
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    statement_timeout: queryTimeoutMillis,
  };

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    const useSsl =
      process.env.PGSSLMODE !== "disable" &&
      !/localhost|127\.0\.0\.1/i.test(databaseUrl);
    return {
      ...common,
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    ...common,
    host: process.env.PGHOST || "localhost",
    port: intEnv("PGPORT", 5432),
    database: process.env.PGDATABASE || "eduspmhub",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    ssl: false,
  };
}

async function ensureDb() {
  pool = new Pool(buildPoolConfig());
  const client = await pool.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS course_enrollments (
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      enrolled_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course_id)
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS course_progress (
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      last_lesson_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course_id)
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS course_lesson_completions (
      user_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      lesson_index INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course_id, lesson_index)
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
  await client.query(
    `CREATE TABLE IF NOT EXISTS seller_balances (
      user_id TEXT PRIMARY KEY,
      available_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_earned_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS balance_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      reference_type TEXT NOT NULL DEFAULT '',
      reference_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      bank_name TEXT NOT NULL DEFAULT '',
      account_holder TEXT NOT NULL DEFAULT '',
      account_number TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      requested_at TEXT NOT NULL,
      processed_at TEXT
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
    "CREATE INDEX IF NOT EXISTS idx_course_progress_user ON course_progress(user_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_course_lesson_completions_user_course ON course_lesson_completions(user_id, course_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)"
  );
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
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_balance_tx_user ON balance_transactions(user_id)"
  );
  await client.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_tx_sale_order ON balance_transactions(reference_type, reference_id, type)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawal_requests(user_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status)"
  );

  await migrateLegacyJsonIfNeeded(client);
  await migrateCourseProgressCompletionsIfNeeded(client);
  await migrateEnrollmentsTableIfNeeded(client);
  await client.query(
    "DELETE FROM tutoring_bookings WHERE status IN ('awaiting_payment', 'cancelled')"
  );
  await client.query("DELETE FROM payments WHERE status = 'pending'");
  await client.query(
    "DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at < $1",
    [new Date().toISOString()]
  );
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
  withTransaction,
};
