import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import TutoringSlotPicker from "../components/TutoringSlotPicker.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function TutorProfilePage() {
  const { tutorId } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
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
      setErr(e.message || t("tutor.loadError"));
    } finally {
      setLoading(false);
    }
  }, [tutorId, t]);

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
      setBookingMsg({ text: t("tutor.chooseSlot"), ok: false });
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
      setBookingMsg({ text: t("tutor.sessionBooked"), ok: true });
    } catch (e2) {
      setBookingMsg({ text: e2.message || t("tutor.bookError"), ok: false });
    } finally {
      setBookingBusy(false);
    }
  }

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">{t("tutor.backToBrowse")}</Link>
          {" · "}
          <Link to="/tutoring">{t("tutor.oneOnOneTutors")}</Link>
        </p>
        <h1>{t("tutor.title")}</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          {t("tutor.intro")}
        </p>
      </div>

      {loading && <p className="field-hint">{t("common.loading")}</p>}
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
                  <span className="role-pill role-pill--edu">{t("tutor.verifiedBadge")}</span>
                ) : (
                  <span className="role-pill">{t("tutor.verificationPending")}</span>
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
                    {t("tutor.thisIsYou")}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          {tutor.educatorBio?.trim() ? (
            <div className="tutor-profile-bio">
              <h3>{t("tutor.about")}</h3>
              <div className="learn-body learn-body--pre">{tutor.educatorBio.trim()}</div>
            </div>
          ) : (
            <p className="field-hint">{t("tutor.noBio")}</p>
          )}

          {availability.length > 0 && (
            <section className="tutor-availability-section">
              <h3>{t("tutor.weeklyAvailability")}</h3>
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
              <h3>{t("tutor.bookSession")}</h3>
              <p className="field-hint">{t("tutor.bookHint")}</p>
              <form onSubmit={requestBooking} className="tutor-booking-form">
                <label>
                  {t("tutor.sessionLength")}
                  <select
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    required
                  >
                    {[0.5, 1, 1.5, 2, 3, 4].map((h) => (
                      <option key={h} value={h}>
                        {h === 1 ? t("tutor.hour", { count: h }) : t("tutor.hours", { count: h })}
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
                  {t("tutor.messageToTutor")}
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t("tutor.messagePlaceholder")}
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
                  {bookingBusy ? t("tutor.redirectingPayment") : t("tutor.bookAndPay")}
                </button>
              </form>
            </section>
          )}

          {isStudent && tutor.verified && !tutor.offersOneToOne && !isSelf && (
            <p className="field-hint">{t("tutor.notOfferingOneOnOne")}</p>
          )}
          {isStudent &&
            tutor.verified &&
            tutor.offersOneToOne &&
            availability.length === 0 &&
            !isSelf && (
              <p className="field-hint">{t("tutor.noAvailability")}</p>
            )}

          <section className="tutor-profile-courses">
            <h3>{t("tutor.publishedCourses", { count: courses.length })}</h3>
            {courses.length === 0 ? (
              <p className="field-hint">{t("tutor.noPublishedListings")}</p>
            ) : (
              <ul className="tutor-profile-course-list">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link to={`/browse?course=${encodeURIComponent(c.id)}`}>
                      <strong>{c.title}</strong>
                      <span className="field-hint" style={{ display: "block", marginTop: "0.15rem" }}>
                        {c.subject} · {c.lessons}{" "}
                        {c.lessons === 1 ? t("common.lesson") : t("common.lessons")} · {c.price}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tutor-reviews-section">
            <h3>{t("tutor.studentFeedback", { count: reviews.length })}</h3>
            {reviews.length === 0 ? (
              <p className="field-hint">{t("tutor.noReviews")}</p>
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
              {t("tutor.selfHintRate")} <Link to="/profile">{t("common.profile")}</Link>.{" "}
              {t("tutor.selfHintBookings")}{" "}
              <Link to="/bookings">{t("nav.oneOnOneBookings")}</Link>.
            </p>
          ) : isStudent ? (
            <p className="field-hint" style={{ marginTop: "1rem" }}>
              <Link to="/bookings">{t("tutor.viewAllBookings")}</Link>
            </p>
          ) : null}
        </motion.article>
      )}
    </div>
  );
}
