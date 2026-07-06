import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

export default function MarketplaceListingPage() {
  const { listingId } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [listing, setListing] = useState(null);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [buyerNotes, setBuyerNotes] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("not_educational");
  const [reportDetails, setReportDetails] = useState("");
  const [meta, setMeta] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    // Guards against a slow response for a listing the user has navigated
    // away from overwriting the one they're now viewing.
    const requestId = ++requestIdRef.current;
    setErr("");
    try {
      const data = await apiJson(`/api/marketplace/listings/${encodeURIComponent(listingId)}`);
      if (requestIdRef.current !== requestId) return;
      setListing(data.listing || null);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setListing(null);
      setErr(e.message || t("marketplace.listingLoadError"));
    }
  }, [listingId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiJson("/api/marketplace/meta")
      .then(setMeta)
      .catch((e) => console.error("[marketplace] could not load meta", e));
  }, []);

  useEffect(() => {
    if (searchParams.get("payment") === "cancelled") {
      setErr(t("marketplace.paymentCancelled"));
    }
  }, [searchParams, t]);

  async function submitReport() {
    setBusy(true);
    setErr("");
    try {
      await apiJson(`/api/marketplace/listings/${encodeURIComponent(listingId)}/report`, {
        method: "POST",
        body: { reason: reportReason, details: reportDetails },
      });
      setOkMsg(t("marketplace.reportSubmitted"));
      setReportOpen(false);
    } catch (e) {
      setErr(e.message || t("marketplace.reportError"));
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
      if (!url) throw new Error(t("marketplace.checkoutMissing"));
      window.location.assign(url);
    } catch (e) {
      setErr(e.message || t("marketplace.checkoutError"));
      setBusy(false);
    }
  }

  if (!listing && !err) {
    return <p className="field-hint">{t("common.loading")}</p>;
  }

  if (!listing) {
    return (
      <div>
        <p className="form-error">{err || t("marketplace.notFound")}</p>
        <Link to="/marketplace">{t("marketplace.backToMarketplace")}</Link>
      </div>
    );
  }

  const isOwn = listing.sellerId === user?.id;
  const canBuy = listing.status === "active" && !isOwn;

  return (
    <div>
      <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
        <Link to="/marketplace">{t("marketplace.backToMarketplace")}</Link>
      </p>

      <div className="marketplace-detail section-block">
        <div className="marketplace-detail-photos">
          {listing.photoUrls?.length > 0 ? (
            listing.photoUrls.map((url) => (
              <img key={url} src={url} alt="" className="marketplace-detail-photo" loading="lazy" />
            ))
          ) : (
            <div className="marketplace-card-thumb marketplace-card-thumb--empty marketplace-detail-photo">
              {listing.itemType === "digital" ? t("marketplace.digitalFileBadge") : t("marketplace.noPhoto")}
            </div>
          )}
        </div>

        <div>
          <h1>{listing.title}</h1>
          <p className="marketplace-card-price">{listing.priceLabel}</p>
          <p className="field-hint">
            {listing.categoryLabel} ·{" "}
            {listing.itemType === "digital" ? t("marketplace.digital") : t("marketplace.physical")}
          </p>
          <p>
            <strong>{t("marketplace.seller")}</strong> {listing.sellerName}{" "}
            <span className="role-pill">
              {listing.sellerRole === "educator" ? t("common.educator") : t("common.student")}
            </span>
          </p>
          {listing.subject && (
            <p>
              <strong>{t("marketplace.subject")}:</strong> {listing.subject}
              {listing.formLevel ? ` · ${listing.formLevel}` : ""}
            </p>
          )}
          {listing.itemType === "physical" && (
            <>
              {listing.condition && (
                <p>
                  <strong>{t("marketplace.conditionLabel")}</strong> {listing.condition}
                </p>
              )}
              <p>
                <strong>{t("marketplace.pickupAreaLabel")}</strong> {listing.pickupArea}
              </p>
              {listing.pickupNotes && (
                <p>
                  <strong>{t("marketplace.pickupNotesLabel")}</strong> {listing.pickupNotes}
                </p>
              )}
            </>
          )}
          {listing.description && (
            <div className="marketplace-description">
              <strong>{t("marketplace.description")}</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{listing.description}</p>
            </div>
          )}

          {listing.status === "sold" && (
            <p className="field-hint">{t("marketplace.itemSold")}</p>
          )}
          {isOwn && (
            <p>
              <Link to={`/marketplace/sell?edit=${encodeURIComponent(listing.id)}`} className="btn btn-secondary">
                {t("marketplace.editListing")}
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
                {t("marketplace.reportListing")}
              </button>
            </p>
          )}
          {reportOpen && !isOwn && (
            <div className="section-block marketplace-report-box">
              <label>
                {t("marketplace.reason")}
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
                {t("marketplace.detailsOptional")}
                <textarea
                  className="input"
                  rows={2}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  maxLength={1000}
                />
              </label>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={submitReport}>
                {t("marketplace.submitReport")}
              </button>
            </div>
          )}

          {canBuy && (
            <div className="marketplace-buy-box">
              <label>
                {t("marketplace.messageToSeller")}
                <textarea
                  className="input"
                  rows={2}
                  value={buyerNotes}
                  onChange={(e) => setBuyerNotes(e.target.value)}
                  maxLength={500}
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={buy}>
                {busy ? t("marketplace.startingCheckout") : t("marketplace.buyWithStripe")}
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
