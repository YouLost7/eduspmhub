import { loadUsers, loadEnrollments, findUserById } from "./db.js";
import { loadEducatorCourses, mapPublishedToCatalogShape } from "./educatorCourses.js";
import { listPurchasedCourseIds } from "./payments/store.js";

export async function getEnrollmentCounts(enroll = null) {
  const rows = enroll || (await loadEnrollments());
  const counts = {};
  for (const ids of Object.values(rows)) {
    for (const id of ids) {
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  return counts;
}

function hashId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function scoreRandomJitter(seed) {
  const h = hashId(String(seed || ""));
  return (h % 1000) / 1000;
}

function buildRecommendationReason({
  me,
  subjectBoost,
  educatorBoost,
  peerBoost,
  enrollmentCount,
}) {
  if (peerBoost > 0) {
    return {
      key: "peer_school",
      text: "Popular with students from your school",
    };
  }
  if (subjectBoost >= 40) {
    return {
      key: "subject_strong",
      text: "Strong match with your selected subject",
    };
  }
  if (subjectBoost > 0) {
    return {
      key: "subject_related",
      text: "Matches subjects you are studying",
    };
  }
  if (educatorBoost > 0) {
    return {
      key: "educator_affinity",
      text: "From an educator you learned from before",
    };
  }
  if (enrollmentCount >= 3) {
    return {
      key: "trending",
      text: "Trending with many learners",
    };
  }
  if (me?.role === "student") {
    return {
      key: "explore",
      text: "Picked to diversify your study plan",
    };
  }
  return {
    key: "activity",
    text: "Recommended from recent learner activity",
  };
}

function buildSubjectAffinityMap({
  me,
  meCourseIds,
  courseById,
}) {
  const subjectScore = new Map();
  if (me?.role === "student" && me.studentSubject) {
    subjectScore.set(me.studentSubject, 4);
  }
  for (const cid of meCourseIds) {
    const c = courseById.get(cid);
    if (!c) continue;
    const prev = subjectScore.get(c.subject) || 0;
    subjectScore.set(c.subject, prev + 3);
  }
  return subjectScore;
}

function buildEducatorAffinityMap({ meCourseIds, courseById }) {
  const educatorScore = new Map();
  for (const cid of meCourseIds) {
    const c = courseById.get(cid);
    if (!c || !c.educatorId) continue;
    const prev = educatorScore.get(c.educatorId) || 0;
    educatorScore.set(c.educatorId, prev + 2);
  }
  return educatorScore;
}

function buildPeerSchoolCounts({ users, enroll, me, meCourseIds }) {
  const out = new Map();
  if (!me || me.role !== "student" || !String(me.schoolName || "").trim()) return out;
  const mySchool = String(me.schoolName || "").trim();
  for (const [uid, ids] of Object.entries(enroll)) {
    if (uid === me.id || !Array.isArray(ids) || ids.length === 0) continue;
    const u = findUserById(users, uid);
    if (!u || u.role !== "student") continue;
    if (String(u.schoolName || "").trim() !== mySchool) continue;
    for (const cid of ids) {
      if (meCourseIds.has(cid)) continue;
      out.set(cid, (out.get(cid) || 0) + 1);
    }
  }
  return out;
}

function buildRecommendedCourses({
  me,
  meCourseIds,
  publishedCourses,
  counts,
  courseById,
  users,
  enroll,
  includeDebug = false,
}) {
  if (publishedCourses.length === 0) return [];

  const subjectAffinity = buildSubjectAffinityMap({
    me,
    meCourseIds,
    courseById,
  });
  const educatorAffinity = buildEducatorAffinityMap({ meCourseIds, courseById });
  const peerSchoolCounts = buildPeerSchoolCounts({
    users,
    enroll,
    me,
    meCourseIds,
  });
  const meSeed = String(me?.id || "guest");
  const topPopularIds = new Set(
    [...publishedCourses]
      .sort(
        (a, b) =>
          (counts[b.id] || 0) - (counts[a.id] || 0) ||
          a.title.localeCompare(b.title)
      )
      .slice(0, 6)
      .map((c) => c.id)
  );

  const scored = publishedCourses.map((c) => {
    const enrollmentCount = counts[c.id] || 0;
    const popularity =
      Math.log1p(enrollmentCount) * (me?.role === "student" ? 1.4 : 8);
    const subjectBoost = (subjectAffinity.get(c.subject) || 0) * 10;
    const educatorBoost = (educatorAffinity.get(c.educatorId) || 0) * 7;
    const peerBoost = (peerSchoolCounts.get(c.id) || 0) * 5;
    const personalization = subjectBoost * 1.25 + educatorBoost * 1.1 + peerBoost * 1.35;
    const hasPersonalSignal = personalization > 0;
    const isTopPopular = topPopularIds.has(c.id);
    const popularNoPersonalPenalty =
      me?.role === "student" && isTopPopular && !hasPersonalSignal ? 120 : 0;
    const isAlreadyTaken = meCourseIds.has(c.id);
    const repeatPenalty = isAlreadyTaken ? 1000 : 0;
    const exploration = scoreRandomJitter(`${meSeed}:${c.id}`) * 2.25;
    const score =
      personalization +
      popularity +
      exploration -
      repeatPenalty -
      popularNoPersonalPenalty;
    const recommendationReason = buildRecommendationReason({
      me,
      subjectBoost,
      educatorBoost,
      peerBoost,
      enrollmentCount,
    });
    return {
      ...c,
      recommendationReason: recommendationReason.text,
      recommendationReasonKey: recommendationReason.key,
      _score: score,
      _alreadyTaken: isAlreadyTaken,
      _hasPersonalSignal: hasPersonalSignal,
      _isTopPopular: isTopPopular,
    };
  });

  scored.sort((a, b) => b._score - a._score || a.title.localeCompare(b.title));
  const unseen = scored.filter((c) => !c._alreadyTaken);
  const filteredForStudents =
    me?.role === "student"
      ? unseen.filter((c) => !c._isTopPopular || c._hasPersonalSignal)
      : unseen;
  const pool = filteredForStudents.length >= 3 ? filteredForStudents : unseen;
  const picked = pool.length >= 3 ? pool.slice(0, 3) : scored.slice(0, 3);
  const pickedIds = new Set(picked.map((x) => x.id));
  const recommended = picked.map((entry) => {
    const copy = { ...entry };
    delete copy._score;
    delete copy._alreadyTaken;
    delete copy._hasPersonalSignal;
    delete copy._isTopPopular;
    return copy;
  });
  if (!includeDebug) return { recommended, debug: null };

  const debug = scored.slice(0, 12).map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    enrollments: counts[row.id] || 0,
    score: Number(row._score.toFixed(3)),
    reason: row.recommendationReason,
    reasonKey: row.recommendationReasonKey,
    includedInRecommended: pickedIds.has(row.id),
    alreadyTaken: row._alreadyTaken,
    topPopular: row._isTopPopular,
    hasPersonalSignal: row._hasPersonalSignal,
  }));
  return { recommended, debug };
}

const AVATAR_CYCLE = ["", "alt", "dark", "light", "cool", "rose"];

/**
 * Dashboard only: published tutor courses on this hub + real educator accounts.
 * No seeded catalogue rows and no synthetic ratings — counts come from stored data.
 *
 * @param {string | undefined} sessionUserId
 */
export async function buildFeaturedPayload(sessionUserId, options = {}) {
  const includeDebug = Boolean(options?.includeDebug);
  const users = await loadUsers();
  const enroll = await loadEnrollments();
  const counts = await getEnrollmentCounts(enroll);
  const me = sessionUserId ? findUserById(users, sessionUserId) : null;
  const myEnrolledIds = me ? new Set(enroll[me.id] || []) : new Set();
  let purchasedIds = [];
  if (me?.role === "student") {
    purchasedIds = await listPurchasedCourseIds(me.id);
  }
  const meCourseIds = new Set([...myEnrolledIds, ...purchasedIds]);

  const ec = await loadEducatorCourses();
  const publishedEc = ec.filter((c) => c.status === "published");

  const publishedCourses = publishedEc.map((c) => {
    const owner = findUserById(users, c.educatorId);
    const row = mapPublishedToCatalogShape(c, owner?.fullName);
    return {
      ...row,
      educatorId: c.educatorId,
      enrollments: counts[c.id] || 0,
      meta: `${row.educator} • ${row.lessons} Lessons`,
    };
  });
  const courseById = new Map(publishedCourses.map((c) => [c.id, c]));
  const { recommended, debug } = buildRecommendedCourses({
    me,
    meCourseIds,
    publishedCourses,
    counts,
    courseById,
    users,
    enroll,
    includeDebug,
  });

  const popular = [...publishedCourses]
    .sort(
      (a, b) =>
        b.enrollments - a.enrollments || a.title.localeCompare(b.title)
    )
    .slice(0, 6);

  const publishedCountByEducator = {};
  for (const c of publishedEc) {
    publishedCountByEducator[c.educatorId] =
      (publishedCountByEducator[c.educatorId] || 0) + 1;
  }

  const topEducators = users
    .filter((u) => u.role === "educator")
    .map((u) => {
      const h = hashId(u.id);
      return {
        id: u.id,
        name: u.fullName,
        subject: u.educatorSubject || "SPM",
        institution: u.educatorInstitution || "Malaysia",
        publishedCourses: publishedCountByEducator[u.id] || 0,
        hasProfilePhoto: Boolean(u.avatarStorageKey),
        avatarUploadedAt: u.avatarUploadedAt || null,
        avatarClass: AVATAR_CYCLE[h % AVATAR_CYCLE.length],
        browseQuery: `subject=${encodeURIComponent(u.educatorSubject || "Mathematics")}`,
        source: u.verified ? "platform" : "platform_pending",
        badge: u.verified ? "Verified on EduSPM Hub" : "Verification pending",
      };
    })
    .sort((a, b) => {
      const av = a.source === "platform" ? 1 : 0;
      const bv = b.source === "platform" ? 1 : 0;
      if (bv !== av) return bv - av;
      if (b.publishedCourses !== a.publishedCourses) {
        return b.publishedCourses - a.publishedCourses;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);

  return {
    recommended,
    popular,
    topEducators,
    ...(includeDebug ? { recommendationDebug: debug || [] } : {}),
  };
}
