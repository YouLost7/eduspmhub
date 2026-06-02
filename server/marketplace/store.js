import { randomUUID } from "node:crypto";
import { getDb, sqlite } from "../sqlite.js";
import {
  LISTING_STATUSES,
  ORDER_STATUSES,
  CATEGORY_IDS,
  ITEM_TYPES,
  STUDENT_MAX_PRICE_CENTS,
} from "./constants.js";

export function formatMoneyLabel(cents, currency = "myr") {
  const value = (Number(cents) || 0) / 100;
  const cc = String(currency || "myr").toUpperCase();
  if (cc === "MYR") return `RM${value.toFixed(2)}`;
  return `${cc} ${value.toFixed(2)}`;
}

export function marketplacePaymentCourseId(orderId) {
  return `marketplace:${String(orderId)}`;
}

export function isMarketplacePaymentCourseId(courseId) {
  return String(courseId || "").startsWith("marketplace:");
}

function parsePhotoKeys(raw) {
  try {
    const v = JSON.parse(String(raw || "[]"));
    return Array.isArray(v) ? v.map((k) => String(k)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function rowToListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    sellerId: row.seller_id,
    status: row.status,
    itemType: row.item_type,
    category: row.category,
    title: row.title,
    description: row.description || "",
    priceCents: Number(row.price_cents),
    currency: String(row.currency || "myr").toLowerCase(),
    condition: row.condition || "",
    pickupArea: row.pickup_area || "",
    pickupNotes: row.pickup_notes || "",
    subject: row.subject || "",
    formLevel: row.form_level || "",
    photoKeys: parsePhotoKeys(row.photo_keys),
    digitalFileKey: row.digital_file_key || "",
    digitalFileName: row.digital_file_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    soldAt: row.sold_at || null,
  };
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    status: row.status,
    itemType: row.item_type,
    title: row.title,
    amountCents: Number(row.amount_cents),
    currency: String(row.currency || "myr").toLowerCase(),
    paymentId: row.payment_id || null,
    buyerNotes: row.buyer_notes || "",
    sellerReadyAt: row.seller_ready_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getListingById(id) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM marketplace_listings WHERE id = ? LIMIT 1",
    [String(id)]
  );
  return rowToListing(row);
}

export async function listActiveListings({ category, itemType, q } = {}) {
  const db = await getDb();
  const params = ["active"];
  const clauses = ["status = ?"];
  if (category && CATEGORY_IDS.has(category)) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (itemType && ITEM_TYPES.has(itemType)) {
    clauses.push("item_type = ?");
    params.push(itemType);
  }
  const sql = `SELECT * FROM marketplace_listings WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`;
  const rows = await sqlite.all(db, sql, params);
  let list = rows.map(rowToListing);
  const query = String(q || "").trim().toLowerCase();
  if (query) {
    list = list.filter(
      (l) =>
        l.title.toLowerCase().includes(query) ||
        l.description.toLowerCase().includes(query) ||
        l.subject.toLowerCase().includes(query)
    );
  }
  return list;
}

export async function listListingsForSeller(sellerId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM marketplace_listings WHERE seller_id = ?
     AND status != 'removed' ORDER BY updated_at DESC`,
    [String(sellerId)]
  );
  return rows.map(rowToListing);
}

export async function insertListing({
  id,
  sellerId,
  status = "draft",
  itemType,
  category,
  title,
  description = "",
  priceCents,
  currency = "myr",
  condition = "",
  pickupArea = "",
  pickupNotes = "",
  subject = "",
  formLevel = "",
  photoKeys = [],
  digitalFileKey = "",
  digitalFileName = "",
}) {
  if (!LISTING_STATUSES.has(status)) throw new Error("Invalid listing status");
  if (!ITEM_TYPES.has(itemType)) throw new Error("Invalid item type");
  if (!CATEGORY_IDS.has(category)) throw new Error("Invalid category");
  const db = await getDb();
  const now = new Date().toISOString();
  const listingId = id || randomUUID();
  await sqlite.run(
    db,
    `INSERT INTO marketplace_listings (
      id, seller_id, status, item_type, category, title, description,
      price_cents, currency, condition, pickup_area, pickup_notes,
      subject, form_level, photo_keys, digital_file_key, digital_file_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      listingId,
      String(sellerId),
      status,
      itemType,
      category,
      String(title).trim(),
      String(description || "").slice(0, 4000),
      Number(priceCents),
      String(currency || "myr").toLowerCase(),
      String(condition || "").slice(0, 80),
      String(pickupArea || "").slice(0, 120),
      String(pickupNotes || "").slice(0, 500),
      String(subject || "").slice(0, 80),
      String(formLevel || "").slice(0, 40),
      JSON.stringify(photoKeys.slice(0, 4)),
      String(digitalFileKey || ""),
      String(digitalFileName || "").slice(0, 200),
      now,
      now,
    ]
  );
  return getListingById(listingId);
}

export async function updateListing(id, patch) {
  const existing = await getListingById(id);
  if (!existing) return null;
  if (existing.status === "sold") return null;
  const db = await getDb();
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...patch,
    updatedAt: now,
  };
  if (patch.photoKeys) next.photoKeys = patch.photoKeys;
  await sqlite.run(
    db,
    `UPDATE marketplace_listings SET
      status = ?, item_type = ?, category = ?, title = ?, description = ?,
      price_cents = ?, condition = ?, pickup_area = ?, pickup_notes = ?,
      subject = ?, form_level = ?, photo_keys = ?, digital_file_key = ?,
      digital_file_name = ?, updated_at = ?
     WHERE id = ? AND status != 'sold'`,
    [
      patch.status != null ? patch.status : existing.status,
      patch.itemType != null ? patch.itemType : existing.itemType,
      patch.category != null ? patch.category : existing.category,
      patch.title != null ? String(patch.title).trim() : existing.title,
      patch.description != null
        ? String(patch.description).slice(0, 4000)
        : existing.description,
      patch.priceCents != null ? Number(patch.priceCents) : existing.priceCents,
      patch.condition != null ? String(patch.condition).slice(0, 80) : existing.condition,
      patch.pickupArea != null
        ? String(patch.pickupArea).slice(0, 120)
        : existing.pickupArea,
      patch.pickupNotes != null
        ? String(patch.pickupNotes).slice(0, 500)
        : existing.pickupNotes,
      patch.subject != null ? String(patch.subject).slice(0, 80) : existing.subject,
      patch.formLevel != null
        ? String(patch.formLevel).slice(0, 40)
        : existing.formLevel,
      JSON.stringify(
        (patch.photoKeys != null ? patch.photoKeys : existing.photoKeys).slice(0, 4)
      ),
      patch.digitalFileKey != null ? patch.digitalFileKey : existing.digitalFileKey,
      patch.digitalFileName != null ? patch.digitalFileName : existing.digitalFileName,
      now,
      String(id),
    ]
  );
  return getListingById(id);
}

export async function markListingSold(listingId) {
  const db = await getDb();
  const now = new Date().toISOString();
  const res = await sqlite.run(
    db,
    `UPDATE marketplace_listings SET status = 'sold', sold_at = ?, updated_at = ?
     WHERE id = ? AND status = 'active'`,
    [now, now, String(listingId)]
  );
  return (res?.changes ?? 0) > 0;
}

export async function getOrderById(id) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM marketplace_orders WHERE id = ? LIMIT 1",
    [String(id)]
  );
  return rowToOrder(row);
}

export async function getOrderByListingAndBuyer(listingId, buyerId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `SELECT * FROM marketplace_orders WHERE listing_id = ? AND buyer_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [String(listingId), String(buyerId)]
  );
  return rowToOrder(row);
}

export function validateListingPriceCents(cents, sellerRole) {
  const n = Number.parseInt(String(cents ?? ""), 10);
  if (!Number.isFinite(n) || n < 200) {
    return { error: "Minimum price is RM2.00." };
  }
  if (sellerRole === "student" && n > STUDENT_MAX_PRICE_CENTS) {
    return { error: "Students can list items up to RM50.00 only." };
  }
  return { cents: n };
}

export async function insertOrder({
  id,
  listingId,
  buyerId,
  sellerId,
  status = "paid",
  itemType,
  title,
  amountCents,
  currency = "myr",
  paymentId = null,
  buyerNotes = "",
  completedAt = null,
}) {
  if (!ORDER_STATUSES.has(status)) throw new Error("Invalid order status");
  const db = await getDb();
  const now = new Date().toISOString();
  const orderId = id || randomUUID();
  await sqlite.run(
    db,
    `INSERT INTO marketplace_orders (
      id, listing_id, buyer_id, seller_id, status, item_type, title,
      amount_cents, currency, payment_id, buyer_notes, completed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId,
      String(listingId),
      String(buyerId),
      String(sellerId),
      status,
      itemType,
      String(title).slice(0, 200),
      Number(amountCents),
      String(currency || "myr").toLowerCase(),
      paymentId ? String(paymentId) : null,
      String(buyerNotes || "").slice(0, 500),
      completedAt || null,
      now,
      now,
    ]
  );
  return getOrderById(orderId);
}

export async function listOrdersForUser(userId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM marketplace_orders
     WHERE buyer_id = ? OR seller_id = ?
     ORDER BY created_at DESC`,
    [String(userId), String(userId)]
  );
  return rows.map(rowToOrder);
}

export async function updateOrderStatus(id, { status, sellerReadyAt, completedAt }) {
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `UPDATE marketplace_orders SET
      status = COALESCE(?, status),
      seller_ready_at = COALESCE(?, seller_ready_at),
      completed_at = COALESCE(?, completed_at),
      updated_at = ?
     WHERE id = ?`,
    [
      status || null,
      sellerReadyAt || null,
      completedAt || null,
      now,
      String(id),
    ]
  );
  return getOrderById(id);
}
