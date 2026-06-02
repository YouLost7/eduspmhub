import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson, friendlyNonJsonApiMessage } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

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

function statusBadge(status) {
  if (status === "active") return "Live";
  if (status === "draft") return "Draft";
  if (status === "sold") return "Sold";
  return status;
}

export default function MarketplaceSellPage() {
  const { user } = useAuth();
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
    const data = await apiJson(`/api/marketplace/listings/${encodeURIComponent(editId)}`);
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
    loadMeta().catch(() => {});
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
        setOkMsg("Draft saved.");
      } else {
        const data = await apiJson("/api/marketplace/listings", {
          method: "POST",
          body: { ...form, publish: false },
        });
        setListing(data.listing);
        setOkMsg("Listing created. Add photos or a file, then publish.");
      }
      loadMyListings().catch(() => {});
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
      setOkMsg("Published! Buyers can see it in the marketplace.");
      loadMyListings().catch(() => {});
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeListing(id) {
    if (!window.confirm("Remove this listing from the marketplace?")) return;
    try {
      await apiJson(`/api/marketplace/listings/${id}`, {
        method: "PATCH",
        body: { remove: true },
      });
      setOkMsg("Listing removed.");
      loadMyListings();
    } catch (e) {
      setErr(e.message);
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
      setOkMsg("Bank details saved.");
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
      setOkMsg("Withdrawal requested. Staff will transfer to your bank soon.");
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
      setErr("Save draft first, then add photos.");
      return;
    }
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
      throw new Error(data.error || friendlyNonJsonApiMessage(raw) || "Photo upload failed");
    }
    setListing(data.listing);
    setOkMsg("Photo added.");
  }

  async function uploadDigital(file) {
    if (!listing?.id) {
      setErr("Save draft first, then upload your file.");
      return;
    }
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
      throw new Error(data.error || friendlyNonJsonApiMessage(raw) || "File upload failed");
    }
    setListing(data.listing);
    setOkMsg("Digital file uploaded.");
  }

  const priceHint =
    user?.role === "student"
      ? `Max ${meta?.studentMaxPriceLabel || "RM50"} for student sellers. Min RM2.`
      : "Min RM2. Educators can set any price.";

  const feePct = meta?.platformFeePercent ?? 10;

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/marketplace">← Marketplace</Link>
        </p>
        <h1>Sell study materials</h1>
        <p style={{ margin: 0, color: "#475569" }}>{priceHint}</p>
      </div>

      <div className="marketplace-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === "create" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("create")}
        >
          {editId ? "Edit listing" : "New listing"}
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "listings" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("listings")}
        >
          My listings
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "payouts" ? "marketplace-tab active" : "marketplace-tab"}
          onClick={() => switchTab("payouts")}
        >
          Payouts
        </button>
      </div>

      {tab === "listings" && (
        <section className="section-block">
          {myListings.length === 0 ? (
            <p className="field-hint">No listings yet. Create one under New listing.</p>
          ) : (
            <ul className="marketplace-orders-list">
              {myListings.map((L) => (
                <li key={L.id} className="marketplace-order-row">
                  <div>
                    <strong>{L.title}</strong>
                    <span className="field-hint">
                      {" "}
                      · {L.priceLabel} · {statusBadge(L.status)}
                    </span>
                  </div>
                  <div className="marketplace-order-actions">
                    {L.status !== "sold" && (
                      <Link
                        to={`/marketplace/sell?edit=${encodeURIComponent(L.id)}`}
                        className="btn btn-secondary"
                      >
                        Edit
                      </Link>
                    )}
                    {L.status === "active" && (
                      <Link to={`/marketplace/${encodeURIComponent(L.id)}`} className="btn btn-secondary">
                        View
                      </Link>
                    )}
                    {L.status !== "sold" && L.status !== "removed" && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => removeListing(L.id)}
                      >
                        Remove
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
          <h2 style={{ marginTop: 0 }}>Earnings wallet</h2>
          <p className="field-hint">
            Course sales credit when a student pays. Marketplace items credit on sale. 1-on-1
            tutoring credits when you mark a session complete ({feePct}% platform fee on all).
            Withdraw to your bank from {balance?.minWithdrawalLabel || "RM20.00"}.
          </p>
          {balance && (
            <div className="marketplace-wallet-balance">
              <p className="marketplace-card-price" style={{ margin: 0 }}>
                {balance.availableLabel}
              </p>
              <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                Available · Lifetime earned {balance.lifetimeEarnedLabel}
              </p>
            </div>
          )}

          <h3>Bank details</h3>
          {payoutBank.hasDetails && !bankForm.accountNumber && (
            <p className="field-hint">
              On file: {payoutBank.bankName} · {payoutBank.accountHolder} · ****
              {payoutBank.accountNumberLast4}
            </p>
          )}
          <div className="marketplace-sell-form">
            <label>
              Bank name
              <input
                className="input"
                value={bankForm.bankName}
                onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))}
                placeholder="Maybank"
              />
            </label>
            <label>
              Account holder name
              <input
                className="input"
                value={bankForm.accountHolder}
                onChange={(e) => setBankForm((f) => ({ ...f, accountHolder: e.target.value }))}
              />
            </label>
            <label>
              Account number
              <input
                className="input"
                inputMode="numeric"
                value={bankForm.accountNumber}
                onChange={(e) => setBankForm((f) => ({ ...f, accountNumber: e.target.value }))}
                placeholder={payoutBank.accountNumberLast4 ? "Enter full number to update" : ""}
              />
            </label>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveBankDetails}>
              Save bank details
            </button>
          </div>

          <h3>Request withdrawal</h3>
          <div className="marketplace-sell-actions">
            <input
              className="input"
              inputMode="decimal"
              placeholder="Amount (RM)"
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
              Withdraw
            </button>
          </div>
          {!payoutBank.hasDetails && (
            <p className="field-hint">Save bank details before requesting a withdrawal.</p>
          )}

          {withdrawals.length > 0 && (
            <>
              <h3>Withdrawal requests</h3>
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
              <h3>Recent activity</h3>
              <ul className="marketplace-orders-list">
                {transactions.map((t) => (
                  <li key={t.id} className="marketplace-order-row">
                    <span>
                      {t.description || t.type} ·{" "}
                      {t.amountCents >= 0 ? "+" : "−"}
                      {t.amountLabel}
                    </span>
                    <span className="field-hint">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}
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
            Type
            <select
              className="input"
              value={form.itemType}
              onChange={(e) => setField("itemType", e.target.value)}
              disabled={Boolean(listing?.status === "sold")}
            >
              <option value="physical">Physical (pickup)</option>
              <option value="digital">Digital (PDF / ZIP download)</option>
            </select>
          </label>

          <label>
            Category
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
            Title
            <input
              className="input"
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </label>

          <label>
            Price (RM)
            <input
              className="input"
              required
              inputMode="decimal"
              placeholder="e.g. 15.00"
              value={form.price}
              onChange={(e) => setField("price", e.target.value)}
            />
          </label>

          <label>
            Subject
            <input
              className="input"
              value={form.subject}
              onChange={(e) => setField("subject", e.target.value)}
              placeholder={user?.studentSubject || user?.educatorSubject || "Mathematics"}
            />
          </label>

          <label>
            Form / level
            <input
              className="input"
              value={form.formLevel}
              onChange={(e) => setField("formLevel", e.target.value)}
              placeholder={user?.studentForm || "Form 4"}
            />
          </label>

          <label>
            Description
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
                Condition
                <input
                  className="input"
                  value={form.condition}
                  onChange={(e) => setField("condition", e.target.value)}
                  placeholder="Good, light wear on cover…"
                />
              </label>
              <label>
                Pickup area
                <input
                  className="input"
                  required
                  value={form.pickupArea}
                  onChange={(e) => setField("pickupArea", e.target.value)}
                  placeholder="e.g. Shah Alam, SMK area"
                />
              </label>
              <label>
                Pickup notes
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
              Photos (physical items, up to 4)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f).catch((ex) => setErr(ex.message));
                  e.target.value = "";
                }}
              />
            </label>
            {form.itemType === "digital" && (
              <label>
                Digital file (PDF or ZIP)
                <input
                  type="file"
                  accept=".pdf,.zip,application/pdf,application/zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDigital(f).catch((ex) => setErr(ex.message));
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {listing?.photoUrls?.length > 0 && (
            <div className="marketplace-detail-photos">
              {listing.photoUrls.map((url) => (
                <img key={url} src={url} alt="" className="marketplace-detail-photo" />
              ))}
            </div>
          )}
          {listing?.hasDigitalFile && (
            <p className="field-hint">
              Digital file attached ({listing.digitalFileName || "file"})
            </p>
          )}

          <div className="marketplace-sell-actions">
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Save draft
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
              Publish
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
