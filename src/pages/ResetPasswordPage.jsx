import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [checking, setChecking] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ text: "", color: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigateTimeoutRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(navigateTimeoutRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setChecking(false);
      setTokenValid(false);
      return;
    }
    (async () => {
      try {
        const data = await apiJson(`/api/auth/reset-password/${encodeURIComponent(token)}`);
        if (!cancelled) setTokenValid(Boolean(data.valid));
      } catch {
        if (!cancelled) setTokenValid(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setStatus({ text: t("auth.passwordMinLength"), color: "#b91c1c" });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ text: t("auth.passwordsMismatch"), color: "#b91c1c" });
      return;
    }
    setBusy(true);
    setStatus({ text: "", color: "" });
    try {
      await apiJson("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      setDone(true);
      setStatus({ text: t("auth.resetSuccess"), color: "#15803d" });
      navigateTimeoutRef.current = window.setTimeout(
        () => navigate("/login", { replace: true }),
        1500
      );
    } catch (err) {
      setStatus({ text: err.message || t("auth.resetFailed"), color: "#b91c1c" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <main className="auth-shell">
        <motion.section
          className="auth-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="auth-card-top">
            <Link className="brand" to="/">
              EduSPM Hub
            </Link>
            <LanguageSwitcher />
          </div>
          <h1>{t("auth.resetTitle")}</h1>

          {checking ? (
            <p className="subtext">{t("common.loading")}</p>
          ) : !tokenValid ? (
            <>
              <p className="status" style={{ color: "#b91c1c" }}>
                {t("auth.resetLinkInvalid")}
              </p>
              <p className="helper">
                <Link to="/forgot-password">{t("auth.forgotSubmit")}</Link>
              </p>
            </>
          ) : done ? (
            <p className="status" style={{ color: status.color || undefined }}>
              {status.text}
            </p>
          ) : (
            <form onSubmit={onSubmit}>
              <div>
                <label htmlFor="password">{t("auth.newPassword")}</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder={t("auth.passwordPlaceholder")}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="confirmPassword">{t("auth.confirmPassword")}</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder={t("auth.passwordPlaceholder")}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <motion.button
                className="btn"
                type="submit"
                disabled={busy}
                whileHover={{ scale: busy ? 1 : 1.02 }}
                whileTap={{ scale: busy ? 1 : 0.98 }}
              >
                {busy ? t("auth.resetSubmitting") : t("auth.resetSubmit")}
              </motion.button>
              <p className="status" style={{ color: status.color || undefined }}>
                {status.text}
              </p>
            </form>
          )}

          <p className="helper">
            <Link to="/login">{t("auth.backToLogin")}</Link>
          </p>
        </motion.section>
      </main>
    </motion.div>
  );
}
