import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import EducatorMyTeaching from "../components/EducatorMyTeaching.jsx";

function priceToCents(priceLike) {
  const raw = String(priceLike ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^RM\s*/i, "").replace(/,/g, "");
  const num = Number.parseFloat(cleaned.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 100);
}

export default function MyCoursesPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState([]);
  const [err, setErr] = useState("");
  const isEducator = user?.role === "educator";

  const load = useCallback(async () => {
    try {
      const data = await apiJson("/api/my-courses");
      setCourses(data.courses || []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    if (!isEducator) load();
  }, [isEducator, load]);

  if (isEducator) {
    return (
      <div>
        {!user?.verified ? (
          <div className="user-page-intro user-page-intro--educator">
            <h1>My teaching</h1>
            <p>
              Manage courses you publish to SPM students. This view is tailored for
              educators — different from the student &quot;My courses&quot; list.
            </p>
            <div className="locked-panel">
              <p>
                <strong>Locked:</strong>{" "}
                {!user?.hasLicenseDocument
                  ? "Upload your certified educator licence on Profile first. We verify tutors only after reviewing that document."
                  : "Your licence is under review. Teaching tools unlock after our team approves your document."}
              </p>
              <Link to="/profile">Profile — licence upload</Link>
            </div>
          </div>
        ) : (
          <EducatorMyTeaching />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>My courses</h1>
        <p>
          Everything you have enrolled in appears here. Browse the catalogue to add
          more.
        </p>
        <Link className="solid-btn" to="/browse">
          Browse courses
        </Link>
      </div>

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <section className="section-block my-list">
        <h2>Your enrolments</h2>
        {courses.length === 0 ? (
          <p className="empty-list">No courses yet — browse and tap Enrol to add one.</p>
        ) : (
          <ul className="enrol-list">
            {courses.map((c) => (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <span className="enrol-course-block">
                  <strong>{c.title}</strong>
                <span className="field-hint" style={{ display: "block", marginTop: "0.2rem" }}>
                  {c.source === "educator" && c.educatorId ? (
                    <>
                      Tutor:{" "}
                      <Link to={`/tutor/${encodeURIComponent(c.educatorId)}`}>{c.educator}</Link>
                    </>
                  ) : (
                    <>Tutor: {c.educator}</>
                  )}{" "}
                  · {c.price}
                  {" · "}
                  <strong>{priceToCents(c.price) > 0 ? "Paid" : "Free"}</strong>
                </span>
                </span>
                <Link className="solid-btn" style={{ fontSize: "0.86rem" }} to={`/learn/${encodeURIComponent(c.id)}`}>
                  Open lessons
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
