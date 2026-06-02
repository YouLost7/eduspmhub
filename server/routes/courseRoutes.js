import {
  hasPurchaseEntitlement,
  listPurchasedCourseIds,
  priceToCents,
} from "../payments/store.js";

export function registerCourseRoutes(app, deps) {
  const {
    requireAuth,
    CATALOG,
    loadUsers,
    loadEnrollments,
    saveEnrollments,
    loadEducatorCourses,
    findUserById,
    toPublicTutorProfile,
    mapPublishedToCatalogShape,
    getMergedPublicCourses,
    resolveStudentEnrolledCourseRow,
    getEducatorCourseEnrollmentsSummary,
    mapToManagedRow,
    courseAccessContext,
    lessonStreamAccess,
    normalizeLessonPages,
    isSafeLessonPdfKey,
    isSafeLessonVideoKey,
    LESSON_PDF_DIR,
    LESSON_VIDEO_DIR,
    existsSync,
    path,
    lessonVideoContentType,
    isValidEmbedObject,
    LESSON_MEDIA_TOKEN_TTL_SEC,
    signLessonStreamToken,
  } = deps;

  const CATALOG_COURSE_BLURB =
    "Curated SPM module on EduSPM Hub. Enrol to save it under My courses and keep your revision on track.";

  /** Public tutor card for signed-in learners — no email; lists published courses only. */
  app.get("/api/tutors/:userId", requireAuth, async (req, res) => {
    try {
      const userId =
        typeof req.params.userId === "string" ? req.params.userId.trim() : req.params.userId;
      const users = await loadUsers();
      const u = findUserById(users, userId);
      if (!u || u.role !== "educator") {
        return res.status(404).json({ error: "Tutor not found" });
      }
      const { getTutorReviewStats, listReviewsForTutor } = await import("../tutoring/store.js");
      const stats = await getTutorReviewStats(u.id);
      const tutor = toPublicTutorProfile(u);
      if (!tutor) {
        return res.status(404).json({ error: "Tutor not found" });
      }
      const reviews = await listReviewsForTutor(u.id, 12);
      const { listAvailabilityForTutor } = await import("../tutoring/availability.js");
      const availability = await listAvailabilityForTutor(u.id);
      const ec = await loadEducatorCourses();
      const published = ec.filter((c) => c.educatorId === u.id && c.status === "published");
      const courses = published.map((c) => mapPublishedToCatalogShape(c, u.fullName));
      res.json({
        tutor: {
          ...tutor,
          reviewCount: stats.reviewCount,
          averageRating: stats.averageRating,
        },
        courses,
        reviews,
        availability,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load tutor profile" });
    }
  });

  app.get("/api/courses", async (_req, res) => {
    try {
      const users = await loadUsers();
      const courses = await getMergedPublicCourses(users);
      const fromBuiltInCatalog = courses.filter((c) => c.source === "catalog").length;
      const fromEducators = courses.filter((c) => c.source === "educator").length;
      res.json({
        courses,
        stats: { fromBuiltInCatalog, fromEducators },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load courses" });
    }
  });

  app.get("/api/courses/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const built = CATALOG.find((c) => c.id === id);
      if (built) {
        return res.json({
          course: {
            ...built,
            source: "catalog",
            description: CATALOG_COURSE_BLURB,
          },
        });
      }
      const users = await loadUsers();
      const list = await loadEducatorCourses();
      const c = list.find((x) => x.id === id);
      if (!c || c.status !== "published") {
        return res.status(404).json({ error: "Course not found" });
      }
      const owner = findUserById(users, c.educatorId);
      const row = mapPublishedToCatalogShape(c, owner?.fullName);
      res.json({
        course: {
          ...row,
          description:
            c.description?.trim() ||
            "Tutor-published SPM course on EduSPM Hub. Enrol to add it to your study plan.",
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load course" });
    }
  });

  app.get("/api/my-courses", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (u?.role === "educator") {
        const ecList = await loadEducatorCourses();
        const list = ecList.filter((c) => c.educatorId === u.id);
        list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const enroll = await loadEnrollments();
        const summary = getEducatorCourseEnrollmentsSummary(u.id, ecList, enroll, users);
        const byCourseId = new Map(summary.map((row) => [row.courseId, row]));
        return res.json({
          courses: list.map((c) => {
            const row = byCourseId.get(c.id);
            return {
              ...mapToManagedRow(c, u.fullName),
              enrollmentStudentCount: row?.studentCount ?? 0,
              enrollmentStudents: row?.students ?? [],
            };
          }),
        });
      }
      const enroll = await loadEnrollments();
      const ids = enroll[req.session.userId] || [];
      const purchasedIds = await listPurchasedCourseIds(req.session.userId);
      const mergedIds = [...new Set([...ids, ...purchasedIds])];
      const ecList = await loadEducatorCourses();
      const courses = [];
      for (const id of mergedIds) {
        const row = await resolveStudentEnrolledCourseRow(id, users, ecList);
        if (row) courses.push(row);
      }
      res.json({ courses });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load courses" });
    }
  });

  /** Short-lived signed URL for embedded PDF/video (same session user only; expires after TTL). */
  app.get("/api/course-access/:courseId/lesson-stream-url", requireAuth, async (req, res) => {
    try {
      const courseId =
        typeof req.params.courseId === "string"
          ? req.params.courseId.trim()
          : req.params.courseId;
      const ctx = await courseAccessContext(req.session.userId, courseId);
      if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
      const lessonIndex = Number.parseInt(String(req.query.lesson ?? ""), 10);
      const kind = String(req.query.kind || "").toLowerCase();
      if (kind !== "pdf" && kind !== "video") {
        return res.status(400).json({ error: "kind must be pdf or video" });
      }
      const { course } = ctx;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const row = pages[lessonIndex];
      const okPdf = kind === "pdf" && row?.pdfKey && isSafeLessonPdfKey(row.pdfKey);
      const okVid = kind === "video" && row?.videoKey && isSafeLessonVideoKey(row.videoKey);
      if (!okPdf && !okVid) {
        return res.status(404).json({
          error: kind === "pdf" ? "No PDF for this lesson" : "No video for this lesson",
        });
      }
      const exp = Math.floor(Date.now() / 1000) + LESSON_MEDIA_TOKEN_TTL_SEC;
      const token = signLessonStreamToken({
        uid: req.session.userId,
        cid: course.id,
        li: lessonIndex,
        kind,
        exp,
      });
      const sub = kind === "pdf" ? "pdf" : "video";
      const p = `/api/course-access/${encodeURIComponent(course.id)}/lessons/${lessonIndex}/${sub}?st=${encodeURIComponent(token)}`;
      res.json({
        url: p,
        expiresInSec: LESSON_MEDIA_TOKEN_TTL_SEC,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not issue stream URL" });
    }
  });

  /** Inline PDF for a lesson (same auth as course access). */
  app.get("/api/course-access/:courseId/lessons/:lessonIndex/pdf", requireAuth, async (req, res) => {
    try {
      const courseId =
        typeof req.params.courseId === "string"
          ? req.params.courseId.trim()
          : req.params.courseId;
      const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
      const ctx = await lessonStreamAccess(req, courseId, lessonIndex, "pdf");
      if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
      const { course } = ctx;
      if (
        !Number.isFinite(lessonIndex) ||
        lessonIndex < 0 ||
        lessonIndex >= course.lessons
      ) {
        return res.status(400).json({ error: "Invalid lesson index" });
      }
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const row = pages[lessonIndex];
      const key = row?.pdfKey;
      if (!key || !isSafeLessonPdfKey(key)) {
        return res.status(404).json({ error: "No PDF for this lesson" });
      }
      const abs = path.join(LESSON_PDF_DIR, key);
      if (!existsSync(abs)) return res.status(404).json({ error: "File missing" });
      const rawName = row.pdfOriginalName || "lesson.pdf";
      const asciiName =
        String(rawName)
          .replace(/[^\w.\- ()]+/g, "_")
          .slice(0, 120) || "lesson.pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${asciiName}"`);
      res.sendFile(path.resolve(abs));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load PDF" });
    }
  });

  /** Inline lesson video (same auth as course access; Range requests supported for seeking). */
  app.get(
    "/api/course-access/:courseId/lessons/:lessonIndex/video",
    requireAuth,
    async (req, res) => {
      try {
        const courseId =
          typeof req.params.courseId === "string"
            ? req.params.courseId.trim()
            : req.params.courseId;
        const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
        const ctx = await lessonStreamAccess(req, courseId, lessonIndex, "video");
        if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
        const { course } = ctx;
        if (
          !Number.isFinite(lessonIndex) ||
          lessonIndex < 0 ||
          lessonIndex >= course.lessons
        ) {
          return res.status(400).json({ error: "Invalid lesson index" });
        }
        const pages = normalizeLessonPages(course.lessonPages, course.lessons);
        const row = pages[lessonIndex];
        const key = row?.videoKey;
        if (!key || !isSafeLessonVideoKey(key)) {
          return res.status(404).json({ error: "No video for this lesson" });
        }
        const abs = path.join(LESSON_VIDEO_DIR, key);
        if (!existsSync(abs)) return res.status(404).json({ error: "File missing" });
        const rawName = row.videoOriginalName || "lesson.mp4";
        const asciiName =
          String(rawName)
            .replace(/[^\w.\- ()]+/g, "_")
            .slice(0, 120) || "lesson.mp4";
        res.setHeader("Content-Type", lessonVideoContentType(key));
        res.setHeader("Content-Disposition", `inline; filename="${asciiName}"`);
        res.sendFile(path.resolve(abs));
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load video" });
      }
    }
  );

  /** Full lesson content: enrolled students (published) or the owning educator (any status). */
  app.get("/api/course-access/:courseId", requireAuth, async (req, res) => {
    try {
      const courseId = req.params.courseId;
      const ctx = await courseAccessContext(req.session.userId, courseId);
      if (ctx.err) return res.status(ctx.err).json({ error: ctx.msg });
      const { course } = ctx;
      const users = await loadUsers();
      const owner = findUserById(users, course.educatorId);
      const pages = normalizeLessonPages(course.lessonPages, course.lessons);
      const lessonPages = pages.map((p) => {
        const ev = p.embedVideo;
        const hasExternal = isValidEmbedObject(ev);
        let externalVideoUrl = "";
        if (hasExternal && ev.provider === "youtube") {
          externalVideoUrl = `https://www.youtube.com/watch?v=${ev.id}`;
        } else if (hasExternal && ev.provider === "vimeo") {
          externalVideoUrl = `https://vimeo.com/${ev.id}`;
        }
        return {
          title: p.title,
          body: p.body,
          hasPdf: Boolean(p.pdfKey),
          pdfOriginalName: p.pdfOriginalName || "",
          hasVideo: Boolean(p.videoKey),
          videoOriginalName: p.videoOriginalName || "",
          hasExternalVideo: hasExternal,
          externalVideoProvider: hasExternal ? ev.provider : "",
          externalVideoId: hasExternal ? ev.id : "",
          externalVideoUrl,
        };
      });
      res.json({
        course: {
          id: course.id,
          title: course.title,
          subject: course.subject,
          description: course.description || "",
          lessons: course.lessons,
          price: course.price,
          thumb: course.thumb || "",
          status: course.status,
          educator: owner?.fullName || "Educator",
          educatorId: course.educatorId,
          source: "educator",
        },
        lessonPages,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load course" });
    }
  });

  app.post("/api/my-courses/enroll", requireAuth, async (req, res) => {
    try {
      const { courseId } = req.body;
      if (!courseId) {
        return res.status(400).json({ error: "courseId required" });
      }
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (u?.role !== "student") {
        return res.status(403).json({ error: "Only students can enrol in courses" });
      }
      const ecList = await loadEducatorCourses();
      const row = await resolveStudentEnrolledCourseRow(courseId, users, ecList);
      if (!row) {
        return res.status(400).json({ error: "Invalid or unpublished course" });
      }
      const isPaidCourse = priceToCents(row.price) > 0;
      if (isPaidCourse && !(await hasPurchaseEntitlement(req.session.userId, courseId))) {
        return res.status(402).json({
          error:
            "This course requires payment before enrolment. Use the Buy now flow to complete checkout.",
          code: "PAYMENT_REQUIRED",
        });
      }
      const enroll = await loadEnrollments();
      const list = enroll[req.session.userId] || [];
      if (!list.includes(courseId)) {
        list.push(courseId);
        enroll[req.session.userId] = list;
        await saveEnrollments(enroll);
      }
      const courses = [];
      for (const id of list) {
        const r = await resolveStudentEnrolledCourseRow(id, users, ecList);
        if (r) courses.push(r);
      }
      res.json({ courses });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Enrol failed" });
    }
  });
}
