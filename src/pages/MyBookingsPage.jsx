import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function MyBookingsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [reviewDraft, setReviewDraft] = useState({});

  const isEducator = user?.role === "educator";

  const statusLabel = useCallback(
    (status) => {
      const map = {
        paid: t("bookings.statusPaid"),
        accepted: t("bookings.statusAccepted"),
        completed: t("bookings.statusCompleted"),
        declined: t("bookings.statusDeclined"),
        cancelled: t("bookings.statusCancelled"),
      };
      return map[status] || status;
    },
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/tutoring/bookings");
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
    } catch (e) {
      setErr(e.message || t("bookings.loadError"));
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const sessionId = searchParams.get("session_id");
    if (!user || user.role !== "student") return;
    if (paymentStatus !== "success") return;
    let cancelled = false;
    (async () => {
      try {
        if (sessionId) {
          await apiJson("/api/payments/confirm-session", {
            method: "POST",
            body: { sessionId },
          });
        }
        if (!cancelled) {
          await load();
          setOkMsg(t("bookings.paymentConfirmed"));
          const next = new URLSearchParams(searchParams);
          next.delete("payment");
          next.delete("session_id");
          next.delete("booking");
          next.delete("mock");
          setSearchParams(next, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || t("bookings.confirmPaymentError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, searchParams, setSearchParams, t, user]);

  async function tutorAction(id, action) {
    setBusyId(id);
    setErr("");
    try {
      await apiJson(`/api/tutoring/bookings/${encodeURIComponent(id)}/${action}`, {
        method: "PATCH",
      });
      await load();
      setOkMsg(t("bookings.bookingUpdated"));
    } catch (e) {
      setErr(e.message || t("bookings.actionFailed"));
    } finally {
      setBusyId("");
    }
  }

  async function submitReview(bookingId) {
    const draft = reviewDraft[bookingId] || {};
    const rating = Number.parseInt(String(draft.rating ?? ""), 10);
    const comment = String(draft.comment || "").trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      setErr(t("bookings.ratingRequired"));
      return;
    }
    setBusyId(bookingId);
    setErr("");
    try {
      await apiJson(`/api/tutoring/bookings/${encodeURIComponent(bookingId)}/review`, {
        method: "POST",
        body: { rating, comment },
      });
      await load();
      setOkMsg(t("bookings.reviewSaved"));
    } catch (e) {
      setErr(e.message || t("bookings.reviewSaveError"));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>{isEducator ? t("bookings.titleEducator") : t("bookings.titleStudent")}</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          {isEducator ? t("bookings.introEducator") : t("bookings.introStudent")}
        </p>
      </div>

      {!isEducator && (
        <p style={{ marginBottom: "1rem" }}>
          <Link to="/browse">{t("bookings.browseTutors")}</Link>
          {" · "}
          <Link to="/tutoring">{t("bookings.findTutors")}</Link>
        </p>
      )}

      {loading && <p className="field-hint">{t("common.loading")}</p>}
      {okMsg && (
        <p className="form-success" role="status">
          {okMsg}
        </p>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && bookings.length === 0 && (
        <p className="field-hint">{t("bookings.empty")}</p>
      )}

      <ul className="booking-list">
        {bookings.map((b) => (
          <li key={b.id} className="booking-card section-block">
            <div className="booking-card-head">
              <strong>
                {isEducator ? b.studentName : b.tutorName}
                {!isEducator && b.tutorSubject ? ` · ${b.tutorSubject}` : ""}
              </strong>
              <span className="role-pill">{statusLabel(b.status)}</span>
            </div>
            <p className="field-hint" style={{ margin: "0.35rem 0" }}>
              {formatWhen(b.scheduledStart)} → {formatWhen(b.scheduledEnd)} ({b.hours}h)
            </p>
            <p className="field-hint" style={{ margin: 0 }}>
              {t("bookings.totalPerHour", { amount: b.amountLabel, rate: b.hourlyRateLabel })}
            </p>
            {b.studentMessage ? (
              <p className="booking-message">
                <em>{t("bookings.messageLabel")}</em> {b.studentMessage}
              </p>
            ) : null}

            <div className="booking-actions">
              {isEducator && b.status === "paid" && (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === b.id}
                    onClick={() => tutorAction(b.id, "accept")}
                  >
                    {t("bookings.accept")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === b.id}
                    onClick={() => tutorAction(b.id, "decline")}
                  >
                    {t("bookings.decline")}
                  </button>
                </>
              )}
              {isEducator && b.status === "accepted" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === b.id}
                  onClick={() => tutorAction(b.id, "complete")}
                >
                  {t("bookings.markComplete")}
                </button>
              )}
              {!isEducator && b.status === "completed" && !b.myReview && (
                <div className="booking-review-form">
                  <label>
                    {t("bookings.yourRating")}
                    <select
                      value={reviewDraft[b.id]?.rating ?? ""}
                      onChange={(e) =>
                        setReviewDraft((prev) => ({
                          ...prev,
                          [b.id]: { ...prev[b.id], rating: e.target.value },
                        }))
                      }
                    >
                      <option value="">{t("bookings.chooseRating")}</option>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n === 1 ? t("bookings.star", { count: n }) : t("bookings.stars", { count: n })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("bookings.feedbackOptional")}
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={reviewDraft[b.id]?.comment ?? ""}
                      onChange={(e) =>
                        setReviewDraft((prev) => ({
                          ...prev,
                          [b.id]: { ...prev[b.id], comment: e.target.value },
                        }))
                      }
                      placeholder={t("bookings.feedbackPlaceholder")}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === b.id}
                    onClick={() => submitReview(b.id)}
                  >
                    {t("bookings.submitReview")}
                  </button>
                </div>
              )}
              {!isEducator && b.myReview && (
                <p className="field-hint">
                  {t("bookings.youRated", { rating: b.myReview.rating })}
                  {b.myReview.comment ? `: “${b.myReview.comment}”` : "."}
                </p>
              )}
              {!isEducator && (
                <Link to={`/tutor/${encodeURIComponent(b.tutorId)}`}>
                  {t("bookings.viewTutorProfile")}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
