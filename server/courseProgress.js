import { getDb, sqlite } from "./sqlite.js";

function parseCompletedLessons(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [
      ...new Set(
        arr
          .map((n) => Number.parseInt(String(n), 10))
          .filter((n) => Number.isFinite(n) && n >= 0)
      ),
    ].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

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

export async function getCourseProgress(userId, courseId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `SELECT completed_lessons, last_lesson_index, updated_at
       FROM course_progress
      WHERE user_id = ? AND course_id = ?
      LIMIT 1`,
    [String(userId), String(courseId)]
  );
  if (!row) {
    return { completedLessons: [], lastLessonIndex: 0, updatedAt: null };
  }
  return {
    completedLessons: parseCompletedLessons(row.completed_lessons),
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
    `SELECT course_id, completed_lessons, last_lesson_index, updated_at
       FROM course_progress
      WHERE user_id = ? AND course_id IN (${placeholders})`,
    [String(userId), ...ids]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.course_id), {
      completedLessons: parseCompletedLessons(row.completed_lessons),
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
  const existing = await getCourseProgress(userId, courseId);
  const completed = new Set(existing.completedLessons);
  completed.add(idx);
  const completedArr = [...completed].sort((a, b) => a - b);
  const now = new Date().toISOString();
  const db = await getDb();
  await sqlite.run(
    db,
    `INSERT INTO course_progress (
      user_id, course_id, completed_lessons, last_lesson_index, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, course_id) DO UPDATE SET
      completed_lessons = excluded.completed_lessons,
      last_lesson_index = excluded.last_lesson_index,
      updated_at = excluded.updated_at`,
    [String(userId), String(courseId), JSON.stringify(completedArr), idx, now]
  );
  return progressDto(completedArr, total, idx);
}
