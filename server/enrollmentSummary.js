import { findUserById } from "./db.js";

/**
 * Students enrolled in this educator's courses only (no cross-tutor leakage).
 * @param {string} educatorId
 * @param {object[]} ecList
 * @param {Record<string, string[]>} enroll
 * @param {object[]} users
 */
export function getEducatorCourseEnrollmentsSummary(educatorId, ecList, enroll, users) {
  const owned = ecList.filter((c) => c.educatorId === educatorId);
  const myCourseIds = new Set(owned.map((c) => c.id));
  /** @type {Record<string, { students: object[] }>} */
  const byCourse = {};
  for (const c of owned) {
    byCourse[c.id] = { students: [] };
  }
  for (const [studentId, courseIds] of Object.entries(enroll)) {
    if (!Array.isArray(courseIds)) continue;
    const student = findUserById(users, studentId);
    if (!student || student.role !== "student") continue;
    const row = {
      id: student.id,
      fullName: String(student.fullName || "").trim(),
      email: student.email || "",
      schoolName: String(student.schoolName || "").trim(),
      studentForm: String(student.studentForm || "").trim(),
      studentSubject: String(student.studentSubject || "").trim(),
    };
    for (const cid of courseIds) {
      if (!myCourseIds.has(cid) || !byCourse[cid]) continue;
      if (byCourse[cid].students.some((s) => s.id === student.id)) continue;
      byCourse[cid].students.push({ ...row });
    }
  }
  return owned.map((c) => {
    const students = (byCourse[c.id]?.students || []).slice();
    students.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      courseId: c.id,
      title: c.title,
      status: c.status,
      studentCount: students.length,
      students,
    };
  });
}
