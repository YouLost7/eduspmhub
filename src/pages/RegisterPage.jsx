import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { isLikelySchoolEmail } from "../utils/emailValidation.js";
import { useAuth } from "../context/AuthContext.jsx";
import { MALAYSIA_SCHOOLS, STUDENT_FORM_LEVELS } from "../../shared/studentOptions.js";
import { formatPersonNameInput, normalizePersonName } from "../../shared/personName.js";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

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
  const { t } = useI18n();
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
  const navigateTimeoutRef = useRef(null);

  const pwdMeta = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    return () => clearTimeout(navigateTimeoutRef.current);
  }, []);

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
      setStatus({ text: t("auth.completeFields"), color: "#b91c1c" });
      return;
    }

    if (role === "student" && !schoolName.trim()) {
      setStatus({ text: t("auth.selectSchool"), color: "#b91c1c" });
      return;
    }

    if (role === "educator" && !educatorInstitution.trim()) {
      setStatus({
        text: t("auth.enterInstitution"),
        color: "#b91c1c",
      });
      return;
    }

    if (!terms) {
      setStatus({
        text: t("auth.acceptTerms"),
        color: "#b91c1c",
      });
      return;
    }

    if (password !== confirmPassword) {
      setStatus({ text: t("auth.passwordsMismatch"), color: "#b91c1c" });
      return;
    }

    if (password.length < 8) {
      setStatus({
        text: t("auth.passwordMinLength"),
        color: "#b91c1c",
      });
      return;
    }

    if (role === "student" && !isLikelySchoolEmail(email)) {
      setStatus({
        text: t("auth.schoolEmailRequired"),
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
          text: t("auth.accountCreatedEducator"),
          color: "#15803d",
        });
      } else {
        setStatus({ text: t("auth.accountCreatedStudent"), color: "#15803d" });
      }
      navigateTimeoutRef.current = window.setTimeout(
        () => navigate("/browse", { replace: true }),
        800
      );
    } catch (err) {
      setStatus({ text: err.message || t("auth.registrationFailed"), color: "#b91c1c" });
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
            <Link to="/">{t("common.home")}</Link>
            <Link to="/browse">{t("common.browse")}</Link>
            <a href="#">{t("common.about")}</a>
            <a href="#">{t("common.contact")}</a>
          </nav>
          <div className="auth-topbar-actions">
            <LanguageSwitcher />
            <Link className="auth-link" to="/login">
              {t("common.logIn")}
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
          {t("auth.signUpTitle")}
        </motion.h1>

        <motion.section
          className="auth-card auth-card--register"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="subtext subtext--tight">{t("auth.registerIntro")}</p>

          <div className="role-tabs" role="tablist" aria-label="Account type">
            <button
              type="button"
              className={`tab-btn${role === "student" ? " active" : ""}`}
              data-role="student"
              aria-selected={role === "student"}
              onClick={() => setRole("student")}
            >
              <span className="tab-radio" aria-hidden="true" />
              {t("auth.student")}
            </button>
            <button
              type="button"
              className={`tab-btn${role === "educator" ? " active" : ""}`}
              data-role="educator"
              aria-selected={role === "educator"}
              onClick={() => setRole("educator")}
            >
              <span className="tab-icon-screen" aria-hidden="true" />
              {t("auth.educator")}
            </button>
          </div>

          <form id="registerForm" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="fullName">{t("auth.fullName")}</label>
              <div className="input-wrap">
                <input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(formatPersonNameInput(e.target.value))}
                  type="text"
                  placeholder={t("auth.fullNamePlaceholder")}
                  autoComplete="name"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="input-uppercase"
                  required
                />
              </div>
              <p className="field-hint">{t("auth.fullNameHint")}</p>
            </div>

            <div className="field">
              <label htmlFor="regEmail">{t("auth.emailAddress")}</label>
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
                    {t("auth.schoolEmailHint")}
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
                    {t("auth.educatorEmailHint")}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="field">
              <label htmlFor="regPassword">{t("auth.password")}</label>
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
              <label htmlFor="regConfirmPassword">{t("auth.confirmPassword")}</label>
              <div className="input-wrap input-wrap--has-trail">
                <input
                  id="regConfirmPassword"
                  name="confirmPassword"
                  type={showPwd2 ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("auth.confirmPassword")}
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
                    <label htmlFor="schoolName">{t("auth.schoolName")}</label>
                    <select
                      id="schoolName"
                      name="schoolName"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      required
                    >
                      <option value="">{t("auth.chooseSchool")}</option>
                      {MALAYSIA_SCHOOLS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="studentForm">{t("auth.formLevel")}</label>
                    <select
                      id="studentForm"
                      name="studentForm"
                      value={studentForm}
                      onChange={(e) => setStudentForm(e.target.value)}
                    >
                      <option value="">{t("auth.selectLevel")}</option>
                      {STUDENT_FORM_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="studentSubject">{t("auth.mainSubjectFocus")}</label>
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
                    <label htmlFor="educatorInstitution">{t("auth.institution")}</label>
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
                    <label htmlFor="educatorSubject">{t("auth.primarySubject")}</label>
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
                    <label htmlFor="educatorBio">{t("auth.bio")}</label>
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
              {busy ? t("auth.registering") : t("auth.signUpTitle")}
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
            {t("auth.haveAccount")}
            <Link to="/login"> {t("auth.signInLink")}</Link>
            <span className="helper-chevron" aria-hidden="true">
              ›
            </span>
          </p>
        </motion.section>
      </main>
    </motion.div>
  );
}
