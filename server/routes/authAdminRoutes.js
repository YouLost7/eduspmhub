import { getAdminFinanceSummary } from "../admin/finance.js";
import { normalizePersonName } from "../validation.js";

export function registerAuthAdminRoutes(app, deps) {
  const {
    registerLimiter,
    loginLimiter,
    adminLimiter,
    ADMIN_KEY,
    LICENSE_DIR,
    isSafeLicenseStorageKey,
    loadUsers,
    saveUsers,
    findUserByEmail,
    findUserById,
    toPublicUser,
    isLikelySchoolEmail,
    isValidMalaysiaSchool,
    isValidStudentFormLevel,
    bcrypt,
    randomUUID,
    existsSync,
    path,
  } = deps;

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    const users = await loadUsers();
    const u = findUserById(users, req.session.userId);
    if (!u) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    res.json({ user: toPublicUser(u) });
  });

  app.post("/api/auth/register", registerLimiter, async (req, res) => {
    try {
      const {
        email,
        password,
        role,
        fullName,
        schoolName,
        studentForm,
        studentSubject,
        educatorInstitution,
        educatorSubject,
        educatorBio,
      } = req.body;

      if (!email || !password || !fullName || !role) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const normalizedName = normalizePersonName(fullName);
      if (!normalizedName) {
        return res.status(400).json({ error: "Full name is required" });
      }

      if (!["student", "educator"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      if (role === "student") {
        if (!studentSubject) {
          return res.status(400).json({ error: "Subject is required for students" });
        }
        if (!schoolName || !String(schoolName).trim()) {
          return res.status(400).json({ error: "School name is required" });
        }
        if (!isValidMalaysiaSchool(schoolName)) {
          return res.status(400).json({
            error: "Please choose a school from the list of supported Malaysian schools.",
          });
        }
        if (!isValidStudentFormLevel(studentForm)) {
          return res.status(400).json({
            error: "Please choose a valid Form / Level option from the list.",
          });
        }
        if (!isLikelySchoolEmail(String(email))) {
          return res.status(400).json({
            error:
              "Students must register with a school email (not free providers like Gmail).",
          });
        }
      }

      if (role === "educator") {
        if (!educatorSubject) {
          return res.status(400).json({ error: "Subject is required for educators" });
        }
        if (!educatorInstitution || !String(educatorInstitution).trim()) {
          return res.status(400).json({ error: "Institution is required for educators" });
        }
      }

      const users = await loadUsers();
      if (findUserByEmail(users, email)) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = {
        id: randomUUID(),
        email: String(email).trim().toLowerCase(),
        passwordHash,
        role,
        verified: role === "student",
        fullName: normalizedName,
        schoolName: role === "student" ? String(schoolName).trim() : "",
        studentForm: role === "student" ? String(studentForm || "") : "",
        studentSubject: role === "student" ? String(studentSubject) : "",
        educatorInstitution:
          role === "educator" ? String(educatorInstitution).trim() : "",
        educatorSubject: role === "educator" ? String(educatorSubject) : "",
        educatorBio: role === "educator" ? String(educatorBio || "").trim() : "",
        createdAt: new Date().toISOString(),
      };

      users.push(user);
      await saveUsers(users);

      req.session.userId = user.id;
      res.status(201).json({ user: toPublicUser(user) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }
      const users = await loadUsers();
      const user = findUserByEmail(users, email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      req.session.userId = user.id;
      res.json({ user: toPublicUser(user) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.clearCookie("eduspmhub.sid");
      res.json({ ok: true });
    });
  });

  /** Admin: educators awaiting verification (for staff review queue). */
  app.get("/api/admin/educators-pending", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const users = await loadUsers();
    const educators = users
      .filter((u) => u.role === "educator" && !u.verified)
      .map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        educatorSubject: u.educatorSubject || "",
        educatorInstitution: u.educatorInstitution || "",
        hasLicenseDocument: Boolean(u.licenseStorageKey),
        licenseUploadedAt: u.licenseUploadedAt || null,
      }));
    res.json({ educators });
  });

  /** Admin: download submitted licence file for review (not exposed to students). */
  app.get("/api/admin/educator/:id/license", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const users = await loadUsers();
    const u = findUserById(users, req.params.id);
    if (!u || u.role !== "educator") {
      return res.status(404).json({ error: "Educator not found" });
    }
    if (!u.licenseStorageKey || !isSafeLicenseStorageKey(u.licenseStorageKey)) {
      return res.status(404).json({ error: "No licence file on record" });
    }
    const abs = path.join(LICENSE_DIR, u.licenseStorageKey);
    if (!existsSync(abs)) {
      return res.status(404).json({ error: "File missing on server" });
    }
    const mime = u.licenseMimeType || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    const safeName = String(u.licenseOriginalName || "educator-licence").replace(
      /[^\w.\- ()]+/g,
      "_"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.sendFile(path.resolve(abs));
  });

  /** Dev / ops: verify an educator by email. Send header X-Admin-Key */
  app.post("/api/admin/verify-educator", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const users = await loadUsers();
    const u = findUserByEmail(users, email);
    if (!u || u.role !== "educator") {
      return res.status(404).json({ error: "Educator not found" });
    }
    if (!u.verified && !u.licenseStorageKey) {
      return res.status(400).json({
        error:
          "Cannot verify: this educator has not uploaded a certified licence document yet. Ask them to upload on Profile first.",
      });
    }
    u.verified = true;
    await saveUsers(users);
    res.json({ ok: true, user: toPublicUser(u) });
  });

  app.get("/api/admin/finance-summary", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Invalid admin key" });
    }
    try {
      const summary = await getAdminFinanceSummary();
      res.json({ summary });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load finance summary" });
    }
  });
}
