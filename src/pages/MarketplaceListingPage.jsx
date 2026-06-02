import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function MarketplaceListingPage() {
  const { listingId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyerNotes, setBuyerNotes] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("not_educational");
  const [reportDetails, setReportDetails] = useState("");
  const [meta, setMeta] = useState(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const data = await apiJson(`/api/marketplace/listings/${encodeURIComponent(listingId)}`);
      setListing(data.listing || null);
    } catch (e) {
      setListing(null);
      setErr(e.message || "Could not load listing");
    }
  }, [listingId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiJson("/api/marketplace/meta")
      .then(setMeta)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get("payment") === "cancelled") {
      setErr("Payment was cancelled.");
    }
  }, [searchParams]);

  async function submitReport() {
    setBusy(true);
    setErr("");
    try {
      await apiJson(`/api/marketplace/listings/${encodeURIComponent(listingId)}/report`, {
        method: "POST",
        body: { reason: reportReason, details: reportDetails },
      });
      setOkMsg("Report submitted. Staff will review it.");
      setReportOpen(false);
    } catch (e) {
      setErr(e.message || "Could not submit report");
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    setBusy(true);
    setErr("");
    setOkMsg("");
    try {
      const data = await apiJson("/api/marketplace/checkout", {
        method: "POST",
        body: { listingId, buyerNotes },
      });
      const url = String(data.checkoutUrl || "").trim();
      if (!url) throw new Error("Checkout URL missing");
      window.location.assign(url);
    } catch (e) {
      setErr(e.message || "Could not start checkout");
      setBusy(false);
    }
  }

  if (!listing && !err) {
    return <p className="field-hint">Loading…</p>;
  }

  if (!listing) {
    return (
      <div>
        <p className="form-error">{err || "Not found"}</p>
        <Link to="/marketplace">← Marketplace</Link>
      </div>
    );
  }

  const isOwn = listing.sellerId === user?.id;
  const canBuy = listing.status === "active" && !isOwn;

  return (
    <div>
      <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
        <Link to="/marketplace">← Marketplace</Link>
      </p>

      <div className="marketplace-detail section-block">
        <div className="marketplace-detail-photos">
          {listing.photoUrls?.length > 0 ? (
            listing.photoUrls.map((url) => (
              <img key={url} src={url} alt="" className="marketplace-detail-photo" />
            ))
          ) : (
            <div className="marketplace-card-thumb marketplace-card-thumb--empty marketplace-detail-photo">
              {listing.itemType === "digital" ? "Digital file" : "No photo"}
            </div>
          )}
        </div>

        <div>
          <h1>{listing.title}</h1>
          <p className="marketplace-card-price">{listing.priceLabel}</p>
          <p className="field-hint">
            {listing.categoryLabel} · {listing.itemType === "digital" ? "Digital download" : "Physical pickup"}
          </p>
          <p>
            <strong>Seller:</strong> {listing.sellerName}{" "}
            <span className="role-pill">{listing.sellerRole === "educator" ? "Educator" : "Student"}</span>
          </p>
          {listing.subject && (
            <p>
              <strong>Subject:</strong> {listing.subject}
              {listing.formLevel ? ` · ${listing.formLevel}` : ""}
            </p>
          )}
          {listing.itemType === "physical" && (
            <>
              {listing.condition && (
                <p>
                  <strong>Condition:</strong> {listing.condition}
                </p>
              )}
              <p>
                <strong>Pickup area:</strong> {listing.pickupArea}
              </p>
              {listing.pickupNotes && (
                <p>
                  <strong>Pickup notes:</strong> {listing.pickupNotes}
                </p>
              )}
            </>
          )}
          {listing.description && (
            <div className="marketplace-description">
              <strong>Description</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{listing.description}</p>
            </div>
          )}

          {listing.status === "sold" && (
            <p className="field-hint">This item has been sold.</p>
          )}
          {isOwn && (
            <p>
              <Link to={`/marketplace/sell?edit=${encodeURIComponent(listing.id)}`} className="btn btn-secondary">
                Edit listing
              </Link>
            </p>
          )}
          {!isOwn && listing.status === "active" && (
            <p style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => setReportOpen((v) => !v)}
              >
                Report listing
              </button>
            </p>
          )}
          {reportOpen && !isOwn && (
            <div className="section-block marketplace-report-box">
              <label>
                Reason
                <select
                  className="input"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  {(meta?.reportReasons || [{ id: "other", label: "Other" }]).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Details (optional)
                <textarea
                  className="input"
                  rows={2}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  maxLength={1000}
                />
              </label>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={submitReport}>
                Submit report
              </button>
            </div>
          )}

          {canBuy && (
            <div className="marketplace-buy-box">
              <label>
                Message to seller (optional)
                <textarea
                  className="input"
                  rows={2}
                  value={buyerNotes}
                  onChange={(e) => setBuyerNotes(e.target.value)}
                  maxLength={500}
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={buy}>
                {busy ? "Starting checkout…" : "Buy with Stripe"}
              </button>
            </div>
          )}
        </div>
      </div>

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      {okMsg && <p className="form-ok">{okMsg}</p>}
    </div>
  );
}
