import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api.js";

function prettyStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "pending") return "Pending";
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
      setReceiptDetails((prev) => ({
        ...prev,
        [paymentId]: data.receipt || null,
      }));
    } catch {
      setReceiptDetails((prev) => ({
        ...prev,
        [paymentId]: null,
      }));
    }
  }

  return (
    <div>
      <div className="user-page-intro">
        <h1>Transactions</h1>
        <p>View your paid course history, payment status, and receipt links.</p>
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
                {row.receiptUrl ? (
                  <a
                    className="solid-btn"
                    href={row.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open receipt
                  </a>
                ) : null}
              </div>
              {receiptDetails[row.id] ? (
                <p className="field-hint" style={{ marginTop: "0.5rem" }}>
                  Transaction ID: {receiptDetails[row.id].id}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
