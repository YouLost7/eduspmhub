import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { friendlyNonJsonApiMessage } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProfilePage() {
  const { user, updateProfile, refreshMe } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [schoolName, setSchoolName] = useState(user?.schoolName || "");
  const [studentForm, setStudentForm] = useState(user?.studentForm || "");
  const [educatorInstitution, setEducatorInstitution] = useState(
    user?.educatorInstitution || ""
  );
  const [educatorBio, setEducatorBio] = useState(user?.educatorBio || "");
  const [status, setStatus] = useState({ text: "", ok: true });
  const [licenseFile, setLicenseFile] = useState(null);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState({ text: "", ok: true });
  const licenseInputRef = useRef(null);

  const isEducator = user?.role === "educator";

  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName || "");
    setSchoolName(user.schoolName || "");
    setStudentForm(user.studentForm || "");
    setEducatorInstitution(user.educatorInstitution || "");
    setEducatorBio(user.educatorBio || "");
  }, [user]);

  async function onSubmit(e) {
    e.preventDefault();
    setStatus({ text: "", ok: true });
    try {
      if (isEducator) {
        await updateProfile({
          fullName,
          educatorInstitution,
          educatorBio,
        });
      } else {
        await updateProfile({
          fullName,
          schoolName,
          studentForm,
        });
      }
      setStatus({ text: "Profile saved.", ok: true });
    } catch (err) {
      setStatus({ text: err.message || "Save failed", ok: false });
    }
  }

  async function uploadEducatorLicense() {
    setLicenseStatus({ text: "", ok: true });
    if (!licenseFile) {
      setLicenseStatus({ text: "Choose a PDF or image file first.", ok: false });
      return;
    }
    setLicenseBusy(true);
    try {
      const fd = new FormData();
      fd.append("license", licenseFile);
      const res = await fetch("/api/educator/license", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        const htmlHint = friendlyNonJsonApiMessage(raw);
        let msg =
          data.error ||
          htmlHint ||
          (res.status === 401
            ? "Not signed in — open Profile again after signing in."
            : res.status === 403
              ? "Only educator accounts can upload a licence."
              : res.status === 413
                ? "File too large (max 8 MB)."
                : `Upload failed (${res.status}).`);
        setLicenseStatus({ text: msg, ok: false });
        return;
      }
      const verifiedNow = Boolean(data.user?.verified);
      await refreshMe();
      setLicenseFile(null);
      if (licenseInputRef.current) licenseInputRef.current.value = "";
      setLicenseStatus({
        text: verifiedNow
          ? "Licence file updated on your account."
          : "Licence received. Our team will review it before your profile can show as verified to students.",
        ok: true,
      });
    } catch {
      setLicenseStatus({ text: "Network error — try again.", ok: false });
    } finally {
      setLicenseBusy(false);
    }
  }

  return (
    <div>
      <div className={`user-page-intro${isEducator ? " user-page-intro--educator" : ""}`}>
        <h1>Profile</h1>
        <p>Signed in as {user?.email}</p>
        {isEducator && (
          <p className="profile-role-line">
            Role: <strong>Educator</strong>
            {user?.verified ? (
              <span className="verify-ok"> · Verified</span>
            ) : (
              <span className="verify-pending"> · Verification pending</span>
            )}
          </p>
        )}
        {isEducator && !user?.verified && (
          <p className="field-hint" style={{ marginTop: "0.35rem" }}>
            {user?.hasLicenseDocument
              ? "Your certified licence is on file — we will confirm it before unlocking teaching tools."
              : "Upload your certified educator licence below. We only verify tutors after reviewing this document."}
          </p>
        )}
      </div>

      {isEducator && (
        <motion.section
          className="profile-form section-block"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Certified educator licence</h2>
          <p className="field-hint">
            Upload a clear scan or photo of your teaching registration, MOE recognition,
            diploma in education, or similar official proof. Accepted formats:{" "}
            <strong>PDF, JPEG, or PNG</strong> (max 8 MB). This file is reviewed by
            staff only — it is not shown to students; students only see that you passed
            verification after approval.
          </p>
          {user?.hasLicenseDocument && (
            <p className="field-hint">
              Current file:{" "}
              <strong>{user.licenseOriginalName || "Uploaded document"}</strong>
              {user.licenseUploadedAt
                ? ` · submitted ${new Date(user.licenseUploadedAt).toLocaleString()}`
                : ""}
            </p>
          )}
          <div className="field">
            <label htmlFor="pf-license">Licence document</label>
            <input
              ref={licenseInputRef}
              id="pf-license"
              name="license"
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
            />
          </div>
          <button
            type="button"
            className="solid-btn"
            disabled={licenseBusy}
            onClick={uploadEducatorLicense}
          >
            {licenseBusy ? "Uploading…" : user?.hasLicenseDocument ? "Replace file" : "Upload licence"}
          </button>
          {licenseStatus.text && (
            <p className={licenseStatus.ok ? "form-success" : "form-error"}>
              {licenseStatus.text}
            </p>
          )}
        </motion.section>
      )}

      <motion.form
        className="profile-form section-block"
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="field">
          <label htmlFor="pf-name">Full name</label>
          <input
            id="pf-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        {!isEducator && (
          <>
            <div className="field">
              <label htmlFor="pf-school">School</label>
              <input
                id="pf-school"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pf-form">Form / level</label>
              <input
                id="pf-form"
                value={studentForm}
                onChange={(e) => setStudentForm(e.target.value)}
                placeholder="e.g. Form 5"
              />
            </div>
            <p className="field-hint">Main subject on file: {user?.studentSubject}</p>
          </>
        )}

        {isEducator && (
          <>
            <div className="field">
              <label htmlFor="pf-inst">Institution</label>
              <input
                id="pf-inst"
                value={educatorInstitution}
                onChange={(e) => setEducatorInstitution(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pf-bio">Bio</label>
              <textarea
                id="pf-bio"
                rows={4}
                value={educatorBio}
                onChange={(e) => setEducatorBio(e.target.value)}
              />
            </div>
            <p className="field-hint">
              Primary subject on file: {user?.educatorSubject}
            </p>
          </>
        )}

        <button type="submit" className="solid-btn">
          Save changes
        </button>
        {status.text && (
          <p className={status.ok ? "form-success" : "form-error"}>{status.text}</p>
        )}
      </motion.form>
    </div>
  );
}
