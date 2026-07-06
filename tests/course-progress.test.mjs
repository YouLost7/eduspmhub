import test from "node:test";
import assert from "node:assert/strict";
import {
  computeCourseProgress,
  markLessonProgress,
  getCourseProgress,
  getCourseProgressMap,
  deleteCourseProgressForCourse,
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
  const rows = await sqlite.all(
    db,
    "SELECT lesson_index FROM course_lesson_completions WHERE user_id = ? AND course_id = ? ORDER BY lesson_index",
    [userId, courseId]
  );
  assert.deepEqual(rows.map((r) => Number(r.lesson_index)), [0, 2]);
});

test("getCourseProgress and getCourseProgressMap reflect a freshly marked lesson", async () => {
  const userId = `student_read_${Date.now()}`;
  const courseId = `course_read_${Date.now()}`;

  // Regression check: completions and the last-viewed marker live in
  // separate tables written in one transaction. Reads join off the marker
  // table, so a first-ever completion must still be visible immediately.
  await markLessonProgress(userId, courseId, 1, 4);

  const single = await getCourseProgress(userId, courseId);
  assert.deepEqual(single.completedLessons, [1]);
  assert.equal(single.lastLessonIndex, 1);

  const map = await getCourseProgressMap(userId, [courseId, "some-other-course"]);
  assert.deepEqual(map.get(courseId)?.completedLessons, [1]);
  assert.equal(map.has("some-other-course"), false);
});

test("deleteCourseProgressForCourse removes progress for all students on that course", async () => {
  const courseId = `course_deleted_${Date.now()}`;
  const studentA = `student_a_${Date.now()}`;
  const studentB = `student_b_${Date.now()}`;
  const otherCourseId = `course_untouched_${Date.now()}`;

  await markLessonProgress(studentA, courseId, 0, 3);
  await markLessonProgress(studentB, courseId, 1, 3);
  await markLessonProgress(studentA, otherCourseId, 0, 2);

  await deleteCourseProgressForCourse(courseId);

  assert.deepEqual((await getCourseProgress(studentA, courseId)).completedLessons, []);
  assert.deepEqual((await getCourseProgress(studentB, courseId)).completedLessons, []);
  // Progress on an unrelated course must be untouched.
  assert.deepEqual((await getCourseProgress(studentA, otherCourseId)).completedLessons, [0]);

  const db = await getDb();
  const leftoverCompletions = await sqlite.all(
    db,
    "SELECT 1 FROM course_lesson_completions WHERE course_id = ?",
    [courseId]
  );
  const leftoverProgress = await sqlite.all(
    db,
    "SELECT 1 FROM course_progress WHERE course_id = ?",
    [courseId]
  );
  assert.equal(leftoverCompletions.length, 0);
  assert.equal(leftoverProgress.length, 0);
});

test("markLessonProgress is safe under concurrent calls for different lessons", async () => {
  const userId = `student_concurrent_${Date.now()}`;
  const courseId = `course_concurrent_${Date.now()}`;

  const [a, b, c] = await Promise.all([
    markLessonProgress(userId, courseId, 0, 5),
    markLessonProgress(userId, courseId, 1, 5),
    markLessonProgress(userId, courseId, 2, 5),
  ]);
  const final = [a, b, c].sort((x, y) => y.completedCount - x.completedCount)[0];
  assert.deepEqual(final.completedLessons, [0, 1, 2]);
});
