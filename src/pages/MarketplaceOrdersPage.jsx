import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiJson } from "../api.js";
import { useI18n } from "../i18n/I18nContext.jsx";

export default function MarketplaceOrdersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState("");
  const requestIdRef = useRef(0);
  const confirmedSessionRef = useRef("");

  const statusLabel = useCallback(
    (status) => {
      const s = String(status || "");
      if (s === "paid") return t("marketplace.orderStatusPaid");
      if (s === "seller_ready") return t("marketplace.orderStatusReady");
      if (s === "completed") return t("marketplace.orderStatusCompleted");
      return s;
    },
    [t]
  );

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setErr("");
    try {
      const data = await apiJson("/api/marketplace/orders");
      if (requestIdRef.current !== requestId) return;
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setOrders([]);
      setErr(e.message || t("marketplace.ordersLoadError"));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (searchParams.get("payment") !== "success") return;
    // Guards against double-confirming the same session (React StrictMode's
    // double-invoke in dev, or this effect re-running before the query
    // params are cleared).
    const confirmKey = sessionId || "no-session";
    if (confirmedSessionRef.current === confirmKey) return;
    confirmedSessionRef.current = confirmKey;

    if (sessionId) {
      apiJson("/api/payments/confirm-session", {
        method: "POST",
        body: { sessionId },
      })
        .then(() => {
          setOkMsg(t("marketplace.paymentConfirmed"));
          load();
        })
        .catch((e) => {
          confirmedSessionRef.current = "";
          setErr(e.message || t("marketplace.paymentConfirmError"));
        })
        .finally(() => {
          const next = new URLSearchParams(searchParams);
          next.delete("payment");
          next.delete("session_id");
          next.delete("order");
          setSearchParams(next, { replace: true });
        });
    } else {
      setOkMsg(t("marketplace.purchaseComplete"));
      const next = new URLSearchParams(searchParams);
      next.delete("payment");
      next.delete("order");
      setSearchParams(next, { replace: true });
      load();
    }
  }, [searchParams, setSearchParams, load, t]);

  async function markReady(orderId) {
    if (busyOrderId) return;
    setBusyOrderId(orderId);
    try {
      await apiJson(`/api/marketplace/orders/${orderId}/seller-ready`, { method: "POST" });
      setOkMsg(t("marketplace.markedReady"));
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyOrderId("");
    }
  }

  async function confirmReceived(orderId) {
    if (busyOrderId) return;
    setBusyOrderId(orderId);
    try {
      await apiJson(`/api/marketplace/orders/${orderId}/confirm`, { method: "POST" });
      setOkMsg(t("marketplace.orderCompleted"));
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyOrderId("");
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
          <Link to="/marketplace">{t("marketplace.backToMarketplace")}</Link>
        </p>
        <h1>{t("marketplace.ordersTitle")}</h1>
      </div>

      {loading && <p className="field-hint">{t("common.loading")}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
      {okMsg && <p className="form-ok">{okMsg}</p>}

      <section className="section-block">
        <h2>{t("marketplace.myPurchases")}</h2>
        {purchases.length === 0 && <p className="field-hint">{t("marketplace.noPurchases")}</p>}
        <ul className="marketplace-orders-list">
          {purchases.map((o) => (
            <li key={o.id} className="marketplace-order-row">
              <div>
                <strong>{o.title}</strong>
                <span className="field-hint"> · {o.amountLabel}</span>
                <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                  {statusLabel(o.status)} · {t("marketplace.sellerLabel")} {o.sellerName}
                </p>
              </div>
              <div className="marketplace-order-actions">
                {o.canDownload && (
                  <button type="button" className="btn btn-primary" onClick={() => download(o.id)}>
                    {t("marketplace.download")}
                  </button>
                )}
                {o.canConfirmReceived && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={Boolean(busyOrderId)}
                    onClick={() => confirmReceived(o.id)}
                  >
                    {busyOrderId === o.id ? t("common.saving") : t("marketplace.confirmReceived")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section-block" style={{ marginTop: "1rem" }}>
        <h2>{t("marketplace.mySales")}</h2>
        {sales.length === 0 && <p className="field-hint">{t("marketplace.noSales")}</p>}
        <ul className="marketplace-orders-list">
          {sales.map((o) => (
            <li key={o.id} className="marketplace-order-row">
              <div>
                <strong>{o.title}</strong>
                <span className="field-hint"> · {o.amountLabel}</span>
                <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                  {statusLabel(o.status)} · {t("marketplace.buyerLabel")} {o.buyerName}
                </p>
              </div>
              {o.canMarkReady && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={Boolean(busyOrderId)}
                  onClick={() => markReady(o.id)}
                >
                  {busyOrderId === o.id ? t("common.saving") : t("marketplace.readyForPickup")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ marginTop: "1rem" }}>
        <Link to="/marketplace/sell">{t("marketplace.sellAnother")}</Link>
      </p>
    </div>
  );
}
