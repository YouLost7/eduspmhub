import { getDb, sqlite } from "./sqlite.js";

export function computeCourseProgress(completedLessons, totalLessons) {
  const total = Math.max(0, Number(totalLessons) || 0);
  if (total === 0) {
    return { completedCount: 0, totalLessons: 0, percent: 0 };
  }
  const completedCount = completedLessons.filter((i) => i >= 0 && i < total).length;
  const percent = Math.min(100, Math.round((completedCount / total) * 100));
  return { completedCount, totalLessons: total, percent };
}

export function progressDto(completedLessons, totalLessons, lastLessonIndex = 0) {
  const stats = computeCourseProgress(completedLessons, totalLessons);
  return {
    completedLessons,
    lastLessonIndex: Number(lastLessonIndex) || 0,
    ...stats,
  };
}

const PROGRESS_WITH_COMPLETIONS_SELECT = `
  SELECT cp.course_id, cp.last_lesson_index, cp.updated_at,
         COALESCE(
           array_agg(clc.lesson_index ORDER BY clc.lesson_index)
             FILTER (WHERE clc.lesson_index IS NOT NULL),
           '{}'
         ) AS completed_lessons
    FROM course_progress cp
    LEFT JOIN course_lesson_completions clc
      ON clc.user_id = cp.user_id AND clc.course_id = cp.course_id
`;

export async function getCourseProgress(userId, courseId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `${PROGRESS_WITH_COMPLETIONS_SELECT}
      WHERE cp.user_id = ? AND cp.course_id = ?
      GROUP BY cp.course_id, cp.last_lesson_index, cp.updated_at
      LIMIT 1`,
    [String(userId), String(courseId)]
  );
  if (!row) {
    return { completedLessons: [], lastLessonIndex: 0, updatedAt: null };
  }
  return {
    completedLessons: (row.completed_lessons || []).map(Number),
    lastLessonIndex: Number(row.last_lesson_index) || 0,
    updatedAt: row.updated_at || null,
  };
}

export async function getCourseProgressMap(userId, courseIds) {
  const ids = [...new Set(courseIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await sqlite.all(
    db,
    `${PROGRESS_WITH_COMPLETIONS_SELECT}
      WHERE cp.user_id = ? AND cp.course_id IN (${placeholders})
      GROUP BY cp.course_id, cp.last_lesson_index, cp.updated_at`,
    [String(userId), ...ids]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.course_id), {
      completedLessons: (row.completed_lessons || []).map(Number),
      lastLessonIndex: Number(row.last_lesson_index) || 0,
      updatedAt: row.updated_at || null,
    });
  }
  return map;
}

export async function markLessonProgress(userId, courseId, lessonIndex, totalLessons) {
  const total = Math.max(1, Number(totalLessons) || 1);
  const idx = Number.parseInt(String(lessonIndex), 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= total) {
    throw new Error("Invalid lesson index");
  }
  const uid = String(userId);
  const cid = String(courseId);
  const now = new Date().toISOString();
  const db = await getDb();

  // Writes span two tables (completions + last-viewed marker), so they run in
  // a transaction: readers join off course_progress, and a crash between the
  // two inserts would otherwise leave a completion "invisible" to that join.
  // Within the transaction, each insert is still per-lesson atomic (ON
  // CONFLICT), so concurrent requests for different lessons never clobber
  // each other the way a read-modify-write of a JSON blob would.
  const completedArr = await sqlite.withTransaction(db, async (tx) => {
    await tx.run(
      `INSERT INTO course_lesson_completions (user_id, course_id, lesson_index, completed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, course_id, lesson_index) DO NOTHING`,
      [uid, cid, idx, now]
    );
    await tx.run(
      `INSERT INTO course_progress (user_id, course_id, last_lesson_index, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, course_id) DO UPDATE SET
         last_lesson_index = excluded.last_lesson_index,
         updated_at = excluded.updated_at`,
      [uid, cid, idx, now]
    );
    const completions = await tx.all(
      `SELECT lesson_index FROM course_lesson_completions
        WHERE user_id = ? AND course_id = ?
        ORDER BY lesson_index`,
      [uid, cid]
    );
    return completions.map((r) => Number(r.lesson_index)).filter((n) => n < total);
  });
  return progressDto(completedArr, total, idx);
}

/**
 * Removes all stored progress (for every student) for a course. Call this
 * when a course is permanently deleted so progress rows don't linger
 * indefinitely for an id that can no longer be looked up.
 */
export async function deleteCourseProgressForCourse(courseId) {
  const cid = String(courseId);
  const db = await getDb();
  await sqlite.withTransaction(db, async (tx) => {
    await tx.run(`DELETE FROM course_lesson_completions WHERE course_id = ?`, [cid]);
    await tx.run(`DELETE FROM course_progress WHERE course_id = ?`, [cid]);
  });
}
