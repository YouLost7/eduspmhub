import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import TutoringSlotPicker from "../components/TutoringSlotPicker.jsx";

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function TutorProfilePage() {
  const { tutorId } = useParams();
  const { user } = useAuth();
  const [tutor, setTutor] = useState(null);
  const [courses, setCourses] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [err, setErr] = useState("");
  const [bookingMsg, setBookingMsg] = useState({ text: "", ok: true });
  const [loading, setLoading] = useState(true);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [hours, setHours] = useState("1");
  const [selectedSlotStart, setSelectedSlotStart] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!tutorId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson(`/api/tutors/${encodeURIComponent(tutorId)}`);
      setTutor(data.tutor || null);
      setCourses(Array.isArray(data.courses) ? data.courses : []);
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      setAvailability(Array.isArray(data.availability) ? data.availability : []);
    } catch (e) {
      setTutor(null);
      setCourses([]);
      setReviews([]);
      setAvailability([]);
      setErr(e.message || "Could not load this tutor.");
    } finally {
      setLoading(false);
    }
  }, [tutorId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedSlotStart("");
  }, [hours]);

  const isSelf = user?.id && tutor?.id && user.id === tutor.id;
  const isStudent = user?.role === "student";
  const canBook =
    isStudent &&
    !isSelf &&
    tutor?.verified &&
    tutor?.offersOneToOne &&
    Number(tutor?.hourlyRateCents) >= 200;

  async function requestBooking(e) {
    e.preventDefault();
    setBookingMsg({ text: "", ok: true });
    if (!canBook) return;
    if (!selectedSlotStart) {
      setBookingMsg({ text: "Please choose an available time slot.", ok: false });
      return;
    }
    setBookingBusy(true);
    try {
      const checkout = await apiJson("/api/tutoring/checkout", {
        method: "POST",
        body: {
          tutorId: tutor.id,
          hours: Number(hours),
          scheduledStart: selectedSlotStart,
          message,
        },
      });
      if (checkout.checkoutUrl) {
        window.location.assign(checkout.checkoutUrl);
        return;
      }
      setBookingMsg({ text: "Session booked.", ok: true });
    } catch (e2) {
      setBookingMsg({ text: e2.message || "Could not book session", ok: false });
    } finally {
      setBookingBusy(false);
    }
  }

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">← Browse</Link>
          {" · "}
          <Link to="/tutoring">1-on-1 tutors</Link>
        </p>
        <h1>Tutor profile</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          Courses and live 1-on-1 hiring. Contact details stay private.
        </p>
      </div>

      {loading && <p className="field-hint">Loading…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && tutor && (
        <motion.article
          className="tutor-profile-card section-block"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="tutor-profile-head">
            {tutor.hasProfilePhoto ? (
              <img
                className="tutor-profile-photo"
                src={profilePhotoSrc(tutor.id, tutor.avatarUploadedAt)}
                alt=""
                width={56}
                height={56}
              />
            ) : (
              <div className="tutor-profile-avatar" aria-hidden="true">
                {String(tutor.fullName || "?")
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
            <div className="tutor-profile-head-text">
              <h2 className="tutor-profile-name">{tutor.fullName}</h2>
              <p className="tutor-profile-line">
                {(tutor.educatorSubject || "SPM").trim()}
                {tutor.educatorInstitution ? ` · ${tutor.educatorInstitution}` : ""}
              </p>
              <p className="tutor-profile-badges">
                {tutor.verified ? (
                  <span className="role-pill role-pill--edu">Verified on EduSPM Hub</span>
                ) : (
                  <span className="role-pill">Verification pending</span>
                )}
                {tutor.offersOneToOne && tutor.hourlyRateLabel ? (
                  <span className="role-pill" style={{ marginLeft: "0.35rem" }}>
                    {tutor.hourlyRateLabel}
                  </span>
                ) : null}
                {tutor.reviewCount > 0 ? (
                  <span className="role-pill" style={{ marginLeft: "0.35rem" }}>
                    ★ {tutor.averageRating} ({tutor.reviewCount})
                  </span>
                ) : null}
                {isSelf ? (
                  <span className="role-pill" style={{ marginLeft: "0.35rem" }}>
                    This is you
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {tutor.educatorBio?.trim() ? (
            <div className="tutor-profile-bio">
              <h3>About</h3>
              <div className="learn-body learn-body--pre">{tutor.educatorBio.trim()}</div>
            </div>
          ) : (
            <p className="field-hint">This tutor has not added a public bio yet.</p>
          )}

          {availability.length > 0 && (
            <section className="tutor-availability-section">
              <h3>Weekly availability</h3>
              <ul className="tutor-availability-list">
                {availability.map((s) => (
                  <li key={s.id}>
                    <strong>{s.dayLabel}</strong> {s.startTime} – {s.endTime}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canBook && availability.length > 0 && (
            <section className="tutor-booking-panel section-block">
              <h3>Book 1-on-1 session</h3>
              <p className="field-hint">
                Choose session length, then pick an open slot below. Payment is via Stripe;
                refunds apply automatically if the tutor declines.
              </p>
              <form onSubmit={requestBooking} className="tutor-booking-form">
                <label>
                  Session length (hours)
                  <select
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    required
                  >
                    {[0.5, 1, 1.5, 2, 3, 4].map((h) => (
                      <option key={h} value={h}>
                        {h} hour{h === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
                <TutoringSlotPicker
                  tutorId={tutor.id}
                  hours={Number(hours)}
                  hourlyRateLabel={tutor.hourlyRateLabel}
                  selectedStart={selectedSlotStart}
                  onSelect={setSelectedSlotStart}
                />
                <label>
                  Message to tutor (optional)
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Topics you want to cover, Form 4/5, etc."
                  />
                </label>
                {bookingMsg.text ? (
                  <p className={bookingMsg.ok ? "form-success" : "form-error"} role="alert">
                    {bookingMsg.text}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={bookingBusy || !selectedSlotStart}
                >
                  {bookingBusy ? "Redirecting to payment…" : "Book & pay with Stripe"}
                </button>
              </form>
            </section>
          )}

          {isStudent && tutor.verified && !tutor.offersOneToOne && !isSelf && (
            <p className="field-hint">This tutor is not offering live 1-on-1 sessions yet.</p>
          )}
          {isStudent &&
            tutor.verified &&
            tutor.offersOneToOne &&
            availability.length === 0 &&
            !isSelf && (
              <p className="field-hint">
                This tutor has not published weekly availability yet.
              </p>
            )}

          <section className="tutor-profile-courses">
            <h3>Published courses ({courses.length})</h3>
            {courses.length === 0 ? (
              <p className="field-hint">No published listings yet.</p>
            ) : (
              <ul className="tutor-profile-course-list">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link to={`/browse?course=${encodeURIComponent(c.id)}`}>
                      <strong>{c.title}</strong>
                      <span className="field-hint" style={{ display: "block", marginTop: "0.15rem" }}>
                        {c.subject} · {c.lessons} lesson{c.lessons === 1 ? "" : "s"} · {c.price}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tutor-reviews-section">
            <h3>Student feedback ({reviews.length})</h3>
            {reviews.length === 0 ? (
              <p className="field-hint">No reviews yet.</p>
            ) : (
              <ul className="tutor-review-list">
                {reviews.map((r) => (
                  <li key={r.id} className="tutor-review-item">
                    <p className="tutor-review-stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</p>
                    {r.comment ? <p>{r.comment}</p> : null}
                    <p className="field-hint">{formatWhen(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isSelf ? (
            <p className="field-hint" style={{ marginTop: "1rem" }}>
              Set your hourly rate under <Link to="/profile">Profile</Link>. Manage bookings under{" "}
              <Link to="/bookings">1-on-1 bookings</Link>.
            </p>
          ) : isStudent ? (
            <p className="field-hint" style={{ marginTop: "1rem" }}>
              <Link to="/bookings">View all your bookings</Link>
            </p>
          ) : null}
        </motion.article>
      )}
    </div>
  );
}
