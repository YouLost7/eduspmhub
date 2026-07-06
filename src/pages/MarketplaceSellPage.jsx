import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson, friendlyNonJsonApiMessage } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

const EMPTY = {
  itemType: "physical",
  category: "books",
  title: "",
  description: "",
  price: "",
  condition: "Good",
  pickupArea: "",
  pickupNotes: "",
  subject: "",
  formLevel: "",
};

function statusBadge(status, t) {
  if (status === "active") return t("marketplace.statusLive");
  if (status === "draft") return t("marketplace.statusDraft");
  if (status === "sold") return t("marketplace.statusSold");
  return status;
}

export default function MarketplaceSellPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState(tabParam === "payouts" || tabParam === "listings" ? tabParam : "create");

  const [meta, setMeta] = useState(null);
  const [listing, setListing] = useState(null);
  const [myListings, setMyListings] = useState([]);
  const [balance, setBalance] = useState(null);
  const [payoutBank, setPayoutBank] = useState({ bankName: "", accountHolder: "", accountNumber: "" });
  const [bankForm, setBankForm] = useState({ bankName: "", accountHolder: "", accountNumber: "" });
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [digitalBusy, setDigitalBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const loadListingRequestRef = useRef(0);

  const loadMeta = useCallback(async () => {
    const data = await apiJson("/api/marketplace/meta");
    setMeta(data);
  }, []);

  const loadMyListings = useCallback(async () => {
    const data = await apiJson("/api/marketplace/my-listings");
    setMyListings(Array.isArray(data.listings) ? data.listings : []);
  }, []);

  const loadWallet = useCallback(async () => {
    const [balData, txData, wdData] = await Promise.all([
      apiJson("/api/marketplace/balance"),
      apiJson("/api/marketplace/balance/transactions"),
      apiJson("/api/marketplace/withdrawals"),
    ]);
    setBalance(balData.balance || null);
    setPayoutBank(balData.payoutBank || {});
    setBankForm({
      bankName: balData.payoutBank?.bankName || "",
      accountHolder: balData.payoutBank?.accountHolder || "",
      accountNumber: "",
    });
    setTransactions(Array.isArray(txData.transactions) ? txData.transactions : []);
    setWithdrawals(Array.isArray(wdData.withdrawals) ? wdData.withdrawals : []);
  }, []);

  const loadListing = useCallback(async () => {
    if (!editId) return;
    // Guards against a slow response for a previously-edited listing
    // overwriting the form after the `?edit=` URL has already moved on to
    // a different listing.
    const requestId = ++loadListingRequestRef.current;
    const data = await apiJson(`/api/marketplace/listings/${encodeURIComponent(editId)}`);
    if (loadListingRequestRef.current !== requestId) return;
    const L = data.listing;
    if (!L) return;
    setListing(L);
    setTab("create");
    setForm({
      itemType: L.itemType,
      category: L.category,
      title: L.title,
      description: L.description || "",
      price: (L.priceCents / 100).toFixed(2),
      condition: L.condition || "",
      pickupArea: L.pickupArea || "",
      pickupNotes: L.pickupNotes || "",
      subject: L.subject || "",
      formLevel: L.formLevel || "",
    });
  }, [editId]);

  useEffect(() => {
    loadMeta().catch((e) => console.error("[marketplace] could not load meta", e));
  }, [loadMeta]);

  useEffect(() => {
    if (tab === "listings") loadMyListings().catch((e) => setErr(e.message));
    if (tab === "payouts") loadWallet().catch((e) => setErr(e.message));
  }, [tab, loadMyListings, loadWallet]);

  useEffect(() => {
    loadListing().catch((e) => setErr(e.message));
  }, [loadListing]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function switchTab(next) {
    setTab(next);
    setErr("");
    setOkMsg("");
  }

  async function saveDraft() {
    setBusy(true);
    setErr("");
    setOkMsg("");
    try {
      if (listing?.id) {
        const data = await apiJson(`/api/marketplace/listings/${listing.id}`, {
          method: "PATCH",
          body: { ...form, publish: false },
        });
        setListing(data.listing);
        setOkMsg(t("marketplace.draftSaved"));
      } else {
        const data = await apiJson("/api/marketplace/listings", {
          method: "POST",
          body: { ...form, publish: false },
        });
        setListing(data.listing);
        setOkMsg(t("marketplace.listingCreated"));
      }
      loadMyListings().catch((e) => console.error("[marketplace] could not refresh listings", e));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setErr("");
    try {
      let id = listing?.id;
      if (!id) {
        const created = await apiJson("/api/marketplace/listings", {
          method: "POST",
          body: { ...form, publish: false },
        });
        id = created.listing?.id;
        setListing(created.listing);
      }
      const data = await apiJson(`/api/marketplace/listings/${id}`, {
        method: "PATCH",
        body: { ...form, publish: true },
      });
      setListing(data.listing);
      setOkMsg(t("marketplace.publishedSuccess"));
      loadMyListings().catch((e) => console.error("[marketplace] could not refresh listings", e));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeListing(id) {
    if (removingId) return;
    if (!window.confirm(t("marketplace.removeConfirm"))) return;
    setRemovingId(id);
    try {
      await apiJson(`/api/marketplace/listings/${id}`, {
        method: "PATCH",
        body: { remove: true },
      });
      setOkMsg(t("marketplace.listingRemoved"));
      await loadMyListings();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRemovingId("");
    }
  }

  async function saveBankDetails() {
    setBusy(true);
    setErr("");
    try {
      await apiJson("/api/profile", {
        method: "PATCH",
        body: {
          payoutBankName: bankForm.bankName,
          payoutAccountHolder: bankForm.accountHolder,
          payoutAccountNumber: bankForm.accountNumber,
        },
      });
      setOkMsg(t("marketplace.bankSaved"));
      await loadWallet();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestWithdrawal() {
    setBusy(true);
    setErr("");
    try {
      await apiJson("/api/marketplace/withdrawals", {
        method: "POST",
        body: { amount: withdrawAmount },
      });
      setOkMsg(t("marketplace.withdrawalRequested"));
      setWithdrawAmount("");
      await loadWallet();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file) {
    if (!listing?.id) {
      setErr(t("marketplace.saveDraftFirstPhotos"));
      return;
    }
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch(`/api/marketplace/listings/${listing.id}/photos`, {
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
        throw new Error(data.error || friendlyNonJsonApiMessage(raw) || t("marketplace.photoUploadFailed"));
      }
      setListing(data.listing);
      setOkMsg(t("marketplace.photoAdded"));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function uploadDigital(file) {
    if (!listing?.id) {
      setErr(t("marketplace.saveDraftFirstFile"));
      return;
    }
    if (digitalBusy) return;
    setDigitalBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/marketplace/listings/${listing.id}/digital`, {
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
        throw new Error(data.error || friendlyNonJsonApiMessage(raw) || t("marketplace.fileUploadFailed"));
      }
      setListing(data.listing);
      setOkMsg(t("marketplace.digitalUploaded"));
    } finally {
      setDigitalBusy(false);
    }
  }

  const priceHint =
    user?.role === "student"
      ? t("marketplace.priceHintStudent", { max: meta?.studentMaxPriceLabel || "RM50" })
      : t("marketplace.priceHintEducator");

  const feePct = meta?.platformFeePercent ?? 10;

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/marketplace">{t("marketplace.backToMarketplace")}</Link>
        </p>
        <h1>{t("marketplace.sellTitle")}</h1>
        <p style={{ margin: 0, color: "#475569" }}>{priceHint}</p>
      </div>

      <div className="marketplace-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === "create" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("create")}
        >
          {editId ? t("marketplace.tabEdit") : t("marketplace.tabNew")}
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "listings" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("listings")}
        >
          {t("marketplace.tabMyListings")}
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "payouts" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("payouts")}
        >
          {t("marketplace.tabPayouts")}
        </button>
      </div>

      {tab === "listings" && (
        <section className="section-block">
          {myListings.length === 0 ? (
            <p className="field-hint">{t("marketplace.noListingsYet")}</p>
          ) : (
            <ul className="marketplace-orders-list">
              {myListings.map((L) => (
                <li key={L.id} className="marketplace-order-row">
                  <div>
                    <strong>{L.title}</strong>
                    <span className="field-hint">
                      {" "}
                      · {L.priceLabel} · {statusBadge(L.status, t)}
                    </span>
                  </div>
                  <div className="marketplace-order-actions">
                    {L.status !== "sold" && (
                      <Link
                        to={`/marketplace/sell?edit=${encodeURIComponent(L.id)}`}
                        className="btn btn-secondary"
                      >
                        {t("marketplace.edit")}
                      </Link>
                    )}
                    {L.status === "active" && (
                      <Link to={`/marketplace/${encodeURIComponent(L.id)}`} className="btn btn-secondary">
                        {t("marketplace.view")}
                      </Link>
                    )}
                    {L.status !== "sold" && L.status !== "removed" && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={removingId === L.id}
                        onClick={() => removeListing(L.id)}
                      >
                        {removingId === L.id ? t("common.saving") : t("marketplace.remove")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "payouts" && (
        <section className="section-block marketplace-wallet">
          <h2 style={{ marginTop: 0 }}>{t("marketplace.earningsWallet")}</h2>
          <p className="field-hint">
            {t("marketplace.walletIntro", {
              fee: feePct,
              min: balance?.minWithdrawalLabel || "RM20.00",
            })}
          </p>
          {balance && (
            <div className="marketplace-wallet-balance">
              <p className="marketplace-card-price" style={{ margin: 0 }}>
                {balance.availableLabel}
              </p>
              <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                {t("marketplace.availableLifetime", { amount: balance.lifetimeEarnedLabel })}
              </p>
            </div>
          )}

          <h3>{t("marketplace.bankDetails")}</h3>
          {payoutBank.hasDetails && !bankForm.accountNumber && (
            <p className="field-hint">
              {t("marketplace.bankOnFile")} {payoutBank.bankName} · {payoutBank.accountHolder} · ****
              {payoutBank.accountNumberLast4}
            </p>
          )}
          <div className="marketplace-sell-form">
            <label>
              {t("marketplace.bankName")}
              <input
                className="input"
                value={bankForm.bankName}
                onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder="Maybank"
              />
            </label>
            <label>
              {t("marketplace.accountHolder")}
              <input
                className="input"
                value={bankForm.accountHolder}
                onChange={(e) => setBankForm((f) => ({ ...f, accountHolder: e.target.value }))}
              />
            </label>
            <label>
              {t("marketplace.accountNumber")}
              <input
                className="input"
                inputMode="numeric"
                value={bankForm.accountNumber}
                onChange={(e) => setBankForm((f) => ({ ...f, accountNumber: e.target.value }))}
                placeholder={payoutBank.accountNumberLast4 ? t("marketplace.accountNumberUpdatePlaceholder") : ""}
              />
            </label>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveBankDetails}>
              {t("marketplace.saveBankDetails")}
            </button>
          </div>

          <h3>{t("marketplace.requestWithdrawal")}</h3>
          <div className="marketplace-sell-actions">
            <input
              className="input"
              inputMode="decimal"
              placeholder={t("marketplace.withdrawAmountPlaceholder")}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              style={{ maxWidth: "160px" }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !payoutBank.hasDetails}
              onClick={requestWithdrawal}
            >
              {t("marketplace.withdraw")}
            </button>
          </div>
          {!payoutBank.hasDetails && (
            <p className="field-hint">{t("marketplace.saveBankBeforeWithdraw")}</p>
          )}

          {withdrawals.length > 0 && (
            <>
              <h3>{t("marketplace.withdrawalRequests")}</h3>
              <ul className="marketplace-orders-list">
                {withdrawals.map((w) => (
                  <li key={w.id} className="marketplace-order-row">
                    <span>
                      {w.amountLabel} · {w.status}
                      {w.requestedAt ? ` · ${new Date(w.requestedAt).toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {transactions.length > 0 && (
            <>
              <h3>{t("marketplace.recentActivity")}</h3>
              <ul className="marketplace-orders-list">
                {transactions.map((tx) => (
                  <li key={tx.id} className="marketplace-order-row">
                    <span>
                      {tx.description || tx.type} ·{" "}
                      {tx.amountCents >= 0 ? "+" : "−"}
                      {tx.amountLabel}
                    </span>
                    <span className="field-hint">
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === "create" && (
        <form
          className="section-block marketplace-sell-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveDraft();
          }}
        >
          <label>
            {t("marketplace.type")}
            <select
              className="input"
              value={form.itemType}
              onChange={(e) => setField("itemType", e.target.value)}
              disabled={Boolean(listing?.status === "sold")}
            >
              <option value="physical">{t("marketplace.physicalType")}</option>
              <option value="digital">{t("marketplace.digitalType")}</option>
            </select>
          </label>

          <label>
            {t("marketplace.category")}
            <select
              className="input"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
            >
              {(meta?.categories || [{ id: "books", label: "Books" }]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("marketplace.titleLabel")}
            <input
              className="input"
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </label>

          <label>
            {t("marketplace.priceRm")}
            <input
              className="input"
              required
              inputMode="decimal"
              placeholder={t("marketplace.pricePlaceholder")}
              value={form.price}
              onChange={(e) => setField("price", e.target.value)}
            />
          </label>

          <label>
            {t("marketplace.subject")}
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setField("subject", e.target.value)}
              placeholder={user?.studentSubject || user?.educatorSubject || "Mathematics"}
            />
          </label>

          <label>
            {t("marketplace.formLevel")}
            <input
              className="input"
              value={form.formLevel}
              onChange={(e) => setField("formLevel", e.target.value)}
              placeholder={user?.studentForm || "Form 4"}
            />
          </label>

          <label>
            {t("marketplace.description")}
            <textarea
              className="input"
              rows={4}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </label>

          {form.itemType === "physical" && (
            <>
              <label>
                {t("marketplace.condition")}
                <input
                  className="input"
                  value={form.condition}
                  onChange={(e) => setField("condition", e.target.value)}
                  placeholder={t("marketplace.conditionPlaceholder")}
                />
              </label>
              <label>
                {t("marketplace.pickupArea")}
                <input
                  className="input"
                  required
                  value={form.pickupArea}
                  onChange={(e) => setField("pickupArea", e.target.value)}
                  placeholder="e.g. Shah Alam, SMK area"
                />
              </label>
              <label>
                {t("marketplace.pickupNotes")}
                <textarea
                  className="input"
                  rows={2}
                  value={form.pickupNotes}
                  onChange={(e) => setField("pickupNotes", e.target.value)}
                />
              </label>
            </>
          )}

          <div className="marketplace-upload-row">
            <label>
              {t("marketplace.photos")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={photoBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f).catch((ex) => setErr(ex.message));
                  e.target.value = "";
                }}
              />
              {photoBusy ? <span className="field-hint">{t("common.saving")}</span> : null}
            </label>
            {form.itemType === "digital" && (
              <label>
                {t("marketplace.digitalFile")}
                <input
                  type="file"
                  accept=".pdf,.zip,application/pdf,application/zip"
                  disabled={digitalBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDigital(f).catch((ex) => setErr(ex.message));
                    e.target.value = "";
                  }}
                />
                {digitalBusy ? <span className="field-hint">{t("common.saving")}</span> : null}
              </label>
            )}
          </div>

          {listing?.photoUrls?.length > 0 && (
            <div className="marketplace-detail-photos">
              {listing.photoUrls.map((url) => (
                <img key={url} src={url} alt="" className="marketplace-detail-photo" loading="lazy" />
              ))}
            </div>
          )}
          {listing?.hasDigitalFile && (
            <p className="field-hint">
              {t("marketplace.digitalAttached", { name: listing.digitalFileName || "file" })}
            </p>
          )}

          <div className="marketplace-sell-actions">
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              {t("marketplace.saveDraft")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
              {t("marketplace.publish")}
            </button>
          </div>
        </form>
      )}

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      {okMsg && <p className="form-ok">{okMsg}</p>}
    </div>
  );
}
