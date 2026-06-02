import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusLabel(status) {
  const map = {
    paid: "Paid — tutor to accept",
    accepted: "Scheduled",
    completed: "Completed",
    declined: "Declined (refund if paid)",
    cancelled: "Cancelled",
  };
  return map[status] || status;
}

export default function MyBookingsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bookings, setBookings] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [reviewDraft, setReviewDraft] = useState({});

  const isEducator = user?.role === "educator";

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/tutoring/bookings");
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
    } catch (e) {
      setErr(e.message || "Could not load bookings");
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
          setOkMsg("Payment confirmed. Your tutor will accept the session soon.");
          const next = new URLSearchParams(searchParams);
          next.delete("payment");
          next.delete("session_id");
          next.delete("booking");
          next.delete("mock");
          setSearchParams(next, { replace: true });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Could not confirm payment yet.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, searchParams, setSearchParams, user]);

  async function tutorAction(id, action) {
    setBusyId(id);
    setErr("");
    try {
      await apiJson(`/api/tutoring/bookings/${encodeURIComponent(id)}/${action}`, {
        method: "PATCH",
      });
      await load();
      setOkMsg(`Booking updated.`);
    } catch (e) {
      setErr(e.message || "Action failed");
    } finally {
      setBusyId("");
    }
  }

  async function submitReview(bookingId) {
    const draft = reviewDraft[bookingId] || {};
    const rating = Number.parseInt(String(draft.rating ?? ""), 10);
    const comment = String(draft.comment || "").trim();
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      setErr("Choose a rating from 1 to 5 stars.");
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
      setOkMsg("Thank you — your review was saved.");
    } catch (e) {
      setErr(e.message || "Could not save review");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>{isEducator ? "1-on-1 bookings" : "My tutoring bookings"}</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          {isEducator
            ? "Students who hire you for live 1-on-1 sessions appear here. Accept paid bookings, then mark complete after the session."
            : "Book tutors for homeschool-style 1-on-1 help. Pay securely with Stripe, then leave feedback after the session."}
        </p>
      </div>

      {!isEducator && (
        <p style={{ marginBottom: "1rem" }}>
          <Link to="/browse">Browse tutors</Link>
          {" · "}
          <Link to="/tutoring">Find 1-on-1 tutors</Link>
        </p>
      )}

      {loading && <p className="field-hint">Loading…</p>}
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
        <p className="field-hint">No bookings yet.</p>
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
              {b.amountLabel} total · {b.hourlyRateLabel}/hr
            </p>
            {b.studentMessage ? (
              <p className="booking-message">
                <em>Message:</em> {b.studentMessage}
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
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === b.id}
                    onClick={() => tutorAction(b.id, "decline")}
                  >
                    Decline
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
                  Mark session complete
                </button>
              )}
              {!isEducator && b.status === "completed" && !b.myReview && (
                <div className="booking-review-form">
                  <label>
                    Your rating (1–5)
                    <select
                      value={reviewDraft[b.id]?.rating ?? ""}
                      onChange={(e) =>
                        setReviewDraft((prev) => ({
                          ...prev,
                          [b.id]: { ...prev[b.id], rating: e.target.value },
                        }))
                      }
                    >
                      <option value="">Choose…</option>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} star{n === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Feedback (optional)
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
                      placeholder="How was the session?"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === b.id}
                    onClick={() => submitReview(b.id)}
                  >
                    Submit review
                  </button>
                </div>
              )}
              {!isEducator && b.myReview && (
                <p className="field-hint">
                  You rated this session {b.myReview.rating}/5
                  {b.myReview.comment ? `: “${b.myReview.comment}”` : "."}
                </p>
              )}
              {!isEducator && (
                <Link to={`/tutor/${encodeURIComponent(b.tutorId)}`}>View tutor profile</Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
