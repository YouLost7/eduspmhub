import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useI18n } from "../i18n/I18nContext.jsx";
import LanguageSwitcher from "../components/LanguageSwitcher.jsx";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ text: "", color: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setStatus({ text: t("auth.forgotEmailRequired"), color: "#b91c1c" });
      return;
    }
    setBusy(true);
    setStatus({ text: "", color: "" });
    try {
      const data = await apiJson("/api/auth/forgot-password", {
        method: "POST",
        body: { email: trimmed },
      });
      setSent(true);
      setStatus({ text: data.message || t("auth.forgotSent"), color: "#15803d" });
    } catch (err) {
      setStatus({ text: err.message || t("auth.forgotFailed"), color: "#b91c1c" });
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
          <h1>{t("auth.forgotTitle")}</h1>
          <p className="subtext">{t("auth.forgotHint")}</p>

          {sent ? (
            <p className="status" style={{ color: status.color || undefined }}>
              {status.text}
            </p>
          ) : (
            <form onSubmit={onSubmit}>
              <div>
                <label htmlFor="email">{t("auth.email")}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {busy ? t("auth.forgotSending") : t("auth.forgotSubmit")}
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
