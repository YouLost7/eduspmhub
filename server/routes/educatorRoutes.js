export function registerEducatorRoutes(app, deps) {
  const {
    requireAuth,
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    runLessonPdfUpload,
    runLessonVideoUpload,
    loadUsers,
    loadEnrollments,
    loadEducatorCourses,
    saveEducatorCourses,
    findUserById,
    getEducatorCourseEnrollmentsSummary,
    mapToManagedRow,
    normalizePrice,
    clampLessons,
    normalizeLessonPages,
    parseExternalVideoUrl,
    isSafeLessonPdfKey,
    isSafeLessonVideoKey,
    unlinkLessonPdfFile,
    unlinkLessonVideoFile,
    unlinkOrphanedLessonFiles,
    unlinkCourseLessonAttachments,
    removeCourseIdFromEnrollments,
    randomUUID,
    unlink,
  } = deps;

  app.get("/api/educator/course-enrollments", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u || u.role !== "educator") {
        return res.status(403).json({ error: "Educator access only" });
      }
      const ecList = await loadEducatorCourses();
      const enroll = await loadEnrollments();
      const courses = getEducatorCourseEnrollmentsSummary(u.id, ecList, enroll, users);
      res.json({ courses });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load enrolments" });
    }
  });

  app.get("/api/educator/status", requireAuth, async (req, res) => {
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (!u || u.role !== "educator") {
      return res.status(403).json({ error: "Not an educator" });
    }
    res.json({
      verified: Boolean(u.verified),
      canAddCourse: Boolean(u.verified),
      canPublish: Boolean(u.verified),
      hasLicenseDocument: Boolean(u.licenseStorageKey),
    });
  });

  app.post("/api/educator/courses", requireEducatorVerified, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      const {
        title,
        description = "",
        subject,
        price,
        lessons = 1,
        thumb = "",
        status = "draft",
      } = req.body || {};
      const t = String(title || "").trim();
      if (!t) return res.status(400).json({ error: "Title is required" });
      const subj = String(subject || "").trim();
      if (!subj) return res.status(400).json({ error: "Subject is required" });
      let st = String(status || "draft").toLowerCase();
      if (st !== "draft" && st !== "published") st = "draft";
      const now = new Date().toISOString();
      const lessonsN = clampLessons(lessons);
      const course = {
        id: randomUUID(),
        educatorId: u.id,
        title: t.slice(0, 200),
        description: String(description || "").slice(0, 8000),
        subject: subj.slice(0, 120),
        price: normalizePrice(price),
        lessons: lessonsN,
        lessonPages: normalizeLessonPages(req.body?.lessonPages, lessonsN),
        thumb: String(thumb || "").slice(0, 24),
        status: st,
        createdAt: now,
        updatedAt: now,
      };
      const list = await loadEducatorCourses();
      list.push(course);
      await saveEducatorCourses(list);
      res.status(201).json({ course: mapToManagedRow(course, u.fullName) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not create course" });
    }
  });

  app.patch(
    "/api/educator/courses/:id",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    async (req, res) => {
      try {
        const { title, description, subject, price, lessons, thumb, status, lessonPages } =
          req.body || {};
        const list = req.ecList;
        const course = req.ecCourse;
        const idx = list.findIndex((c) => c.id === course.id);
        if (idx === -1) {
          console.error("PATCH educator course: course missing from list", course.id);
          return res
            .status(500)
            .json({ error: "Server could not update course (store mismatch)" });
        }
        const mergeMediaFrom = [...(course.lessonPages || [])];
        if (title != null) {
          const nt = String(title).trim();
          if (nt) course.title = nt.slice(0, 200);
        }
        if (description != null) course.description = String(description).slice(0, 8000);
        if (subject != null) {
          const ns = String(subject).trim();
          if (ns) course.subject = ns.slice(0, 120);
        }
        if (price != null) course.price = normalizePrice(price);
        if (lessons != null) {
          const newN = clampLessons(lessons);
          const oldPages = mergeMediaFrom;
          if (newN < oldPages.length) {
            for (let j = newN; j < oldPages.length; j++) {
              await unlinkLessonPdfFile(oldPages[j]?.pdfKey);
              await unlinkLessonVideoFile(oldPages[j]?.videoKey);
            }
          }
          course.lessons = newN;
        }
        if (thumb != null) course.thumb = String(thumb).slice(0, 24);
        if (status != null) {
          const s = String(status).toLowerCase();
          if (s === "draft" || s === "published") course.status = s;
        }
        if (lessonPages != null) {
          const lpArr = Array.isArray(lessonPages) ? lessonPages : [];
          for (let i = 0; i < lpArr.length; i++) {
            const cell = lpArr[i];
            if (cell && Object.prototype.hasOwnProperty.call(cell, "externalVideoUrl")) {
              const t = String(cell.externalVideoUrl ?? "").trim();
              if (t && !parseExternalVideoUrl(t)) {
                return res.status(400).json({
                  error: `Lesson ${i + 1}: use a full YouTube or Vimeo watch link (that URL was not recognised).`,
                });
              }
            }
          }
          const nextPages = normalizeLessonPages(lessonPages, course.lessons, mergeMediaFrom);
          await unlinkOrphanedLessonFiles(mergeMediaFrom, nextPages);
          course.lessonPages = nextPages;
        } else if (lessons != null) {
          course.lessonPages = normalizeLessonPages(
            mergeMediaFrom,
            course.lessons,
            mergeMediaFrom
          );
        }
        course.updatedAt = new Date().toISOString();
        list[idx] = course;
        await saveEducatorCourses(list);
        res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Update failed" });
      }
    }
  );

  app.post(
    "/api/educator/courses/:id/lessons/:lessonIndex/pdf",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    runLessonPdfUpload,
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            error: 'Missing file: use multipart field name "pdf" (PDF only, max 15 MB).',
          });
        }
        const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
        const course = req.ecCourse;
        const list = req.ecList;
        if (
          !Number.isFinite(lessonIndex) ||
          lessonIndex < 0 ||
          lessonIndex >= course.lessons
        ) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: "Invalid lesson index" });
        }
        const pages = normalizeLessonPages(course.lessonPages, course.lessons);
        const oldKey = pages[lessonIndex]?.pdfKey;
        if (oldKey) await unlinkLessonPdfFile(oldKey);
        const oldVid = pages[lessonIndex]?.videoKey;
        if (oldVid) await unlinkLessonVideoFile(oldVid);
        const key = req.file.filename;
        if (!isSafeLessonPdfKey(key)) {
          await unlink(req.file.path).catch(() => {});
          return res.status(500).json({ error: "Invalid stored file name" });
        }
        pages[lessonIndex] = {
          ...pages[lessonIndex],
          pdfKey: key,
          pdfOriginalName: String(req.file.originalname || "handout.pdf").slice(0, 200),
        };
        delete pages[lessonIndex].videoKey;
        delete pages[lessonIndex].videoOriginalName;
        delete pages[lessonIndex].embedVideo;
        course.lessonPages = pages;
        course.updatedAt = new Date().toISOString();
        const idx = list.findIndex((c) => c.id === course.id);
        list[idx] = course;
        await saveEducatorCourses(list);
        res.json({
          lessonIndex,
          hasPdf: true,
          pdfOriginalName: pages[lessonIndex].pdfOriginalName,
          course: mapToManagedRow(course, req.ecUser.fullName),
        });
      } catch (e) {
        console.error(e);
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
        res.status(500).json({ error: "Could not save lesson PDF" });
      }
    }
  );

  app.delete(
    "/api/educator/courses/:id/lessons/:lessonIndex/pdf",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    async (req, res) => {
      try {
        const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
        const course = req.ecCourse;
        const list = req.ecList;
        if (
          !Number.isFinite(lessonIndex) ||
          lessonIndex < 0 ||
          lessonIndex >= course.lessons
        ) {
          return res.status(400).json({ error: "Invalid lesson index" });
        }
        const pages = normalizeLessonPages(course.lessonPages, course.lessons);
        const oldKey = pages[lessonIndex]?.pdfKey;
        if (oldKey) await unlinkLessonPdfFile(oldKey);
        delete pages[lessonIndex].pdfKey;
        delete pages[lessonIndex].pdfOriginalName;
        course.lessonPages = pages;
        course.updatedAt = new Date().toISOString();
        const idx = list.findIndex((c) => c.id === course.id);
        list[idx] = course;
        await saveEducatorCourses(list);
        res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not remove PDF" });
      }
    }
  );

  app.post(
    "/api/educator/courses/:id/lessons/:lessonIndex/video",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    runLessonVideoUpload,
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            error: 'Missing file: use multipart field name "video" (MP4 or WebM, max 120 MB).',
          });
        }
        const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
        const course = req.ecCourse;
        const list = req.ecList;
        if (
          !Number.isFinite(lessonIndex) ||
          lessonIndex < 0 ||
          lessonIndex >= course.lessons
        ) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: "Invalid lesson index" });
        }
        const pages = normalizeLessonPages(course.lessonPages, course.lessons);
        const oldVid = pages[lessonIndex]?.videoKey;
        if (oldVid) await unlinkLessonVideoFile(oldVid);
        const oldPdf = pages[lessonIndex]?.pdfKey;
        if (oldPdf) await unlinkLessonPdfFile(oldPdf);
        const key = req.file.filename;
        if (!isSafeLessonVideoKey(key)) {
          await unlink(req.file.path).catch(() => {});
          return res.status(500).json({ error: "Invalid stored file name" });
        }
        pages[lessonIndex] = {
          ...pages[lessonIndex],
          videoKey: key,
          videoOriginalName: String(req.file.originalname || "lesson.mp4").slice(0, 200),
        };
        delete pages[lessonIndex].pdfKey;
        delete pages[lessonIndex].pdfOriginalName;
        delete pages[lessonIndex].embedVideo;
        course.lessonPages = pages;
        course.updatedAt = new Date().toISOString();
        const idx = list.findIndex((c) => c.id === course.id);
        list[idx] = course;
        await saveEducatorCourses(list);
        res.json({
          lessonIndex,
          hasVideo: true,
          videoOriginalName: pages[lessonIndex].videoOriginalName,
          course: mapToManagedRow(course, req.ecUser.fullName),
        });
      } catch (e) {
        console.error(e);
        if (req.file?.path) await unlink(req.file.path).catch(() => {});
        res.status(500).json({ error: "Could not save lesson video" });
      }
    }
  );

  app.delete(
    "/api/educator/courses/:id/lessons/:lessonIndex/video",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    async (req, res) => {
      try {
        const lessonIndex = Number.parseInt(req.params.lessonIndex, 10);
        const course = req.ecCourse;
        const list = req.ecList;
        if (
          !Number.isFinite(lessonIndex) ||
          lessonIndex < 0 ||
          lessonIndex >= course.lessons
        ) {
          return res.status(400).json({ error: "Invalid lesson index" });
        }
        const pages = normalizeLessonPages(course.lessonPages, course.lessons);
        const oldKey = pages[lessonIndex]?.videoKey;
        if (oldKey) await unlinkLessonVideoFile(oldKey);
        delete pages[lessonIndex].videoKey;
        delete pages[lessonIndex].videoOriginalName;
        course.lessonPages = pages;
        course.updatedAt = new Date().toISOString();
        const idx = list.findIndex((c) => c.id === course.id);
        list[idx] = course;
        await saveEducatorCourses(list);
        res.json({ course: mapToManagedRow(course, req.ecUser.fullName) });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not remove video" });
      }
    }
  );

  app.delete(
    "/api/educator/courses/:id",
    requireEducatorVerified,
    loadOwnedEducatorCourse,
    async (req, res) => {
      try {
        const id = req.params.id;
        await unlinkCourseLessonAttachments(req.ecCourse);
        const list = req.ecList.filter((c) => c.id !== id);
        await saveEducatorCourses(list);
        await removeCourseIdFromEnrollments(id);
        res.json({ ok: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Delete failed" });
      }
    }
  );
}
