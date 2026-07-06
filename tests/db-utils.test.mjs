import test from "node:test";
import assert from "node:assert/strict";
import {
  loadUsers,
  insertUser,
  updateUser,
  loadEnrollments,
  addCourseEnrollment,
  removeCourseFromAllEnrollments,
  findUserById,
} from "../server/db.js";
import {
  loadEducatorCourses,
  upsertEducatorCourse,
  deleteEducatorCourseById,
} from "../server/educatorCourses.js";

function makeUser(overrides = {}) {
  const id = overrides.id || `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const email = overrides.email || `${id}@example.test`;
  return {
    passwordHash: "x",
    role: "student",
    verified: true,
    fullName: "Test Student",
    createdAt: new Date().toISOString(),
    ...overrides,
    id,
    email,
  };
}

test("insertUser + updateUser only touch their own row", async () => {
  const a = makeUser();
  const b = makeUser();
  await insertUser(a);
  await insertUser(b);

  a.fullName = "Updated Name";
  await updateUser(a);

  const users = await loadUsers();
  const storedA = findUserById(users, a.id);
  const storedB = findUserById(users, b.id);
  assert.equal(storedA.fullName, "Updated Name");
  assert.equal(storedB.fullName, "Test Student");
});

test("insertUser rejects a duplicate email with a Postgres unique_violation", async () => {
  const email = `dup_${Date.now()}@example.test`;
  await insertUser(makeUser({ email }));
  await assert.rejects(
    () => insertUser(makeUser({ email })),
    (err) => err.code === "23505"
  );
});

test("concurrent updateUser calls for different users never clobber each other", async () => {
  const users = await Promise.all([makeUser(), makeUser(), makeUser()].map(async (u) => {
    await insertUser(u);
    return u;
  }));

  await Promise.all(
    users.map((u, i) =>
      updateUser({ ...u, fullName: `Concurrent ${i}` })
    )
  );

  const all = await loadUsers();
  for (const [i, u] of users.entries()) {
    assert.equal(findUserById(all, u.id).fullName, `Concurrent ${i}`);
  }
});

test("addCourseEnrollment is additive and idempotent", async () => {
  const userId = `student_${Date.now()}`;
  const courseA = `course_a_${Date.now()}`;
  const courseB = `course_b_${Date.now()}`;

  await addCourseEnrollment(userId, courseA);
  await addCourseEnrollment(userId, courseB);
  await addCourseEnrollment(userId, courseA); // duplicate, should be a no-op

  const enroll = await loadEnrollments();
  assert.deepEqual([...enroll[userId]].sort(), [courseA, courseB].sort());
});

test("concurrent enrollments for different students never clobber each other", async () => {
  // Regression check: enrollments used to live as one JSON blob per user in
  // a table rewritten wholesale on every write (DELETE + re-INSERT of every
  // user's row). Two students enrolling at the same time could silently
  // lose one another's enrollment. Enrollments now live in a normalized
  // per-(user, course) table with atomic per-row inserts.
  const studentA = `student_a_${Date.now()}`;
  const studentB = `student_b_${Date.now()}`;
  const studentC = `student_c_${Date.now()}`;
  const courseId = `course_shared_${Date.now()}`;

  await Promise.all([
    addCourseEnrollment(studentA, courseId),
    addCourseEnrollment(studentB, courseId),
    addCourseEnrollment(studentC, courseId),
  ]);

  const enroll = await loadEnrollments();
  assert.deepEqual(enroll[studentA], [courseId]);
  assert.deepEqual(enroll[studentB], [courseId]);
  assert.deepEqual(enroll[studentC], [courseId]);
});

test("removeCourseFromAllEnrollments clears a course for every student without touching others", async () => {
  const studentA = `student_rm_a_${Date.now()}`;
  const studentB = `student_rm_b_${Date.now()}`;
  const removedCourse = `course_removed_${Date.now()}`;
  const keptCourse = `course_kept_${Date.now()}`;

  await addCourseEnrollment(studentA, removedCourse);
  await addCourseEnrollment(studentB, removedCourse);
  await addCourseEnrollment(studentA, keptCourse);

  await removeCourseFromAllEnrollments(removedCourse);

  const enroll = await loadEnrollments();
  assert.deepEqual(enroll[studentA], [keptCourse]);
  assert.equal(enroll[studentB], undefined);
});

test("upsertEducatorCourse creates then updates a single course row", async () => {
  const courseId = `ec_${Date.now()}`;
  const course = {
    id: courseId,
    educatorId: "edu_1",
    title: "Original title",
    status: "draft",
    lessons: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await upsertEducatorCourse(course);

  const afterCreate = await loadEducatorCourses();
  assert.equal(afterCreate.find((c) => c.id === courseId)?.title, "Original title");

  await upsertEducatorCourse({ ...course, title: "Updated title", status: "published" });
  const afterUpdate = await loadEducatorCourses();
  const stored = afterUpdate.find((c) => c.id === courseId);
  assert.equal(stored.title, "Updated title");
  assert.equal(stored.status, "published");
  // Upserting must not disturb any other course in the table.
  assert.equal(afterUpdate.length, afterCreate.length);
});

test("deleteEducatorCourseById removes only the targeted course", async () => {
  const keepId = `ec_keep_${Date.now()}`;
  const removeId = `ec_remove_${Date.now()}`;
  await upsertEducatorCourse({
    id: keepId,
    educatorId: "edu_1",
    title: "Keep me",
    status: "draft",
    lessons: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await upsertEducatorCourse({
    id: removeId,
    educatorId: "edu_1",
    title: "Remove me",
    status: "draft",
    lessons: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await deleteEducatorCourseById(removeId);

  const list = await loadEducatorCourses();
  assert.ok(list.some((c) => c.id === keepId));
  assert.ok(!list.some((c) => c.id === removeId));
});
