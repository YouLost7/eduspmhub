import { getDb, sqlite } from "../sqlite.js";
import { randomUUID } from "node:crypto";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(dayOfWeek) {
  return DAY_LABELS[Number(dayOfWeek)] || "?";
}

/** "09:30" -> minutes from midnight */
export function timeToMinutes(hhmm) {
  const m = String(hhmm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeSlotInput({ dayOfWeek, startTime, endTime }) {
  const dow = Number.parseInt(String(dayOfWeek), 10);
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (!Number.isFinite(dow) || dow < 0 || dow > 6) return null;
  if (start === null || end === null || end <= start) return null;
  if (end - start < 30) return null;
  return { dayOfWeek: dow, startMinutes: start, endMinutes: end };
}

function rowToSlot(row) {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    dayOfWeek: Number(row.day_of_week),
    dayLabel: dayLabel(row.day_of_week),
    startTime: minutesToTime(Number(row.start_minutes)),
    endTime: minutesToTime(Number(row.end_minutes)),
    startMinutes: Number(row.start_minutes),
    endMinutes: Number(row.end_minutes),
  };
}

export async function listAvailabilityForTutor(tutorId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT id, tutor_id, day_of_week, start_minutes, end_minutes
     FROM tutor_availability
     WHERE tutor_id = ?
     ORDER BY day_of_week ASC, start_minutes ASC`,
    [String(tutorId)]
  );
  return rows.map(rowToSlot);
}

const MAX_AVAILABILITY_SLOTS = 40;

/**
 * Batched version of `listAvailabilityForTutor` for N tutors in one query
 * instead of N — used by the tutoring browse list.
 */
export async function listAvailabilityForTutors(tutorIds) {
  const ids = [...new Set((tutorIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await sqlite.all(
    db,
    `SELECT id, tutor_id, day_of_week, start_minutes, end_minutes
       FROM tutor_availability
      WHERE tutor_id IN (${placeholders})
      ORDER BY tutor_id ASC, day_of_week ASC, start_minutes ASC`,
    ids
  );
  for (const row of rows) {
    const key = String(row.tutor_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rowToSlot(row));
  }
  return map;
}

export async function replaceAvailabilityForTutor(tutorId, slots) {
  const db = await getDb();
  const normalized = [];
  // Cap input size before doing any DB work — an unbounded array here would
  // otherwise let a single request queue up arbitrarily many DELETE+INSERT
  // statements.
  for (const raw of (slots || []).slice(0, MAX_AVAILABILITY_SLOTS)) {
    const s = normalizeSlotInput(raw);
    if (!s) continue;
    normalized.push(s);
  }
  // Wrapped in a transaction: without this, a crash or error partway
  // through leaves the tutor with only some (or none) of their windows
  // saved, since the old ones are already deleted by the time the inserts
  // run.
  await sqlite.withTransaction(db, async (tx) => {
    await tx.run("DELETE FROM tutor_availability WHERE tutor_id = ?", [String(tutorId)]);
    for (const s of normalized) {
      await tx.run(
        `INSERT INTO tutor_availability (id, tutor_id, day_of_week, start_minutes, end_minutes)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), String(tutorId), s.dayOfWeek, s.startMinutes, s.endMinutes]
      );
    }
  });
  return listAvailabilityForTutor(tutorId);
}

const SLOT_STEP_MIN = 30;
const MIN_LEAD_MS = 30 * 60 * 1000;
const DEFAULT_DAYS_AHEAD = 21;

function localSessionParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    dayOfWeek: d.getDay(),
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

async function listActiveBookingsForTutor(tutorId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT scheduled_start, scheduled_end
     FROM tutoring_bookings
     WHERE tutor_id = ?
       AND status IN ('paid', 'accepted')`,
    [String(tutorId)]
  );
  return rows.map((r) => ({
    startMs: new Date(r.scheduled_start).getTime(),
    endMs: new Date(r.scheduled_end).getTime(),
  }));
}

/** Concrete start times for the next N days that fit weekly windows and avoid conflicts. */
export async function listBookableSlots(tutorId, hours, daysAhead = DEFAULT_DAYS_AHEAD) {
  const durationMin = Math.round(Number(hours) * 60);
  if (!Number.isFinite(durationMin) || durationMin < 30) return [];

  const weekly = await listAvailabilityForTutor(tutorId);
  if (!weekly.length) return [];

  const bookings = await listActiveBookingsForTutor(tutorId);
  const minStart = Date.now() + MIN_LEAD_MS;
  const days = Math.min(Math.max(Number(daysAhead) || DEFAULT_DAYS_AHEAD, 1), 60);
  const out = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const dayBase = new Date();
    dayBase.setHours(0, 0, 0, 0);
    dayBase.setDate(dayBase.getDate() + dayOffset);
    const dow = dayBase.getDay();

    const windows = weekly.filter((s) => s.dayOfWeek === dow);
    for (const w of windows) {
      for (
        let startMin = w.startMinutes;
        startMin + durationMin <= w.endMinutes;
        startMin += SLOT_STEP_MIN
      ) {
        const start = new Date(dayBase);
        start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        const end = new Date(start.getTime() + durationMin * 60 * 1000);

        if (start.getTime() < minStart) continue;

        const conflict = bookings.some((b) =>
          rangesOverlap(start.getTime(), end.getTime(), b.startMs, b.endMs)
        );
        if (conflict) continue;

        out.push({
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          label: start.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          dayLabel: start.toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          dateKey: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
        });
      }
    }
  }

  return out;
}

/**
 * Atomically re-checks for booking conflicts and inserts the booking row in
 * one transaction, holding a Postgres advisory lock scoped to this tutor for
 * the duration. This is what actually prevents double-booking: the plain
 * `validateBookingAgainstAvailability` check below is a read that two
 * concurrent requests can both pass before either writes a booking row, so
 * it can't be relied on alone for the final reservation.
 */
export async function reserveTutoringBooking({
  tutorId,
  scheduledStart,
  scheduledEnd,
  insertParams,
}) {
  const db = await getDb();
  return sqlite.withTransaction(db, async (tx) => {
    // Released automatically at commit/rollback; serializes concurrent
    // booking attempts for the same tutor so only one can win the conflict
    // check below.
    await tx.run("SELECT pg_advisory_xact_lock(hashtext(?))", [String(tutorId)]);

    const conflicts = await tx.all(
      `SELECT id FROM tutoring_bookings
       WHERE tutor_id = ?
         AND status IN ('paid', 'accepted')
         AND scheduled_start < ?
         AND scheduled_end > ?`,
      [String(tutorId), String(scheduledEnd), String(scheduledStart)]
    );
    if (conflicts.length > 0) {
      return { ok: false, error: "That time slot is already booked. Choose another start time." };
    }

    const now = new Date().toISOString();
    const bookingId = insertParams.id || randomUUID();
    await tx.run(
      `INSERT INTO tutoring_bookings (
        id, student_id, tutor_id, status, scheduled_start, scheduled_end,
        hours, hourly_rate_cents, amount_cents, currency, student_message,
        payment_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'myr', ?, ?, ?, ?)`,
      [
        bookingId,
        String(insertParams.studentId),
        String(tutorId),
        insertParams.status,
        String(scheduledStart),
        String(scheduledEnd),
        Number(insertParams.hours),
        Number(insertParams.hourlyRateCents),
        Number(insertParams.amountCents),
        String(insertParams.studentMessage || "").slice(0, 2000),
        insertParams.paymentId ? String(insertParams.paymentId) : null,
        now,
        now,
      ]
    );
    return { ok: true, bookingId };
  });
}

/** Booking window must fit inside a weekly slot; no overlap with active bookings. */
export async function validateBookingAgainstAvailability(tutorId, scheduledStart, scheduledEnd) {
  const slots = await listAvailabilityForTutor(tutorId);
  if (slots.length === 0) {
    return {
      ok: false,
      error: "This tutor has not set weekly availability yet.",
    };
  }

  const startParts = localSessionParts(scheduledStart);
  const endParts = localSessionParts(scheduledEnd);
  if (!startParts || !endParts) {
    return { ok: false, error: "Invalid session time." };
  }
  if (startParts.dayOfWeek !== endParts.dayOfWeek) {
    return {
      ok: false,
      error: "Sessions must start and end on the same day (within one availability window).",
    };
  }

  const matching = slots.filter((s) => s.dayOfWeek === startParts.dayOfWeek);
  const fits = matching.some(
    (s) =>
      startParts.minutes >= s.startMinutes &&
      endParts.minutes <= s.endMinutes
  );
  if (!fits) {
    return {
      ok: false,
      error: `Session time is outside this tutor's availability (${matching.map((s) => `${s.startTime}–${s.endTime}`).join(", ") || "none"} on ${dayLabel(startParts.dayOfWeek)}).`,
    };
  }

  const db = await getDb();
  const conflicts = await sqlite.all(
    db,
    `SELECT id, scheduled_start, scheduled_end, status
     FROM tutoring_bookings
     WHERE tutor_id = ?
       AND status IN ('paid', 'accepted')
       AND scheduled_start < ?
       AND scheduled_end > ?`,
    [String(tutorId), String(scheduledEnd), String(scheduledStart)]
  );
  if (conflicts.length > 0) {
    return {
      ok: false,
      error: "That time slot is already booked. Choose another start time.",
    };
  }

  return { ok: true };
}
