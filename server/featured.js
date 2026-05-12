import { loadUsers, loadEnrollments, findUserById } from "./db.js";
import { loadEducatorCourses, mapPublishedToCatalogShape } from "./educatorCourses.js";

export async function getEnrollmentCounts() {
  const enroll = await loadEnrollments();
  const counts = {};
  for (const ids of Object.values(enroll)) {
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

const AVATAR_CYCLE = ["", "alt", "dark", "light", "cool", "rose"];

/**
 * Dashboard only: published tutor courses on this hub + real educator accounts.
 * No seeded catalogue rows and no synthetic ratings — counts come from stored data.
 *
 * @param {string | undefined} sessionUserId
 */
export async function buildFeaturedPayload(sessionUserId) {
  const users = await loadUsers();
  const counts = await getEnrollmentCounts();
  const me = sessionUserId ? findUserById(users, sessionUserId) : null;

  const ec = await loadEducatorCourses();
  const publishedEc = ec.filter((c) => c.status === "published");

  const publishedCourses = publishedEc.map((c) => {
    const owner = findUserById(users, c.educatorId);
    const row = mapPublishedToCatalogShape(c, owner?.fullName);
    return {
      ...row,
      enrollments: counts[c.id] || 0,
      meta: `${row.educator} • ${row.lessons} Lessons`,
    };
  });

  const scored = publishedCourses.map((c) => ({
    ...c,
    _score:
      (counts[c.id] || 0) * 3 +
      (me?.role === "student" &&
      me.studentSubject &&
      c.subject === me.studentSubject
        ? 45
        : 0),
  }));
  scored.sort((a, b) => b._score - a._score || a.title.localeCompare(b.title));
  const recommended = scored.slice(0, 3).map(({ _score, ...c }) => c);

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

  return { recommended, popular, topEducators };
}
