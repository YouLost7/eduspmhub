export function registerProfileRoutes(app, deps) {
  const {
    requireAuth,
    runLicenseUpload,
    runProfilePhotoUpload,
    loadUsers,
    saveUsers,
    findUserById,
    toPublicUser,
    unlink,
    resolvedLicenseMeta,
    isSafeLicenseStorageKey,
    LICENSE_DIR,
    path,
    resolvedAvatarMeta,
    isSafeAvatarStorageKey,
    unlinkAvatarFile,
    PROFILE_PHOTO_DIR,
    existsSync,
  } = deps;

  app.patch("/api/profile", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const idx = users.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) return res.status(404).json({ error: "User not found" });
      const u = users[idx];
      const { fullName, schoolName, studentForm, educatorInstitution, educatorBio } = req.body;

      if (fullName != null) u.fullName = String(fullName).trim();
      if (u.role === "student") {
        if (schoolName != null) u.schoolName = String(schoolName).trim();
        if (studentForm != null) u.studentForm = String(studentForm);
      }
      if (u.role === "educator") {
        if (educatorInstitution != null) {
          u.educatorInstitution = String(educatorInstitution).trim();
        }
        if (educatorBio != null) u.educatorBio = String(educatorBio).trim();
      }

      users[idx] = u;
      await saveUsers(users);
      res.json({ user: toPublicUser(u) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Update failed" });
    }
  });

  app.post("/api/educator/license", requireAuth, runLicenseUpload, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Missing file: use multipart field name "license" (PDF, JPEG, or PNG).',
        });
      }
      const users = await loadUsers();
      const idx = users.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) {
        await unlink(req.file.path).catch(() => {});
        return res.status(404).json({ error: "User not found" });
      }
      const u = users[idx];
      if (u.role !== "educator") {
        await unlink(req.file.path).catch(() => {});
        return res.status(403).json({ error: "Only educator accounts may upload a licence" });
      }
      const oldKey = u.licenseStorageKey;
      u.licenseStorageKey = req.file.filename;
      u.licenseOriginalName = String(req.file.originalname || "document").slice(0, 200);
      const meta = resolvedLicenseMeta(req.file);
      u.licenseMimeType = meta?.mime || req.file.mimetype;
      u.licenseUploadedAt = new Date().toISOString();
      users[idx] = u;
      await saveUsers(users);
      if (oldKey && oldKey !== req.file.filename && isSafeLicenseStorageKey(oldKey)) {
        const oldPath = path.join(LICENSE_DIR, oldKey);
        await unlink(oldPath).catch(() => {});
      }
      res.json({ user: toPublicUser(u) });
    } catch (e) {
      console.error(e);
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Could not save licence upload" });
    }
  });

  app.post("/api/profile/photo", requireAuth, runProfilePhotoUpload, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Missing file: use multipart field name "photo" (JPEG, PNG, or WebP, max 3 MB).',
        });
      }
      const users = await loadUsers();
      const idx = users.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) {
        await unlink(req.file.path).catch(() => {});
        return res.status(404).json({ error: "User not found" });
      }
      const u = users[idx];
      if (u.role !== "student" && u.role !== "educator") {
        await unlink(req.file.path).catch(() => {});
        return res.status(403).json({
          error: "Profile photo is only for student or educator accounts.",
        });
      }
      const meta = resolvedAvatarMeta(req.file);
      const oldKey = u.avatarStorageKey;
      u.avatarStorageKey = req.file.filename;
      u.avatarMimeType = meta?.mime || req.file.mimetype || "image/jpeg";
      u.avatarUploadedAt = new Date().toISOString();
      users[idx] = u;
      await saveUsers(users);
      if (oldKey && oldKey !== req.file.filename && isSafeAvatarStorageKey(oldKey)) {
        await unlinkAvatarFile(oldKey);
      }
      res.json({ user: toPublicUser(u) });
    } catch (e) {
      console.error(e);
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Could not save profile photo" });
    }
  });

  app.delete("/api/profile/photo", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const idx = users.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) return res.status(404).json({ error: "User not found" });
      const u = users[idx];
      const oldKey = u.avatarStorageKey;
      delete u.avatarStorageKey;
      delete u.avatarMimeType;
      delete u.avatarUploadedAt;
      users[idx] = u;
      await saveUsers(users);
      if (oldKey && isSafeAvatarStorageKey(oldKey)) await unlinkAvatarFile(oldKey);
      res.json({ user: toPublicUser(u) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not remove photo" });
    }
  });

  app.get("/api/profile/photo/:userId", requireAuth, async (req, res) => {
    try {
      const userId =
        typeof req.params.userId === "string" ? req.params.userId.trim() : req.params.userId;
      const users = await loadUsers();
      const target = findUserById(users, userId);
      if (!target?.avatarStorageKey || !isSafeAvatarStorageKey(target.avatarStorageKey)) {
        return res.status(404).end();
      }
      const abs = path.join(PROFILE_PHOTO_DIR, target.avatarStorageKey);
      if (!existsSync(abs)) {
        return res.status(404).end();
      }
      const mime = target.avatarMimeType || "image/jpeg";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) res.status(500).end();
      });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).end();
    }
  });
}
