import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { apiJson } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useI18n } from "../i18n/I18nContext.jsx";

export default function MarketplaceBrowsePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [listings, setListings] = useState([]);
  const [meta, setMeta] = useState(null);
  const [category, setCategory] = useState("");
  const [itemType, setItemType] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (itemType) params.set("itemType", itemType);
      if (q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      const [listData, metaData] = await Promise.all([
        apiJson(`/api/marketplace/listings${qs ? `?${qs}` : ""}`),
        apiJson("/api/marketplace/meta"),
      ]);
      setListings(Array.isArray(listData.listings) ? listData.listings : []);
      setMeta(metaData);
    } catch (e) {
      setListings([]);
      setErr(e.message || t("marketplace.loadError"));
    } finally {
      setLoading(false);
    }
  }, [category, itemType, q, t]);

  useEffect(() => {
    load();
  }, [load]);

  const studentCap =
    user?.role === "student"
      ? meta?.studentMaxPriceLabel || "RM50"
      : null;

  return (
    <div>
      <div className="user-page-intro">
        <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>
          <Link to="/browse">{t("marketplace.backToBrowse")}</Link>
        </p>
        <h1>{t("marketplace.title")}</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          {t("marketplace.intro")}
          {studentCap ? ` ${t("marketplace.studentCap", { cap: studentCap })}` : ""}
        </p>
      </div>

      <div className="marketplace-toolbar section-block">
        <input
          type="search"
          className="input"
          placeholder={t("marketplace.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <select
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={t("marketplace.category")}
        >
          <option value="">{t("marketplace.allCategories")}</option>
          {(meta?.categories || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={itemType}
          onChange={(e) => setItemType(e.target.value)}
          aria-label={t("marketplace.itemType")}
        >
          <option value="">{t("marketplace.allTypes")}</option>
          <option value="physical">{t("marketplace.physical")}</option>
          <option value="digital">{t("marketplace.digital")}</option>
        </select>
        <Link to="/marketplace/sell" className="btn btn-primary">
          {t("marketplace.sellItem")}
        </Link>
        <Link to="/marketplace/orders" className="btn btn-secondary">
          {t("marketplace.myOrders")}
        </Link>
      </div>

      {loading && <p className="field-hint">{t("common.loading")}</p>}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      {!loading && listings.length === 0 && (
        <p className="field-hint">{t("marketplace.empty")}</p>
      )}

      <div className="marketplace-grid">
        {listings.map((item) => (
          <motion.article
            key={item.id}
            className="marketplace-card section-block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link to={`/marketplace/${encodeURIComponent(item.id)}`} className="marketplace-card-link">
              {item.photoUrls?.[0] ? (
                <img
                  className="marketplace-card-thumb"
                  src={item.photoUrls[0]}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="marketplace-card-thumb marketplace-card-thumb--empty" aria-hidden="true">
                  {item.itemType === "digital" ? "PDF" : "📚"}
                </div>
              )}
              <div>
                <h2 className="marketplace-card-title">{item.title}</h2>
                <p className="field-hint" style={{ margin: "0.15rem 0" }}>
                  {item.categoryLabel} ·{" "}
                  {item.itemType === "digital" ? t("marketplace.digitalBadge") : t("marketplace.pickupBadge")}
                  {item.subject ? ` · ${item.subject}` : ""}
                </p>
                <p className="marketplace-card-price">{item.priceLabel}</p>
                <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
                  {item.sellerName}
                  {item.sellerRole === "student" ? ` ${t("marketplace.sellerStudent")}` : ` ${t("marketplace.sellerEducator")}`}
                </p>
              </div>
            </Link>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
