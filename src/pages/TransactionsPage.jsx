import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api.js";

function prettyStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "failed") return "Failed";
  if (s === "refunded") return "Refunded";
  return status || "Unknown";
}

export default function TransactionsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [receiptDetails, setReceiptDetails] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/payments/transactions");
      setRows(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (e) {
      setErr(e.message || "Could not load transactions");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setErr("Could not load receipt details for this transaction.");
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
      setErr("Mock payments do not have an external Stripe receipt. Use Receipt details instead.");
      return;
    }
    setErr("Receipt link is not ready yet. Please try again in a moment.");
  }

  function downloadReceiptPdf(row) {
    const paymentId = encodeURIComponent(String(row?.id || "").trim());
    if (!paymentId) {
      setErr("Missing transaction ID for PDF receipt.");
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
        <h1>Transactions</h1>
        <p>Completed payments only — unfinished checkouts are not listed here.</p>
      </div>

      {loading && <p className="field-hint">Loading transactions…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && !err && rows.length === 0 ? (
        <p className="field-hint">No paid transactions yet.</p>
      ) : null}

      {!loading && !err && rows.length > 0 ? (
        <div className="cards-grid">
          {rows.map((row) => (
            <article key={row.id} className="course-card">
              <h3>{row.courseTitle || "Course purchase"}</h3>
              <p>
                {row.amountLabel} · {prettyStatus(row.status)}
              </p>
              <p className="field-hint">
                Paid at: {row.paidAt ? new Date(row.paidAt).toLocaleString() : "Pending"}
              </p>
              <div className="course-card-actions">
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => loadReceipt(row.id)}
                >
                  Receipt details
                </button>
                <button
                  type="button"
                  className="solid-btn"
                  onClick={() => openReceipt(row)}
                >
                  Open receipt
                </button>
              </div>
              {receiptDetails[row.id] ? (
                <div className="field-hint" style={{ marginTop: "0.5rem" }}>
                  <p>Transaction ID: {receiptDetails[row.id].id}</p>
                  <p>Provider: {String(receiptDetails[row.id].provider || "stripe").toUpperCase()}</p>
                  <p>Method: {receiptDetails[row.id].paymentMethodType || "n/a"}</p>
                  <p>
                    Receipt link:{" "}
                    {receiptDetails[row.id].receiptUrl ? "Available" : "Not provided by provider yet"}
                  </p>
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      type="button"
                      className="outline-btn"
                      onClick={() => downloadReceiptPdf(row)}
                    >
                      Download PDF
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
