import { randomUUID } from "node:crypto";
import { getDb, sqlite } from "../sqlite.js";

const REPORT_STATUSES = new Set(["open", "reviewed", "dismissed"]);

export const REPORT_REASONS = [
  { id: "not_educational", label: "Not educational material" },
  { id: "misleading", label: "Misleading description or price" },
  { id: "inappropriate", label: "Inappropriate content" },
  { id: "spam", label: "Spam or duplicate listing" },
  { id: "other", label: "Other" },
];

const REASON_IDS = new Set(REPORT_REASONS.map((r) => r.id));

export function isValidReportReason(reason) {
  return REASON_IDS.has(String(reason || ""));
}

function rowToReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    listingId: row.listing_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    details: row.details || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function insertReport({ listingId, reporterId, reason, details = "" }) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    await sqlite.run(
      db,
      `INSERT INTO marketplace_reports (id, listing_id, reporter_id, reason, details, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [
        id,
        String(listingId),
        String(reporterId),
        String(reason),
        String(details).slice(0, 1000),
        now,
      ]
    );
  } catch (e) {
    if (String(e?.message || "").includes("unique") || String(e?.code) === "23505") {
      return { duplicate: true };
    }
    throw e;
  }
  return { report: rowToReport(await getReportById(id)) };
}

export async function getReportById(id) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM marketplace_reports WHERE id = ? LIMIT 1",
    [String(id)]
  );
  return rowToReport(row);
}

export async function listOpenReports() {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM marketplace_reports WHERE status = 'open' ORDER BY created_at DESC`
  );
  return rows.map(rowToReport);
}

export async function updateReportStatus(id, status) {
  if (!REPORT_STATUSES.has(status)) throw new Error("Invalid report status");
  const db = await getDb();
  await sqlite.run(
    db,
    "UPDATE marketplace_reports SET status = ? WHERE id = ?",
    [status, String(id)]
  );
  return getReportById(id);
}
