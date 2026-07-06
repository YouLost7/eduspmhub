import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "../api.js";
import { useI18n } from "../i18n/I18nContext.jsx";

export default function TransactionsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [receiptDetails, setReceiptDetails] = useState({});
  const requestIdRef = useRef(0);

  const prettyStatus = useCallback(
    (status) => {
      const s = String(status || "").trim().toLowerCase();
      if (s === "paid") return t("transactions.statusPaid");
      if (s === "failed") return t("transactions.statusFailed");
      if (s === "refunded") return t("transactions.statusRefunded");
      return status || t("transactions.statusUnknown");
    },
    [t]
  );

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/payments/transactions");
      if (requestIdRef.current !== requestId) return;
      setRows(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setErr(e.message || t("transactions.loadError"));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadReceipt(paymentId) {
    try {
      const data = await apiJson(`/api/payments/receipt/${encodeURIComponent(paymentId)}`);
      setErr("");
      setReceiptDetails((prev) => ({
        ...prev,
        [paymentId]: data.receipt || null,
      }));
      return data.receipt || null;
    } catch {
      setErr(t("transactions.receiptLoadError"));
      setReceiptDetails((prev) => ({
        ...prev,
        [paymentId]: null,
      }));
      return null;
    }
  }

  async function openReceipt(row) {
    const fresh = await loadReceipt(row.id);
    const url = String(fresh?.receiptUrl || row?.receiptUrl || "").trim();
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (String(row.provider || "").toLowerCase() === "mock") {
      setErr(t("transactions.mockReceiptHint"));
      return;
    }
    setErr(t("transactions.receiptLinkNotReady"));
  }

  function downloadReceiptPdf(row) {
    const paymentId = encodeURIComponent(String(row?.id || "").trim());
    if (!paymentId) {
      setErr(t("transactions.missingTransactionId"));
      return;
    }
    window.open(
      `/api/payments/receipt/${paymentId}/pdf`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>{t("transactions.title")}</h1>
        <p>{t("transactions.intro")}</p>
      </div>

      {loading && <p className="field-hint">{t("transactions.loading")}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && rows.length === 0 ? (
        <p className="field-hint">{t("transactions.empty")}</p>
      ) : null}

      {!loading && !err && rows.length > 0 ? (
        <div className="cards-grid">
          {rows.map((row) => (
            <article key={row.id} className="course-card">
              <h3>{row.courseTitle || t("transactions.coursePurchase")}</h3>
              <p>
                {row.amountLabel} · {prettyStatus(row.status)}
              </p>
              <p className="field-hint">
                {t("transactions.paidAt")}{" "}
                {row.paidAt ? new Date(row.paidAt).toLocaleString() : t("transactions.pending")}
              </p>
              <div className="course-card-actions">
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => loadReceipt(row.id)}
                >
                  {t("transactions.receiptDetails")}
                </button>
                <button
                  type="button"
                  className="solid-btn"
                  onClick={() => openReceipt(row)}
                >
                  {t("transactions.openReceipt")}
                </button>
              </div>
              {receiptDetails[row.id] ? (
                <div className="field-hint" style={{ marginTop: "0.5rem" }}>
                  <p>
                    {t("transactions.transactionId")} {receiptDetails[row.id].id}
                  </p>
                  <p>
                    {t("transactions.provider")}{" "}
                    {String(receiptDetails[row.id].provider || "stripe").toUpperCase()}
                  </p>
                  <p>
                    {t("transactions.method")} {receiptDetails[row.id].paymentMethodType || "n/a"}
                  </p>
                  <p>
                    {t("transactions.receiptLink")}{" "}
                    {receiptDetails[row.id].receiptUrl
                      ? t("transactions.receiptAvailable")
                      : t("transactions.receiptNotReady")}
                  </p>
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      className="outline-btn"
                      onClick={() => downloadReceiptPdf(row)}
                    >
                      {t("transactions.downloadPdf")}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
