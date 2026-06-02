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

export async function replaceAvailabilityForTutor(tutorId, slots) {
  const db = await getDb();
  const normalized = [];
  for (const raw of slots || []) {
    const s = normalizeSlotInput(raw);
    if (!s) continue;
    normalized.push(s);
  }
  await sqlite.run(db, "DELETE FROM tutor_availability WHERE tutor_id = ?", [
    String(tutorId),
  ]);
  for (const s of normalized) {
    await sqlite.run(
      db,
      `INSERT INTO tutor_availability (id, tutor_id, day_of_week, start_minutes, end_minutes)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), String(tutorId), s.dayOfWeek, s.startMinutes, s.endMinutes]
    );
  }
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
