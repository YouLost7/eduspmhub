import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { friendlyNonJsonApiMessage, apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";
import { profilePhotoSrc } from "../lib/profilePhoto.js";
import EducatorAvailability from "../components/EducatorAvailability.jsx";

function ProfileIdentityRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="profile-identity-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function ProfilePage() {
  const { user, updateProfile, refreshMe } = useAuth();
  const { t } = useI18n();
  const [offersOneToOne, setOffersOneToOne] = useState(Boolean(user?.offersOneToOne));
  const [educatorBio, setEducatorBio] = useState(user?.educatorBio || "");
  const [hourlyRate, setHourlyRate] = useState(() => {
    const c = Number(user?.hourlyRateCents) || 0;
    return c > 0 ? (c / 100).toFixed(2) : "";
  });
  const [status, setStatus] = useState({ text: "", ok: true });
  const [bioStatus, setBioStatus] = useState({ text: "", ok: true });
  const [licenseFile, setLicenseFile] = useState(null);
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState({ text: "", ok: true });
  const licenseInputRef = useRef(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoStatus, setPhotoStatus] = useState({ text: "", ok: true });
  const photoInputRef = useRef(null);

  const isEducator = user?.role === "educator";

  useEffect(() => {
    if (!user) return;
    setOffersOneToOne(Boolean(user.offersOneToOne));
    setEducatorBio(user.educatorBio || "");
    const c = Number(user.hourlyRateCents) || 0;
    setHourlyRate(c > 0 ? (c / 100).toFixed(2) : "");
  }, [user]);

  async function onSubmitBio(e) {
    e.preventDefault();
    setBioStatus({ text: "", ok: true });
    try {
      await updateProfile({ educatorBio });
      setBioStatus({ text: t("profile.bioSaved"), ok: true });
    } catch (err) {
      setBioStatus({ text: err.message || t("profile.saveFailed"), ok: false });
    }
  }

  async function onSubmitTeachingSettings(e) {
    e.preventDefault();
    setStatus({ text: "", ok: true });
    try {
      await updateProfile({
        offersOneToOne,
        hourlyRate: offersOneToOne ? hourlyRate : "0",
      });
      setStatus({ text: t("profile.teachingSettingsSaved"), ok: true });
    } catch (err) {
      setStatus({ text: err.message || t("profile.saveFailed"), ok: false });
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

  async function uploadProfilePhoto() {
    setPhotoStatus({ text: "", ok: true });
    if (!photoFile) {
      setPhotoStatus({ text: "Choose a JPEG, PNG, or WebP image first.", ok: false });
      return;
    }
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", photoFile);
      const res = await fetch("/api/profile/photo", {
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
        const msg =
          data.error ||
          htmlHint ||
          (res.status === 413
            ? "Photo too large (max 3 MB)."
            : `Upload failed (${res.status}).`);
        setPhotoStatus({ text: msg, ok: false });
        return;
      }
      await refreshMe();
      setPhotoFile(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      setPhotoStatus({ text: "Profile photo updated.", ok: true });
    } catch {
      setPhotoStatus({ text: "Network error — try again.", ok: false });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removeProfilePhoto() {
    setPhotoStatus({ text: "", ok: true });
    setPhotoBusy(true);
    try {
      await apiJson("/api/profile/photo", { method: "DELETE" });
      await refreshMe();
      setPhotoFile(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      setPhotoStatus({ text: "Profile photo removed.", ok: true });
    } catch (e) {
      setPhotoStatus({ text: e.message || "Could not remove photo.", ok: false });
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div>
      <div className={`user-page-intro${isEducator ? " user-page-intro--educator" : ""}`}>
        <h1>{t("profile.title")}</h1>
        <p>{t("profile.signedInAs", { email: user?.email })}</p>
        {isEducator && (
          <p className="profile-role-line">
            {t("profile.roleEducator")}
            {user?.verified ? (
              <span className="verify-ok"> · {t("common.verified")}</span>
            ) : (
              <span className="verify-pending"> · {t("profile.verificationPending")}</span>
            )}
          </p>
        )}
        {isEducator && !user?.verified && (
          <p className="field-hint" style={{ marginTop: "0.35rem" }}>
            {user?.hasLicenseDocument
              ? t("profile.licenceOnFile")
              : t("profile.uploadLicenceHint")}
          </p>
        )}
      </div>

      <motion.section
        className="profile-form section-block profile-identity"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t("profile.accountDetails")}</h2>
        <p className="field-hint">
          {isEducator ? t("profile.lockedEducator") : t("profile.lockedStudent")}
        </p>
        <dl className="profile-identity-list">
          <ProfileIdentityRow label={t("profile.fullName")} value={user?.fullName} />
          {!isEducator ? (
            <>
              <ProfileIdentityRow label={t("profile.school")} value={user?.schoolName} />
              <ProfileIdentityRow label={t("profile.formLevel")} value={user?.studentForm} />
              <ProfileIdentityRow label={t("profile.mainSubject")} value={user?.studentSubject} />
            </>
          ) : (
            <>
              <ProfileIdentityRow label={t("profile.institution")} value={user?.educatorInstitution} />
              <ProfileIdentityRow label={t("profile.primarySubject")} value={user?.educatorSubject} />
            </>
          )}
        </dl>
      </motion.section>

      {isEducator && (
        <motion.form
          className="profile-form section-block"
          onSubmit={onSubmitBio}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t("profile.bioTitle")}</h2>
          <p className="field-hint">{t("profile.bioHint")}</p>
          <div className="field">
            <label htmlFor="pf-bio">{t("profile.yourBio")}</label>
            <textarea
              id="pf-bio"
              rows={4}
              value={educatorBio}
              onChange={(e) => setEducatorBio(e.target.value)}
              placeholder={t("profile.bioPlaceholder")}
            />
          </div>
          <button type="submit" className="solid-btn">
            {t("profile.saveBio")}
          </button>
          {bioStatus.text && (
            <p className={bioStatus.ok ? "form-success" : "form-error"}>{bioStatus.text}</p>
          )}
        </motion.form>
      )}

      <motion.section
        className="profile-form section-block"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Profile photo</h2>
        <p className="field-hint">
          Optional — a clear photo of your face helps classmates and students recognise you.
          JPEG, PNG, or WebP, max 3 MB. Only signed-in users on EduSPM Hub can load this image
          (it is not a public internet link without your session).
        </p>
        {user?.hasProfilePhoto ? (
          <div className="profile-photo-preview-wrap">
            <img
              className="profile-photo-preview"
              src={profilePhotoSrc(user.id, user.avatarUploadedAt)}
              alt=""
              width={140}
              height={140}
            />
          </div>
        ) : (
          <p className="field-hint">No photo on file yet.</p>
        )}
        <div className="field">
          <label htmlFor="pf-photo">Upload image</label>
          <input
            ref={photoInputRef}
            id="pf-photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={photoBusy}
            onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
          />
        </div>
        <div className="profile-photo-actions">
          <button
            type="button"
            className="solid-btn"
            disabled={photoBusy}
            onClick={uploadProfilePhoto}
          >
            {photoBusy ? "Working…" : user?.hasProfilePhoto ? "Replace photo" : "Upload photo"}
          </button>
          {user?.hasProfilePhoto ? (
            <button
              type="button"
              className="outline-btn"
              style={{ marginLeft: "0.5rem", color: "#b91c1c", borderColor: "#fecaca" }}
              disabled={photoBusy}
              onClick={removeProfilePhoto}
            >
              Remove photo
            </button>
          ) : null}
        </div>
        {photoStatus.text ? (
          <p className={photoStatus.ok ? "form-success" : "form-error"}>{photoStatus.text}</p>
        ) : null}
      </motion.section>

      {isEducator && user?.offersOneToOne && (
        <EducatorAvailability verified={Boolean(user?.verified)} />
      )}

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

      {isEducator && (
        <motion.form
          className="profile-form section-block"
          onSubmit={onSubmitTeachingSettings}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>{t("profile.oneOnOneTutoring")}</h2>
          <p className="field-hint">
            You can turn live tutoring on or off and set your hourly rate here. Name, institution,
            and subject stay as registered.
          </p>
          <div className="field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={offersOneToOne}
                onChange={(e) => setOffersOneToOne(e.target.checked)}
                disabled={!user?.verified}
              />
              Offer live 1-on-1 tutoring (homeschool-style hourly sessions)
            </label>
          </div>
          {offersOneToOne && (
            <div className="field">
              <label htmlFor="pf-hourly">Hourly rate (RM)</label>
              <input
                id="pf-hourly"
                type="number"
                min="2"
                step="0.50"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="e.g. 45.00"
                disabled={!user?.verified}
              />
              <p className="field-hint">
                Minimum RM2.00/hour for Stripe. Students pay hours × rate at checkout.
              </p>
            </div>
          )}
          {!user?.verified && offersOneToOne && (
            <p className="field-hint">
              Verification is required before students can book and pay you.
            </p>
          )}
          {user?.verified && (
            <p className="field-hint">
              Manage incoming bookings on <Link to="/bookings">1-on-1 bookings</Link>.
            </p>
          )}
          <button type="submit" className="solid-btn">
            Save teaching settings
          </button>
          {status.text && (
            <p className={status.ok ? "form-success" : "form-error"}>{status.text}</p>
          )}
        </motion.form>
      )}
    </div>
  );
}
