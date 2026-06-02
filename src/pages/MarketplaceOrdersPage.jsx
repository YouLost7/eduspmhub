import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";

function statusLabel(status) {
  const s = String(status || "");
  if (s === "paid") return "Paid — awaiting pickup";
  if (s === "seller_ready") return "Ready for pickup";
  if (s === "completed") return "Completed";
  return s;
}

export default function MarketplaceOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/marketplace/orders");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      setOrders([]);
      setErr(e.message || "Could not load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (searchParams.get("payment") === "success" && sessionId) {
      apiJson("/api/payments/confirm-session", {
        method: "POST",
        body: { sessionId },
      })
        .then(() => {
          setOkMsg("Payment confirmed.");
          load();
        })
        .catch(() => load())
        .finally(() => {
          const next = new URLSearchParams(searchParams);
          next.delete("payment");
          next.delete("session_id");
          next.delete("order");
          setSearchParams(next, { replace: true });
        });
    } else if (searchParams.get("payment") === "success") {
      setOkMsg("Purchase complete.");
      const next = new URLSearchParams(searchParams);
      next.delete("payment");
      next.delete("order");
      setSearchParams(next, { replace: true });
      load();
    }
  }, [searchParams, setSearchParams, load]);

  async function markReady(orderId) {
    try {
      await apiJson(`/api/marketplace/orders/${orderId}/seller-ready`, { method: "POST" });
      setOkMsg("Marked ready for pickup.");
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function confirmReceived(orderId) {
    try {
      await apiJson(`/api/marketplace/orders/${orderId}/confirm`, { method: "POST" });
      setOkMsg("Thanks — order completed.");
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  function download(orderId) {
    window.location.assign(`/api/marketplace/orders/${encodeURIComponent(orderId)}/download`);
  }

  const purchases = orders.filter((o) => o.isBuyer);
  const sales = orders.filter((o) => o.isSeller);

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/marketplace">← Marketplace</Link>
        </p>
        <h1>Marketplace orders</h1>
      </div>

      {loading && <p className="field-hint">Loading…</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      {okMsg && <p className="form-ok">{okMsg}</p>}

      <section className="section-block">
        <h2>My purchases</h2>
        {purchases.length === 0 && <p className="field-hint">No purchases yet.</p>}
        <ul className="marketplace-orders-list">
          {purchases.map((o) => (
            <li key={o.id} className="marketplace-order-row">
              <div>
                <strong>{o.title}</strong>
                <span className="field-hint"> · {o.amountLabel}</span>
                <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                  {statusLabel(o.status)} · Seller: {o.sellerName}
                </p>
              </div>
              <div className="marketplace-order-actions">
                {o.canDownload && (
                  <button type="button" className="btn btn-primary" onClick={() => download(o.id)}>
                    Download
                  </button>
                )}
                {o.canConfirmReceived && (
                  <button type="button" className="btn btn-secondary" onClick={() => confirmReceived(o.id)}>
                    Confirm received
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section-block" style={{ marginTop: "1rem" }}>
        <h2>My sales</h2>
        {sales.length === 0 && <p className="field-hint">No sales yet.</p>}
        <ul className="marketplace-orders-list">
          {sales.map((o) => (
            <li key={o.id} className="marketplace-order-row">
              <div>
                <strong>{o.title}</strong>
                <span className="field-hint"> · {o.amountLabel}</span>
                <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                  {statusLabel(o.status)} · Buyer: {o.buyerName}
                </p>
              </div>
              {o.canMarkReady && (
                <button type="button" className="btn btn-secondary" onClick={() => markReady(o.id)}>
                  Ready for pickup
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link to="/marketplace/sell">Sell another item</Link>
      </p>
    </div>
  );
}
