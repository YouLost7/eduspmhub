import { getAdminFinanceSummary } from "../admin/finance.js";
import { normalizePersonName, secretEquals } from "../validation.js";
import { sendMail } from "../mail.js";
import {
  createPasswordResetToken,
  findValidPasswordResetToken,
  consumePasswordResetToken,
  invalidatePasswordResetTokensForUser,
} from "../passwordReset.js";

/**
 * Regenerates the session id before establishing a new login, so a session
 * id an attacker fixed onto a victim (e.g. via a cookie set from another
 * page) can't be hijacked once that victim authenticates.
 */
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function registerAuthAdminRoutes(app, deps) {
  const {
    registerLimiter,
    loginLimiter,
    adminLimiter,
    forgotPasswordLimiter,
    ADMIN_KEY,
    isProd,
    APP_BASE_URL,
    LICENSE_DIR,
    isSafeLicenseStorageKey,
    loadUsers,
    getUserById,
    insertUser,
    updateUser,
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
    const u = await getUserById(req.session.userId);
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
      if (password.length > 200) {
        // bcrypt itself silently truncates at 72 bytes; the real point of a
        // cap here is to stop a request forcing expensive hashing work over
        // an arbitrarily large string.
        return res.status(400).json({ error: "Password is too long (max 200 characters)" });
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

      try {
        await insertUser(user);
      } catch (e) {
        // Unique violation on id/email: guards against two concurrent
        // registrations for the same email racing past the check above.
        if (e?.code === "23505") {
          return res.status(409).json({ error: "An account with this email already exists" });
        }
        throw e;
      }

      await regenerateSession(req);
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
      await regenerateSession(req);
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
      // Must match the cookie options used when the session was created
      // (server/index.js), or some browsers won't actually clear it.
      res.clearCookie("eduspmhub.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
      });
      res.json({ ok: true });
    });
  });

  const GENERIC_FORGOT_PASSWORD_MESSAGE =
    "If an account exists for that email, we've sent a password reset link.";

  app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      const users = await loadUsers();
      const user = findUserByEmail(users, email);
      // Always send the same response whether or not the account exists —
      // otherwise this endpoint could be used to check which emails are
      // registered.
      if (user) {
        // Only the latest reset link should work — invalidate any older ones first.
        await invalidatePasswordResetTokensForUser(user.id);
        const { rawToken } = await createPasswordResetToken(user.id);
        const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
        sendMail({
          to: user.email,
          subject: "[EduSPM Hub] Reset your password",
          text: [
            `Hi ${user.fullName},`,
            ``,
            `We received a request to reset your EduSPM Hub password.`,
            `This link is valid for 1 hour: ${resetUrl}`,
            ``,
            `If you didn't request this, you can safely ignore this email — your password will stay the same.`,
          ].join("\n"),
        }).catch((e) => console.error("[auth] forgot-password email failed", e));
      }
      res.json({ ok: true, message: GENERIC_FORGOT_PASSWORD_MESSAGE });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not process request" });
    }
  });

  /** Lets the reset-password page show a friendly "link expired" state before the user finishes typing a new password. */
  app.get("/api/auth/reset-password/:token", forgotPasswordLimiter, async (req, res) => {
    try {
      const valid = await findValidPasswordResetToken(req.params.token);
      res.json({ valid: Boolean(valid) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not validate reset link" });
    }
  });

  app.post("/api/auth/reset-password", forgotPasswordLimiter, async (req, res) => {
    try {
      const token = String(req.body?.token || "").trim();
      const password = String(req.body?.password || "");
      if (!token || !password) {
        return res.status(400).json({ error: "Token and new password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (password.length > 200) {
        return res.status(400).json({ error: "Password is too long (max 200 characters)" });
      }
      const consumed = await consumePasswordResetToken(token);
      if (!consumed) {
        return res.status(400).json({
          error: "This reset link is invalid or has expired. Request a new one.",
        });
      }
      const user = await getUserById(consumed.userId);
      if (!user) {
        return res.status(400).json({ error: "Account not found" });
      }
      user.passwordHash = await bcrypt.hash(password, 10);
      await updateUser(user);
      // Any other outstanding reset links for this account are no longer
      // useful (and shouldn't remain valid) once the password has changed.
      await invalidatePasswordResetTokensForUser(user.id);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not reset password" });
    }
  });

  /** Admin: educators awaiting verification (for staff review queue). */
  app.get("/api/admin/educators-pending", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!secretEquals(key, ADMIN_KEY)) {
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
    if (!secretEquals(key, ADMIN_KEY)) {
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
    if (!secretEquals(key, ADMIN_KEY)) {
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
    await updateUser(u);
    res.json({ ok: true, user: toPublicUser(u) });
  });

  app.get("/api/admin/finance-summary", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!secretEquals(key, ADMIN_KEY)) {
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
