import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCourseProgress,
  progressDto,
  markLessonProgress,
} from "../server/courseProgress.js";
import { getDb, sqlite } from "../server/sqlite.js";

test("computeCourseProgress calculates percent from completed lessons", () => {
  assert.deepEqual(computeCourseProgress([], 4), {
    completedCount: 0,
    totalLessons: 4,
    percent: 0,
  });
  assert.deepEqual(computeCourseProgress([0, 1], 4), {
    completedCount: 2,
    totalLessons: 4,
    percent: 50,
  });
  assert.deepEqual(computeCourseProgress([0, 1, 2, 3], 4), {
    completedCount: 4,
    totalLessons: 4,
    percent: 100,
  });
});

test("markLessonProgress stores progress per student and course", async () => {
  const userId = `student_${Date.now()}`;
  const courseId = `course_${Date.now()}`;

  const first = await markLessonProgress(userId, courseId, 0, 3);
  assert.equal(first.completedCount, 1);
  assert.equal(first.percent, 33);

  const second = await markLessonProgress(userId, courseId, 2, 3);
  assert.equal(second.completedCount, 2);
  assert.equal(second.percent, 67);
  assert.deepEqual(second.completedLessons, [0, 2]);

  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT completed_lessons FROM course_progress WHERE user_id = ? AND course_id = ?",
    [userId, courseId]
  );
  assert.ok(row);
  assert.deepEqual(progressDto(JSON.parse(row.completed_lessons), 3).completedLessons, [0, 2]);
});
