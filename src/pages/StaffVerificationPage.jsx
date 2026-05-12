import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

const STORAGE_KEY = "eduspmhub_staff_admin_key";

function staffHeaders(adminKey) {
  return {
    "Content-Type": "application/json",
    "X-Admin-Key": adminKey,
  };
}

export default function StaffVerificationPage() {
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [banner, setBanner] = useState({ text: "", ok: true });
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    try {
      const k = sessionStorage.getItem(STORAGE_KEY) || "";
      setAdminKey(k);
      setKeyInput(k);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const fetchPending = useCallback(async () => {
    setLoadErr("");
    setBanner({ text: "", ok: true });
    if (!adminKey.trim()) {
      setPending([]);
      setLoadErr("");
      return;
    }
    try {
      const res = await fetch("/api/admin/educators-pending", {
        credentials: "include",
        headers: { "X-Admin-Key": adminKey.trim() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr(data.error || `Request failed (${res.status})`);
        setPending([]);
        return;
      }
      setPending(data.educators || []);
    } catch {
      setLoadErr("Network error — is the API running? Use npm run dev:all.");
      setPending([]);
    }
  }, [adminKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (!adminKey.trim()) {
      setPending([]);
      return;
    }
    fetchPending();
  }, [hydrated, adminKey, fetchPending]);

  function saveKey() {
    const k = keyInput.trim();
    setAdminKey(k);
    try {
      if (k) sessionStorage.setItem(STORAGE_KEY, k);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setBanner({
      text: k
        ? "Key saved for this browser tab only. Reload the queue below."
        : "Key cleared.",
      ok: true,
    });
  }

  function clearKey() {
    setKeyInput("");
    setAdminKey("");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setPending([]);
    setBanner({ text: "Staff key removed from this tab.", ok: true });
  }

  async function openLicense(educatorId) {
    setBanner({ text: "", ok: true });
    if (!adminKey.trim()) return;
    try {
      const res = await fetch(`/api/admin/educator/${encodeURIComponent(educatorId)}/license`, {
        credentials: "include",
        headers: { "X-Admin-Key": adminKey.trim() },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBanner({ text: data.error || "Could not open licence file.", ok: false });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch {
      setBanner({ text: "Could not download licence file.", ok: false });
    }
  }

  async function verifyEducator(email) {
    setBusyId(email);
    setBanner({ text: "", ok: true });
    try {
      const res = await fetch("/api/admin/verify-educator", {
        method: "POST",
        credentials: "include",
        headers: staffHeaders(adminKey.trim()),
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ text: data.error || `Verify failed (${res.status})`, ok: false });
        return;
      }
      setBanner({ text: `Verified: ${email}`, ok: true });
      await fetchPending();
    } catch {
      setBanner({ text: "Network error during verify.", ok: false });
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="staff-page">
      <header className="staff-page__header">
        <div>
          <p className="staff-page__eyebrow">Internal tool</p>
          <h1>Educator verification</h1>
          <p className="staff-page__lede">
            Review uploaded teaching licences and approve educators. This route is separate from
            the student and educator hub — open only in a trusted environment.
          </p>
        </div>
        <Link to="/" className="outline-btn">
          Back to site
        </Link>
      </header>

      <section className="staff-card section-block">
        <h2>Staff API key</h2>
        <p className="field-hint">
          Use the same secret as server env <code>ADMIN_KEY</code> (default in dev:{" "}
          <code>dev-admin-change-me</code>). Stored in <strong>sessionStorage</strong> for this tab
          only — not sent to students&apos; pages.
        </p>
        <div className="field">
          <label htmlFor="staff-key">ADMIN_KEY</label>
          <input
            id="staff-key"
            type="password"
            autoComplete="off"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste key"
          />
        </div>
        <div className="staff-actions">
          <button type="button" className="solid-btn" onClick={saveKey}>
            Save key for this tab
          </button>
          <button type="button" className="outline-btn" onClick={clearKey}>
            Clear key
          </button>
          <button
            type="button"
            className="outline-btn"
            onClick={() => {
              if (!adminKey.trim()) {
                setLoadErr("Enter and save your staff API key first.");
                return;
              }
              fetchPending();
            }}
          >
            Refresh queue
          </button>
        </div>
        {banner.text && (
          <p className={banner.ok ? "form-success" : "form-error"} role="status">
            {banner.text}
          </p>
        )}
        {loadErr && (
          <p className="form-error" role="alert">
            {loadErr}
          </p>
        )}
      </section>

      <section className="staff-card section-block">
        <h2>Pending educators ({pending.length})</h2>
        {hydrated && !adminKey.trim() ? (
          <p className="field-hint">Save your staff API key above to load the verification queue.</p>
        ) : null}
        {pending.length === 0 && adminKey && !loadErr ? (
          <p className="field-hint">No unverified educator accounts in the queue.</p>
        ) : null}
        {pending.length > 0 ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Subject</th>
                  <th>Licence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id}>
                    <td>{row.fullName}</td>
                    <td>
                      <code className="staff-mono">{row.email}</code>
                    </td>
                    <td>{row.educatorSubject || "—"}</td>
                    <td>
                      {row.hasLicenseDocument ? (
                        <span className="verify-ok">On file</span>
                      ) : (
                        <span className="verify-pending">Missing</span>
                      )}
                      {row.licenseUploadedAt ? (
                        <div className="field-hint" style={{ marginTop: "0.25rem" }}>
                          {new Date(row.licenseUploadedAt).toLocaleString()}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="staff-row-actions">
                        <button
                          type="button"
                          className="outline-btn"
                          disabled={!row.hasLicenseDocument}
                          onClick={() => openLicense(row.id)}
                        >
                          View licence
                        </button>
                        <button
                          type="button"
                          className="solid-btn"
                          disabled={!row.hasLicenseDocument || busyId === row.email}
                          onClick={() => verifyEducator(row.email)}
                        >
                          {busyId === row.email ? "Verifying…" : "Approve"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
