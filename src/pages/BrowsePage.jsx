import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { AppToast } from "../components/AppToast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

function priceToCents(priceLike) {
  const raw = String(priceLike ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^RM\s*/i, "").replace(/,/g, "");
  const num = Number.parseFloat(cleaned.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  const cents = Math.round(num * 100);
  return cents < 200 ? 0 : cents;
}

export default function BrowsePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [courses, setCourses] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const processedAutoEnroll = useRef(new Set());

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [staleApiHint, setStaleApiHint] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const detailPanelRef = useRef(null);

  const subjectParam = searchParams.get("subject");
  const courseFocus = searchParams.get("course");

  const closeDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("course");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const subjectDecoded = useMemo(() => {
    if (!subjectParam) return "";
    try {
      return decodeURIComponent(subjectParam);
    } catch {
      return subjectParam;
    }
  }, [subjectParam]);

  const load = useCallback(async () => {
    try {
      const data = await apiJson("/api/courses");
      setCourses(data.courses || []);
      setErr("");
      if (import.meta.env.DEV && data.stats?.fromBuiltInCatalog > 0) {
        setStaleApiHint(
          "This response still includes built-in catalogue rows — the browser is probably talking to an old API (often still on port 3001). Stop other dev servers using that port and open the Vite URL printed in the terminal where you started npm run dev:all, then hard-refresh."
        );
      } else {
        setStaleApiHint("");
      }
    } catch (e) {
      setErr(e.message);
      setStaleApiHint("");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!courseFocus) {
      setDetail(null);
      setDetailErr("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr("");
    (async () => {
      try {
        const data = await apiJson(
          `/api/courses/${encodeURIComponent(courseFocus)}`
        );
        if (!cancelled) {
          setDetail(data.course);
          setDetailErr("");
        }
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setDetailErr(e.message || t("browse.loadCourseError"));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseFocus, t]);

  useEffect(() => {
    if (!courseFocus) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeDetail();
        return;
      }
      // Basic focus trap: keep Tab from moving focus out to the page
      // underneath while the modal is open.
      if (e.key === "Tab" && detailPanelRef.current) {
        const focusable = detailPanelRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [courseFocus, closeDetail]);

  // Moves focus into the dialog when it opens, and returns it to whatever
  // triggered it (e.g. the "Details" link) when it closes — without this,
  // keyboard/screen-reader users are left focused on a background element
  // hidden behind the modal.
  useEffect(() => {
    if (!courseFocus || detailLoading) return;
    const previouslyFocused = document.activeElement;
    const id = window.setTimeout(() => {
      detailPanelRef.current?.querySelector(".course-detail-close")?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [courseFocus, detailLoading]);

  const visibleCourses = useMemo(() => {
    if (!subjectDecoded) return courses;
    return courses.filter((c) => c.subject === subjectDecoded);
  }, [courses, subjectDecoded]);

  async function enroll(courseId) {
    if (actionBusyId) return false;
    setActionBusyId(courseId);
    try {
      await apiJson("/api/my-courses/enroll", {
        method: "POST",
        body: { courseId },
      });
      setErr("");
      setOkMsg(t("dashboard.addedToCourses"));
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setActionBusyId("");
    }
  }

  async function checkout(courseId) {
    if (actionBusyId) return false;
    setActionBusyId(courseId);
    try {
      const data = await apiJson("/api/payments/checkout", {
        method: "POST",
        body: { courseId },
      });
      const url = String(data.checkoutUrl || "").trim();
      if (!url) throw new Error(t("browse.paymentCheckoutMissing"));
      window.location.assign(url);
      return true;
    } catch (e) {
      setErr(e.message || t("browse.paymentStartError"));
      setActionBusyId("");
      return false;
    }
  }

  useEffect(() => {
    const en = searchParams.get("enroll");
    if (!en) return;
    if (!user || user.role !== "student") return;
    if (processedAutoEnroll.current.has(en)) return;
    processedAutoEnroll.current.add(en);
    (async () => {
      try {
        await apiJson("/api/my-courses/enroll", {
          method: "POST",
          body: { courseId: en },
        });
        setOkMsg(t("dashboard.addedToCourses"));
        const next = new URLSearchParams(searchParams);
        next.delete("enroll");
        setSearchParams(next, { replace: true });
      } catch (e) {
        setErr(e.message || t("browse.autoEnrolFailed"));
        processedAutoEnroll.current.delete(en);
      }
    })();
  }, [user, searchParams, setSearchParams, t]);

  const isEducator = user?.role === "educator";
  const loginLinkForCourse = useCallback((course) => {
    const isPaid = priceToCents(course?.price) > 0;
    if (isPaid) {
      return `/login?next=${encodeURIComponent("/browse")}`;
    }
    return `/login?next=${encodeURIComponent("/browse")}&enroll=${encodeURIComponent(course?.id || "")}`;
  }, []);

  return (
    <div>
      {isEducator ? (
        <div className="user-page-intro user-page-intro--educator">
          <h1>{t("browse.educatorTitle")}</h1>
          <p>
            {t("browse.educatorIntroBase")}
            {user?.verified
              ? ` ${t("browse.educatorIntroVerified")}`
              : ` ${t("browse.educatorIntroPending")}`}
          </p>
          {!user?.verified && (
            <p className="verify-banner">
              {!user?.hasLicenseDocument ? (
                <>{t("browse.statusActionNeeded")}</>
              ) : (
                <>{t("browse.statusLicenceSubmitted")}</>
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="user-page-intro">
          <h1>{t("browse.title")}</h1>
          <p>
            {t("browse.intro")}{" "}
            <strong>{t("browse.myCoursesBold")}</strong>.
          </p>
        </div>
      )}

      {subjectDecoded && (
        <p className="field-hint" style={{ marginBottom: "0.75rem" }}>
          {t("browse.filteredBy")} <strong>{subjectDecoded}</strong>{" "}
          <Link to="/browse" style={{ marginLeft: "0.5rem", fontWeight: 600 }}>
            {t("browse.clearFilter")}
          </Link>
        </p>
      )}

      {courseFocus && (
        <p className="field-hint" style={{ marginBottom: "0.75rem" }}>
          {t("browse.panelOpen")}{" "}
          <button type="button" className="outline-btn" onClick={closeDetail}>
            {t("browse.closeDetails")}
          </button>
        </p>
      )}

      {staleApiHint && (
        <p className="verify-banner" role="status">
          {staleApiHint}
        </p>
      )}
      {import.meta.env.DEV && user?.role === "student" && (
        <p className="verify-banner" role="status">
          {t("browse.devPaymentMode")}
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <div className="cards-grid browse-grid">
        {visibleCourses.length === 0 ? (
          <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
            {subjectDecoded
              ? t("browse.noMatchFilter")
              : t("browse.emptyCatalogue")}{" "}
            {user?.role === "educator" ? (
              <>
                {t("browse.educatorEmptyHint")}{" "}
                <Link to="/my-courses">{t("nav.myTeaching")}</Link>{" "}
                {t("browse.educatorEmptyHintSuffix")}
              </>
            ) : (
              <>{t("browse.studentEmptyHint")}</>
            )}
            {subjectDecoded && (
              <>
                {" "}
                <Link to="/browse">{t("browse.showAll")}</Link>
              </>
            )}
          </p>
        ) : (
          visibleCourses.map((c, i) => (
          <motion.article
            key={c.id}
            className={`course-card${courseFocus === c.id ? " course-card--focus" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            whileHover={{ y: -3 }}
          >
            <Link
              to={`/browse?course=${encodeURIComponent(c.id)}`}
              aria-label={t("browse.openDetailsFor", { title: c.title })}
              style={{ display: "block" }}
            >
              <div className={`thumb ${c.thumb || ""}`.trim()} />
            </Link>
            <h3>
              <Link
                to={`/browse?course=${encodeURIComponent(c.id)}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                {c.title}
              </Link>
            </h3>
            <p>
              {c.source === "educator" && c.educatorId ? (
                <Link to={`/tutor/${encodeURIComponent(c.educatorId)}`}>{c.educator}</Link>
              ) : (
                c.educator
              )}{" "}
              • {t("browse.lessonsCount", { count: c.lessons })} • {c.subject}
            </p>
            <span>{c.price}</span>
            <div className="course-card-actions">
              <Link
                className="outline-btn"
                to={`/browse?course=${encodeURIComponent(c.id)}`}
              >
                {t("common.details")}
              </Link>
              {!user && (
                <Link
                  className="solid-btn"
                  to={loginLinkForCourse(c)}
                >
                  {priceToCents(c.price) > 0 ? t("browse.signInToBuy") : t("browse.signInToEnrol")}
                </Link>
              )}
              {user?.role === "student" && (
                priceToCents(c.price) > 0 ? (
                  <button
                    type="button"
                    className="solid-btn browse-enrol"
                    disabled={Boolean(actionBusyId)}
                    onClick={() => checkout(c.id)}
                  >
                    {actionBusyId === c.id ? t("common.saving") : t("browse.buyNow")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="solid-btn browse-enrol"
                    disabled={Boolean(actionBusyId)}
                    onClick={() => enroll(c.id)}
                  >
                    {actionBusyId === c.id ? t("common.saving") : t("browse.enrol")}
                  </button>
                )
              )}
            </div>
            {isEducator && (
              <p className="educator-browse-note">
                {!user?.verified
                  ? t("browse.publishingDisabled")
                  : c.source === "educator" && c.educatorId === user?.id
                    ? t("browse.yourListing")
                    : t("browse.verifiedAddOwn")}
              </p>
            )}
          </motion.article>
          ))
        )}
      </div>

      <p className="browse-footer-link">
        <Link to="/platform">{t("browse.openLearningHub")}</Link>
      </p>

      {courseFocus && (detailLoading || detail || detailErr) ? (
        <div
          className="course-detail-backdrop"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            ref={detailPanelRef}
            className="course-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="course-detail-close"
              aria-label={t("common.close")}
              onClick={closeDetail}
            >
              ×
            </button>
            {detailLoading ? (
              <p className="field-hint">{t("browse.loadingCourse")}</p>
            ) : detailErr ? (
              <p className="form-error" role="alert">
                {detailErr}
              </p>
            ) : detail ? (
              <>
                <p className="course-detail-source">
                  {detail.source === "educator" ? t("browse.tutorListing") : t("browse.curatedCatalogue")}
                </p>
                <h2 id="course-detail-title">{detail.title}</h2>
                <p className="course-detail-meta">
                  {detail.source === "educator" && detail.educatorId ? (
                    <>
                      <Link to={`/tutor/${encodeURIComponent(detail.educatorId)}`}>
                        {detail.educator}
                      </Link>
                      {" · "}
                      {t("browse.lessonsCount", { count: detail.lessons })} · {detail.subject}
                    </>
                  ) : (
                    <>
                      {detail.educator} · {t("browse.lessonsCount", { count: detail.lessons })} · {detail.subject}
                    </>
                  )}
                </p>
                <p className="course-detail-price">{detail.price}</p>
                <div className="course-detail-body">
                  {String(detail.description || "")
                    .split("\n")
                    .map((para, i) =>
                      para.trim() ? (
                        <p key={i}>{para.trim()}</p>
                      ) : null
                    )}
                </div>
                <div className="course-detail-actions">
                  {detail.source === "educator" && detail.educatorId ? (
                    <Link
                      className="outline-btn"
                      to={`/tutor/${encodeURIComponent(detail.educatorId)}`}
                    >
                      {t("browse.tutorProfile")}
                    </Link>
                  ) : null}
                  {!user && (
                    <Link
                      className="solid-btn"
                      to={loginLinkForCourse(detail)}
                    >
                      {priceToCents(detail.price) > 0 ? t("browse.signInToBuy") : t("browse.signInToEnrol")}
                    </Link>
                  )}
                  {user?.role === "student" && (
                    priceToCents(detail.price) > 0 ? (
                      <button
                        type="button"
                        className="solid-btn"
                        disabled={Boolean(actionBusyId)}
                        onClick={async () => {
                          await checkout(detail.id);
                        }}
                      >
                        {actionBusyId === detail.id ? t("common.saving") : t("browse.buyThisCourse")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="solid-btn"
                        disabled={Boolean(actionBusyId)}
                        onClick={async () => {
                          if (await enroll(detail.id)) closeDetail();
                        }}
                      >
                        {actionBusyId === detail.id ? t("common.saving") : t("browse.enrolThisCourse")}
                      </button>
                    )
                  )}
                  <button type="button" className="outline-btn" onClick={closeDetail}>
                    {t("browse.close")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <AppToast message={okMsg} variant="success" onDismiss={() => setOkMsg("")} />
    </div>
  );
}
