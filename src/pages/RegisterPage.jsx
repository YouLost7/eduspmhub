import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { isLikelySchoolEmail } from "../utils/emailValidation.js";
import { useAuth } from "../context/AuthContext.jsx";
import { MALAYSIA_SCHOOLS, STUDENT_FORM_LEVELS } from "../../shared/studentOptions.js";
import { normalizePersonName } from "../../shared/personName.js";

const SUBJECTS = [
  ["", "Choose one subject"],
  ["Bahasa Melayu", "Bahasa Melayu"],
  ["English", "English"],
  ["Mathematics", "Mathematics"],
  ["Science", "Science"],
  ["Sejarah", "Sejarah"],
  ["Physics", "Physics"],
  ["Chemistry", "Chemistry"],
  ["Biology", "Biology"],
];

function passwordStrength(value) {
  const len = value.length;
  const hasLetter = /[a-zA-Z]/.test(value);
  const hasNum = /\d/.test(value);
  if (!len) return { cls: "", hint: "At least 8 characters. Mix letters and numbers." };
  if (len < 8 || !hasLetter)
    return { cls: "weak", hint: "Weak — add more characters and letters." };
  if (len < 12 || !hasNum)
    return { cls: "medium", hint: "Medium — add numbers or more length." };
  return { cls: "strong", hint: "Strong password." };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [role, setRole] = useState("student");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [studentForm, setStudentForm] = useState("");
  const [studentSubject, setStudentSubject] = useState("");
  const [educatorInstitution, setEducatorInstitution] = useState("");
  const [educatorSubject, setEducatorSubject] = useState("");
  const [educatorBio, setEducatorBio] = useState("");
  const [terms, setTerms] = useState(false);
  const [status, setStatus] = useState({ text: "", color: "" });
  const [busy, setBusy] = useState(false);

  const pwdMeta = useMemo(() => passwordStrength(password), [password]);

  async function onSubmit(e) {
    e.preventDefault();
    const subject = role === "student" ? studentSubject : educatorSubject;

    if (
      !fullName ||
      !email ||
      !subject ||
      !password ||
      !confirmPassword
    ) {
      setStatus({ text: "Please complete all registration fields.", color: "#b91c1c" });
      return;
    }

    if (role === "student" && !schoolName.trim()) {
      setStatus({ text: "Please select your school.", color: "#b91c1c" });
      return;
    }

    if (role === "educator" && !educatorInstitution.trim()) {
      setStatus({
        text: "Please enter your school or institution.",
        color: "#b91c1c",
      });
      return;
    }

    if (!terms) {
      setStatus({
        text: "Please accept the Terms and Privacy Policy.",
        color: "#b91c1c",
      });
      return;
    }

    if (password !== confirmPassword) {
      setStatus({ text: "Passwords do not match.", color: "#b91c1c" });
      return;
    }

    if (password.length < 8) {
      setStatus({
        text: "Password must be at least 8 characters.",
        color: "#b91c1c",
      });
      return;
    }

    if (role === "student" && !isLikelySchoolEmail(email)) {
      setStatus({
        text: "Students must use a school email (not Gmail, Yahoo, Hotmail, etc.).",
        color: "#b91c1c",
      });
      return;
    }

    const payload = {
      email: email.trim(),
      password,
      role,
      fullName: normalizePersonName(fullName),
      ...(role === "student"
        ? {
            schoolName: schoolName.trim(),
            studentForm,
            studentSubject,
          }
        : {
            educatorInstitution: educatorInstitution.trim(),
            educatorSubject,
            educatorBio: educatorBio.trim(),
          }),
    };

    setBusy(true);
    setStatus({ text: "", color: "" });
    try {
      await register(payload);
      if (role === "educator") {
        setStatus({
          text:
            "Account created. You are signed in — teaching tools stay locked until verification.",
          color: "#15803d",
        });
      } else {
        setStatus({ text: "Account created. Redirecting…", color: "#15803d" });
      }
      window.setTimeout(() => navigate("/browse", { replace: true }), 800);
    } catch (err) {
      setStatus({ text: err.message || "Registration failed", color: "#b91c1c" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="auth-page auth-page--register"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.header
        className="auth-topbar"
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        <div className="auth-topbar-inner">
          <Link className="auth-logo" to="/">
            <span className="auth-logo-icon" aria-hidden="true">
              ▶
            </span>
            <span className="auth-logo-text">
              <span className="auth-logo-edu">Edu</span>
              <span className="auth-logo-spm">SPM</span>
              <span className="auth-logo-hub">Hub</span>
            </span>
          </Link>
          <nav className="auth-topnav" aria-label="Primary">
            <Link to="/">Home</Link>
            <Link to="/browse">Browse</Link>
            <a href="#">About</a>
            <a href="#">Contact</a>
          </nav>
          <div className="auth-topbar-actions">
            <Link className="auth-link" to="/login">
              Log In
            </Link>
          </div>
        </div>
      </motion.header>

      <main className="auth-main">
        <motion.h1
          className="page-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.35 }}
        >
          Sign Up
        </motion.h1>

        <motion.section
          className="auth-card auth-card--register"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="subtext subtext--tight">
            Choose your account type. Students use a school email; educators can
            use school or personal email. Teaching features unlock after
            verification.
          </p>

          <div className="role-tabs" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={`tab-btn${role === "student" ? " active" : ""}`}
              data-role="student"
              aria-selected={role === "student"}
              onClick={() => setRole("student")}
            >
              <span className="tab-radio" aria-hidden="true" />
              Student
            </button>
            <button
              type="button"
              className={`tab-btn${role === "educator" ? " active" : ""}`}
              data-role="educator"
              aria-selected={role === "educator"}
              onClick={() => setRole("educator")}
            >
              <span className="tab-icon-screen" aria-hidden="true" />
              Educator
            </button>
          </div>

          <form id="registerForm" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="fullName">Full Name</label>
              <div className="input-wrap">
                <input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(normalizePersonName(e.target.value))}
                  type="text"
                  placeholder="AHMAD BIN ALI"
                  autoComplete="name"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="input-uppercase"
                  required
                />
              </div>
              <p className="field-hint">Enter your name in capital letters (as on your school record).</p>
            </div>

            <div className="field">
              <label htmlFor="regEmail">Email Address</label>
              <div className="input-wrap input-wrap--has-trail">
                <input
                  id="regEmail"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email Address"
                  autoComplete="email"
                  required
                />
                <span className="input-trail" aria-hidden="true" title="Edit">
                  ✎
                </span>
              </div>
              <AnimatePresence mode="wait">
                {role === "student" ? (
                  <motion.p
                    key="stu"
                    className="email-helper"
                    data-role="student"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    Use your official school email (e.g.{" "}
                    <code>@moe-dl.edu.my</code> or your school domain).
                  </motion.p>
                ) : (
                  <motion.p
                    key="edu"
                    className="email-helper"
                    data-role="educator"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    School or personal email is fine. We may ask for proof of
                    teaching during verification.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="field">
              <label htmlFor="regPassword">Password</label>
              <div className="input-wrap input-wrap--has-trail">
                <input
                  id="regPassword"
                  name="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="input-trail input-trail-btn"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                  onClick={() => setShowPwd((v) => !v)}
                >
                  👁
                </button>
              </div>
              <div className="password-meter" aria-hidden="true">
                <div
                  className={`password-meter-bar${pwdMeta.cls ? ` ${pwdMeta.cls}` : ""}`}
                  id="passwordMeterBar"
                />
              </div>
              <p className="field-hint" id="passwordHint">
                {pwdMeta.hint}
              </p>
            </div>

            <div className="field">
              <label htmlFor="regConfirmPassword">Confirm Password</label>
              <div className="input-wrap input-wrap--has-trail">
                <input
                  id="regConfirmPassword"
                  name="confirmPassword"
                  type={showPwd2 ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm Password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="input-trail input-trail-btn"
                  aria-label={
                    showPwd2 ? "Hide confirm password" : "Show confirm password"
                  }
                  onClick={() => setShowPwd2((v) => !v)}
                >
                  👁
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {role === "student" ? (
                <motion.div
                  key="panel-student"
                  className="tab-panel active"
                  data-role="student"
                  role="tabpanel"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.22 }}
                  style={{ display: "grid", gap: "1rem" }}
                >
                  <div className="field">
                    <label htmlFor="schoolName">School Name</label>
                    <select
                      id="schoolName"
                      name="schoolName"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      required
                    >
                      <option value="">Choose your school</option>
                      {MALAYSIA_SCHOOLS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="studentForm">Form / Level</label>
                    <select
                      id="studentForm"
                      name="studentForm"
                      value={studentForm}
                      onChange={(e) => setStudentForm(e.target.value)}
                    >
                      <option value="">Select your level (optional)</option>
                      {STUDENT_FORM_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="studentSubject">Main Subject Focus</label>
                    <select
                      id="studentSubject"
                      name="studentSubject"
                      value={studentSubject}
                      onChange={(e) => setStudentSubject(e.target.value)}
                      required
                    >
                      {SUBJECTS.map(([v, label]) => (
                        <option key={`s-${v}-${label}`} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="panel-educator"
                  className="tab-panel active"
                  data-role="educator"
                  role="tabpanel"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.22 }}
                  style={{ display: "grid", gap: "1rem" }}
                >
                  <div className="field">
                    <label htmlFor="educatorInstitution">
                      School / Institution
                    </label>
                    <div className="input-wrap">
                      <input
                        id="educatorInstitution"
                        name="educatorInstitution"
                        value={educatorInstitution}
                        onChange={(e) => setEducatorInstitution(e.target.value)}
                        type="text"
                        placeholder="Where you teach"
                        autoComplete="organization"
                        required
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="educatorSubject">
                      Primary subject you teach
                    </label>
                    <select
                      id="educatorSubject"
                      name="educatorSubject"
                      value={educatorSubject}
                      onChange={(e) => setEducatorSubject(e.target.value)}
                      required
                    >
                      {SUBJECTS.map(([v, label]) => (
                        <option key={`e-${label}`} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="educatorBio">Short bio (optional)</label>
                    <textarea
                      id="educatorBio"
                      name="educatorBio"
                      value={educatorBio}
                      onChange={(e) => setEducatorBio(e.target.value)}
                      rows={3}
                      placeholder="Years of experience, qualifications, or subjects you specialise in"
                    />
                  </div>
                  <div className="pending-note">
                    <strong>After you sign up</strong>, go to Profile and upload your
                    certified educator licence (PDF or photo). We only mark tutors as
                    verified after staff review that document. Until then you can browse
                    the site but cannot publish courses or use full teaching tools.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="field field--checkbox">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  id="termsAccept"
                  name="termsAccept"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  required
                />
                <span>
                  I agree to the <a href="#">Terms</a> and{" "}
                  <a href="#">Privacy Policy</a>.
                </span>
              </label>
            </div>

            <motion.button
              className="btn btn-signup"
              type="submit"
              disabled={busy}
              whileHover={{ scale: busy ? 1 : 1.01 }}
              whileTap={{ scale: busy ? 1 : 0.99 }}
            >
              {busy ? "Creating account…" : "Sign Up"}
            </motion.button>
            <p
              className="status"
              role="status"
              style={{ color: status.color || undefined }}
            >
              {status.text}
            </p>
          </form>

          <p className="helper helper--center">
            Already have an account?
            <Link to="/login"> Log In</Link>
            <span className="helper-chevron" aria-hidden="true">
              ›
            </span>
          </p>
        </motion.section>
      </main>
    </motion.div>
  );
}
