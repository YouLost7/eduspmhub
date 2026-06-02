import { randomUUID } from "node:crypto";
import { getDb, sqlite } from "../sqlite.js";
import { formatMoneyLabel } from "./store.js";
import {
  marketplacePlatformFeeCents,
  marketplaceSellerCreditCents,
  MIN_WITHDRAWAL_CENTS,
  MARKETPLACE_PLATFORM_FEE_BPS,
} from "./fees.js";

async function ensureBalanceRow(userId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `INSERT INTO seller_balances (user_id, available_cents, lifetime_earned_cents, updated_at)
     VALUES (?, 0, 0, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [String(userId), now]
  );
}

function rowToTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amountCents: Number(row.amount_cents),
    referenceType: row.reference_type || "",
    referenceId: row.reference_id || "",
    description: row.description || "",
    createdAt: row.created_at,
  };
}

function rowToWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    bankName: row.bank_name || "",
    accountHolder: row.account_holder || "",
    accountNumber: row.account_number || "",
    adminNote: row.admin_note || "",
    requestedAt: row.requested_at,
    processedAt: row.processed_at || null,
  };
}

export async function getBalanceSummary(userId) {
  await ensureBalanceRow(userId);
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM seller_balances WHERE user_id = ? LIMIT 1",
    [String(userId)]
  );
  const available = Number(row?.available_cents) || 0;
  const lifetime = Number(row?.lifetime_earned_cents) || 0;
  return {
    availableCents: available,
    availableLabel: formatMoneyLabel(available),
    lifetimeEarnedCents: lifetime,
    lifetimeEarnedLabel: formatMoneyLabel(lifetime),
    minWithdrawalCents: MIN_WITHDRAWAL_CENTS,
    minWithdrawalLabel: formatMoneyLabel(MIN_WITHDRAWAL_CENTS),
  };
}

export async function listBalanceTransactions(userId, limit = 50) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM balance_transactions WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [String(userId), Math.min(Number(limit) || 50, 100)]
  );
  return rows.map((r) => ({
    ...rowToTx(r),
    amountLabel: formatMoneyLabel(Math.abs(r.amount_cents)),
  }));
}

async function hasSaleCreditForOrder(orderId) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    `SELECT id FROM balance_transactions
     WHERE reference_type = 'marketplace_order' AND reference_id = ? AND type = 'sale_credit'
     LIMIT 1`,
    [String(orderId)]
  );
  return Boolean(row);
}

/** Idempotent: credit seller net of platform fee after a paid marketplace order. */
export async function creditMarketplaceSale({ sellerId, orderId, grossCents, title }) {
  if (await hasSaleCreditForOrder(orderId)) {
    return { credited: false, duplicate: true };
  }

  const gross = Number(grossCents) || 0;
  const fee = marketplacePlatformFeeCents(gross);
  const net = marketplaceSellerCreditCents(gross);
  if (net <= 0) return { credited: false };

  await ensureBalanceRow(sellerId);
  const db = await getDb();
  const now = new Date().toISOString();
  const label = String(title || "Marketplace sale").slice(0, 120);

  await sqlite.run(
    db,
    `UPDATE seller_balances SET
      available_cents = available_cents + ?,
      lifetime_earned_cents = lifetime_earned_cents + ?,
      updated_at = ?
     WHERE user_id = ?`,
    [net, net, now, String(sellerId)]
  );

  await sqlite.run(
    db,
    `INSERT INTO balance_transactions (
      id, user_id, type, amount_cents, reference_type, reference_id, description, created_at
    ) VALUES (?, ?, 'sale_credit', ?, 'marketplace_order', ?, ?, ?)`,
    [randomUUID(), String(sellerId), net, String(orderId), `Sale: ${label}`, now]
  );

  if (fee > 0) {
    await sqlite.run(
      db,
      `INSERT INTO balance_transactions (
        id, user_id, type, amount_cents, reference_type, reference_id, description, created_at
      ) VALUES (?, ?, 'platform_fee', ?, 'marketplace_order', ?, ?, ?)`,
      [
        randomUUID(),
        String(sellerId),
        -fee,
        String(orderId),
        `Platform fee (${MARKETPLACE_PLATFORM_FEE_BPS / 100}%)`,
        now,
      ]
    );
  }

  return { credited: true, netCents: net, feeCents: fee };
}

export async function listWithdrawalsForUser(userId) {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM withdrawal_requests WHERE user_id = ?
     ORDER BY requested_at DESC LIMIT 30`,
    [String(userId)]
  );
  return rows.map((r) => ({
    ...rowToWithdrawal(r),
    amountLabel: formatMoneyLabel(r.amount_cents),
  }));
}

export async function listPendingWithdrawals() {
  const db = await getDb();
  const rows = await sqlite.all(
    db,
    `SELECT * FROM withdrawal_requests WHERE status = 'pending'
     ORDER BY requested_at ASC`
  );
  return rows.map(rowToWithdrawal);
}

export async function getWithdrawalById(id) {
  const db = await getDb();
  const row = await sqlite.get(
    db,
    "SELECT * FROM withdrawal_requests WHERE id = ? LIMIT 1",
    [String(id)]
  );
  return rowToWithdrawal(row);
}

export async function createWithdrawalRequest({
  userId,
  amountCents,
  bankName,
  accountHolder,
  accountNumber,
}) {
  const amount = Number.parseInt(String(amountCents), 10);
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_CENTS) {
    return {
      error: `Minimum withdrawal is ${formatMoneyLabel(MIN_WITHDRAWAL_CENTS)}.`,
    };
  }

  const bank = String(bankName || "").trim();
  const holder = String(accountHolder || "").trim();
  const acct = String(accountNumber || "").trim().replace(/\s+/g, "");
  if (!bank || !holder || !acct || acct.length < 6) {
    return { error: "Bank name, account holder, and account number are required." };
  }

  await ensureBalanceRow(userId);
  const db = await getDb();
  const bal = await sqlite.get(
    db,
    "SELECT available_cents FROM seller_balances WHERE user_id = ?",
    [String(userId)]
  );
  const available = Number(bal?.available_cents) || 0;
  if (amount > available) {
    return { error: "Insufficient balance for this withdrawal." };
  }

  const pending = await sqlite.get(
    db,
    `SELECT id FROM withdrawal_requests WHERE user_id = ? AND status = 'pending' LIMIT 1`,
    [String(userId)]
  );
  if (pending) {
    return { error: "You already have a pending withdrawal. Wait for staff to process it first." };
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  await sqlite.run(
    db,
    `UPDATE seller_balances SET available_cents = available_cents - ?, updated_at = ?
     WHERE user_id = ? AND available_cents >= ?`,
    [amount, now, String(userId), amount]
  );

  const check = await sqlite.get(
    db,
    "SELECT available_cents FROM seller_balances WHERE user_id = ?",
    [String(userId)]
  );
  if (available - amount !== Number(check?.available_cents)) {
    return { error: "Could not reserve balance. Try again." };
  }

  await sqlite.run(
    db,
    `INSERT INTO withdrawal_requests (
      id, user_id, amount_cents, status, bank_name, account_holder, account_number,
      requested_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [id, String(userId), amount, bank, holder, acct, now]
  );

  await sqlite.run(
    db,
    `INSERT INTO balance_transactions (
      id, user_id, type, amount_cents, reference_type, reference_id, description, created_at
    ) VALUES (?, ?, 'withdrawal_hold', ?, 'withdrawal', ?, ?, ?)`,
    [randomUUID(), String(userId), -amount, id, "Withdrawal requested", now]
  );

  return { withdrawal: rowToWithdrawal(await getWithdrawalById(id)) };
}

export async function markWithdrawalPaid(id, adminNote = "") {
  const w = await getWithdrawalById(id);
  if (!w || w.status !== "pending") return null;
  const db = await getDb();
  const now = new Date().toISOString();
  await sqlite.run(
    db,
    `UPDATE withdrawal_requests SET status = 'paid', processed_at = ?, admin_note = ?
     WHERE id = ?`,
    [now, String(adminNote || "").slice(0, 500), String(id)]
  );
  return getWithdrawalById(id);
}

export async function cancelWithdrawal(id, adminNote = "") {
  const w = await getWithdrawalById(id);
  if (!w || w.status !== "pending") return null;
  const db = await getDb();
  const now = new Date().toISOString();

  await sqlite.run(
    db,
    `UPDATE seller_balances SET available_cents = available_cents + ?, updated_at = ?
     WHERE user_id = ?`,
    [w.amountCents, now, w.userId]
  );

  await sqlite.run(
    db,
    `UPDATE withdrawal_requests SET status = 'cancelled', processed_at = ?, admin_note = ?
     WHERE id = ?`,
    [now, String(adminNote || "").slice(0, 500), String(id)]
  );

  await sqlite.run(
    db,
    `INSERT INTO balance_transactions (
      id, user_id, type, amount_cents, reference_type, reference_id, description, created_at
    ) VALUES (?, ?, 'withdrawal_refund', ?, 'withdrawal', ?, ?, ?)`,
    [
      randomUUID(),
      w.userId,
      w.amountCents,
      w.id,
      adminNote ? `Withdrawal cancelled: ${adminNote}` : "Withdrawal cancelled",
      now,
    ]
  );

  return getWithdrawalById(id);
}
