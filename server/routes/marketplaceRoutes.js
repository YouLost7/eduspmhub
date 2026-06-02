import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  STUDENT_MAX_PRICE_CENTS,
  LISTING_CATEGORIES,
  ITEM_TYPES,
  CATEGORY_IDS,
  MAX_PHOTOS,
  MAX_TITLE_LEN,
} from "../marketplace/constants.js";
import {
  formatMoneyLabel,
  marketplacePaymentCourseId,
  getListingById,
  listActiveListings,
  listListingsForSeller,
  insertListing,
  updateListing,
  markListingSold,
  getOrderById,
  insertOrder,
  listOrdersForUser,
  updateOrderStatus,
  validateListingPriceCents,
} from "../marketplace/store.js";
import {
  isSafeMarketplacePhotoKey,
  isSafeMarketplaceDigitalKey,
} from "../marketplace/uploads.js";
import { upsertPaymentRecord, getPaymentBySessionId } from "../payments/store.js";
import { createStripeClient, fetchStripeReceiptUrl } from "../payments/stripe.js";
import { priceToCents } from "../payments/store.js";
import {
  insertReport,
  listOpenReports,
  updateReportStatus,
  isValidReportReason,
  REPORT_REASONS,
} from "../marketplace/reports.js";
import {
  MARKETPLACE_PLATFORM_FEE_BPS,
  getConnectAccountStatus,
  ensureConnectAccount,
  createConnectOnboardingLink,
  buildCheckoutConnectPaymentIntentData,
} from "../marketplace/connect.js";

const STRIPE_MIN_AMOUNT_CENTS_MYR = 200;

async function persistUserField(loadUsers, saveUsers, userId, patch) {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch };
  await saveUsers(users);
  return users[idx];
}

function resolveListingPrice(body, sellerRole) {
  if (body.priceCents != null) {
    return validateListingPriceCents(body.priceCents, sellerRole);
  }
  const cents = priceToCents(body.price);
  return validateListingPriceCents(cents, sellerRole);
}

function enrichListing(listing, users, findUserById, viewerId) {
  const seller = findUserById(users, listing.sellerId);
  const isOwner = viewerId && listing.sellerId === viewerId;
  return {
    ...listing,
    priceLabel: formatMoneyLabel(listing.priceCents, listing.currency),
    sellerName: seller?.fullName || "Seller",
    sellerRole: seller?.role || "",
    sellerSchool: seller?.schoolName || "",
    isOwner: Boolean(isOwner),
    canEdit: Boolean(isOwner && listing.status !== "sold"),
    photoUrls: listing.photoKeys.map(
      (_, i) => `/api/marketplace/listings/${listing.id}/photos/${i}`
    ),
    hasDigitalFile: Boolean(listing.digitalFileKey),
    categoryLabel:
      LISTING_CATEGORIES.find((c) => c.id === listing.category)?.label || listing.category,
  };
}

function enrichOrder(order, users, findUserById, viewerId) {
  const buyer = findUserById(users, order.buyerId);
  const seller = findUserById(users, order.sellerId);
  const isBuyer = viewerId === order.buyerId;
  const isSeller = viewerId === order.sellerId;
  return {
    ...order,
    amountLabel: formatMoneyLabel(order.amountCents, order.currency),
    buyerName: buyer?.fullName || "Buyer",
    sellerName: seller?.fullName || "Seller",
    isBuyer,
    isSeller,
    canDownload:
      isBuyer && order.itemType === "digital" && ["paid", "seller_ready", "completed"].includes(order.status),
    canMarkReady: isSeller && order.itemType === "physical" && order.status === "paid",
    canConfirmReceived:
      isBuyer &&
      order.itemType === "physical" &&
      (order.status === "seller_ready" || order.status === "paid"),
  };
}

export async function grantPaidMarketplaceFromSession(session, deps) {
  const { stripe, providerEventId = null } = deps;
  const m = session?.metadata || {};
  const orderId = String(m.orderId || "").trim();
  const listingId = String(m.listingId || "").trim();
  const buyerId = String(m.userId || session?.client_reference_id || "").trim();
  const sellerId = String(m.sellerId || "").trim();
  const sessionId = String(session?.id || "").trim();
  const paymentIntentId =
    typeof session?.payment_intent === "string" ? session.payment_intent : "";
  if (!orderId || !listingId || !buyerId || !sellerId || !sessionId) {
    throw new Error("Missing marketplace checkout metadata");
  }

  const existing = await getPaymentBySessionId("stripe", sessionId);
  if (existing?.status === "paid") {
    return getOrderById(orderId);
  }

  const listing = await getListingById(listingId);
  if (!listing) throw new Error("Listing not found for paid session");

  const sold = await markListingSold(listingId);
  if (!sold && listing.status === "sold") {
    const prior = await getOrderById(orderId);
    if (prior) return prior;
  }
  if (!sold) {
    throw new Error("Listing is no longer available");
  }

  const amountCents = Number(
    session?.amount_total ?? existing?.amount_cents ?? m.amountCents ?? listing.priceCents
  );
  const currency = String(session?.currency || existing?.currency || "myr").toLowerCase();
  const paidAt = new Date().toISOString();
  let receiptUrl = null;
  if (stripe && paymentIntentId) {
    receiptUrl = await fetchStripeReceiptUrl(stripe, paymentIntentId);
  }
  const paymentId = existing?.id || randomUUID();
  const courseId = marketplacePaymentCourseId(orderId);
  const courseTitle = `Marketplace: ${listing.title}`;

  await upsertPaymentRecord({
    id: paymentId,
    provider: "stripe",
    providerSessionId: sessionId,
    providerPaymentIntentId: paymentIntentId || null,
    providerEventId,
    userId: buyerId,
    courseId,
    courseTitle,
    amountCents,
    currency,
    status: "paid",
    receiptUrl: receiptUrl || null,
    paymentMethodType: "card",
    rawPayload: session,
    paidAt,
  });

  let order = await getOrderById(orderId);
  if (!order) {
    order = await insertOrder({
      id: orderId,
      listingId,
      buyerId,
      sellerId,
      status: listing.itemType === "digital" ? "completed" : "paid",
      itemType: listing.itemType,
      title: listing.title,
      amountCents,
      currency,
      paymentId,
      buyerNotes: String(m.buyerNotes || ""),
      completedAt: listing.itemType === "digital" ? paidAt : null,
    });
  }

  return order;
}

export function registerMarketplaceRoutes(app, deps) {
  const {
    requireAuth,
    loadUsers,
    saveUsers,
    findUserById,
    APP_BASE_URL,
    STRIPE_SECRET_KEY,
    isProd,
    allowMockPayments = !isProd,
    MARKETPLACE_PHOTO_DIR,
    MARKETPLACE_FILE_DIR,
    runMarketplacePhotoUpload,
    runMarketplaceDigitalUpload,
    adminLimiter,
    ADMIN_KEY,
  } = deps;

  const stripe = STRIPE_SECRET_KEY ? createStripeClient(STRIPE_SECRET_KEY) : null;

  app.get("/api/marketplace/meta", requireAuth, (_req, res) => {
    res.json({
      categories: LISTING_CATEGORIES,
      reportReasons: REPORT_REASONS,
      studentMaxPriceCents: STUDENT_MAX_PRICE_CENTS,
      studentMaxPriceLabel: "RM50.00",
      minPriceCents: STRIPE_MIN_AMOUNT_CENTS_MYR,
      platformFeePercent: MARKETPLACE_PLATFORM_FEE_BPS / 100,
    });
  });

  app.get("/api/marketplace/connect/status", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u) return res.status(401).json({ error: "Not signed in" });
      if (!stripe) {
        return res.json({
          configured: false,
          connect: { connected: false, ready: false },
        });
      }
      const connect = await getConnectAccountStatus(stripe, u.stripeConnectAccountId);
      res.json({ configured: true, connect });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load payout status" });
    }
  });

  app.post("/api/marketplace/connect/onboard", requireAuth, async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({
          error: "Stripe is not configured. Set STRIPE_SECRET_KEY to enable seller payouts.",
        });
      }
      const users = await loadUsers();
      let u = findUserById(users, req.session.userId);
      if (!u) return res.status(401).json({ error: "Not signed in" });

      const { accountId, created } = await ensureConnectAccount(stripe, u);
      if (created) {
        u = await persistUserField(loadUsers, saveUsers, u.id, {
          stripeConnectAccountId: accountId,
        });
      }

      const status = await getConnectAccountStatus(stripe, accountId);
      if (status.ready) {
        return res.json({ connect: status, alreadyReady: true });
      }

      const link = await createConnectOnboardingLink(stripe, accountId, APP_BASE_URL);
      res.json({ url: link.url, connect: status });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Could not start payout setup" });
    }
  });

  app.post("/api/marketplace/listings/:id/report", requireAuth, async (req, res) => {
    try {
      const listing = await getListingById(req.params.id);
      if (!listing || listing.status === "removed") {
        return res.status(404).json({ error: "Listing not found" });
      }
      if (listing.sellerId === req.session.userId) {
        return res.status(400).json({ error: "You cannot report your own listing." });
      }
      const reason = String(req.body?.reason || "").trim();
      const details = String(req.body?.details || "").trim();
      if (!isValidReportReason(reason)) {
        return res.status(400).json({ error: "Choose a valid report reason." });
      }
      const result = await insertReport({
        listingId: listing.id,
        reporterId: req.session.userId,
        reason,
        details,
      });
      if (result.duplicate) {
        return res.status(409).json({ error: "You already reported this listing." });
      }
      res.status(201).json({ ok: true, report: result.report });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not submit report" });
    }
  });

  app.get("/api/marketplace/listings", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const category = String(req.query.category || "").trim();
      const itemType = String(req.query.itemType || "").trim();
      const q = String(req.query.q || "").trim();
      const listings = await listActiveListings({ category, itemType, q });
      res.json({
        listings: listings.map((l) =>
          enrichListing(l, users, findUserById, req.session.userId)
        ),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load listings" });
    }
  });

  app.get("/api/marketplace/my-listings", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const listings = await listListingsForSeller(req.session.userId);
      res.json({
        listings: listings.map((l) =>
          enrichListing(l, users, findUserById, req.session.userId)
        ),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load your listings" });
    }
  });

  app.get("/api/marketplace/listings/:id", requireAuth, async (req, res) => {
    try {
      const listing = await getListingById(req.params.id);
      if (!listing || listing.status === "removed") {
        return res.status(404).json({ error: "Listing not found" });
      }
      const users = await loadUsers();
      const viewerId = req.session.userId;
      const isOwner = listing.sellerId === viewerId;
      if (listing.status !== "active" && !isOwner) {
        const order = (await listOrdersForUser(viewerId)).find(
          (o) => o.listingId === listing.id
        );
        if (!order) return res.status(404).json({ error: "Listing not found" });
      }
      res.json({
        listing: enrichListing(listing, users, findUserById, viewerId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load listing" });
    }
  });

  app.post("/api/marketplace/listings", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      if (!u) return res.status(401).json({ error: "Not signed in" });

      const {
        itemType,
        category,
        title,
        description,
        price,
        priceCents: rawCents,
        condition,
        pickupArea,
        pickupNotes,
        subject,
        formLevel,
        publish,
      } = req.body;

      if (!ITEM_TYPES.has(String(itemType))) {
        return res.status(400).json({ error: "Choose physical or digital item type." });
      }
      if (!CATEGORY_IDS.has(String(category))) {
        return res.status(400).json({ error: "Choose a valid category." });
      }
      const titleStr = String(title || "").trim();
      if (!titleStr || titleStr.length > MAX_TITLE_LEN) {
        return res.status(400).json({ error: "Title is required (max 120 characters)." });
      }

      const priceResolved = resolveListingPrice(
        { price, priceCents: rawCents },
        u.role
      );
      if (priceResolved.error) {
        return res.status(400).json({ error: priceResolved.error });
      }

      if (itemType === "physical") {
        if (!String(pickupArea || "").trim()) {
          return res.status(400).json({ error: "Pickup area is required for physical items." });
        }
      }

      if (publish && itemType === "digital") {
        return res.status(400).json({
          error: "Upload your digital file first, then publish from the sell page.",
        });
      }

      const status = publish ? "active" : "draft";
      const listing = await insertListing({
        sellerId: u.id,
        status,
        itemType,
        category,
        title: titleStr,
        description: String(description || ""),
        priceCents: priceResolved.cents,
        condition: String(condition || ""),
        pickupArea: String(pickupArea || ""),
        pickupNotes: String(pickupNotes || ""),
        subject: String(subject || u.studentSubject || u.educatorSubject || ""),
        formLevel: String(formLevel || u.studentForm || ""),
      });

      res.status(201).json({
        listing: enrichListing(listing, users, findUserById, u.id),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not create listing" });
    }
  });

  app.patch("/api/marketplace/listings/:id", requireAuth, async (req, res) => {
    try {
      const listing = await getListingById(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      if (listing.sellerId !== req.session.userId) {
        return res.status(403).json({ error: "Not your listing" });
      }
      if (listing.status === "sold") {
        return res.status(400).json({ error: "Sold listings cannot be edited." });
      }

      const users = await loadUsers();
      const u = findUserById(users, req.session.userId);
      const patch = {};

      if (req.body.title != null) {
        const t = String(req.body.title).trim();
        if (!t) return res.status(400).json({ error: "Title cannot be empty" });
        patch.title = t;
      }
      if (req.body.description != null) patch.description = req.body.description;
      if (req.body.condition != null) patch.condition = req.body.condition;
      if (req.body.pickupArea != null) patch.pickupArea = req.body.pickupArea;
      if (req.body.pickupNotes != null) patch.pickupNotes = req.body.pickupNotes;
      if (req.body.subject != null) patch.subject = req.body.subject;
      if (req.body.formLevel != null) patch.formLevel = req.body.formLevel;
      if (req.body.category != null) {
        if (!CATEGORY_IDS.has(String(req.body.category))) {
          return res.status(400).json({ error: "Invalid category" });
        }
        patch.category = req.body.category;
      }
      if (req.body.price != null || req.body.priceCents != null) {
        const pr = resolveListingPrice(req.body, u.role);
        if (pr.error) return res.status(400).json({ error: pr.error });
        patch.priceCents = pr.cents;
      }
      if (req.body.publish === true) {
        const nextType = patch.itemType || listing.itemType;
        if (nextType === "digital" && !listing.digitalFileKey && !patch.digitalFileKey) {
          return res.status(400).json({ error: "Upload a PDF or ZIP before publishing." });
        }
        if (nextType === "physical" && !String(patch.pickupArea || listing.pickupArea).trim()) {
          return res.status(400).json({ error: "Pickup area is required for physical items." });
        }
        patch.status = "active";
      }
      if (req.body.publish === false && listing.status === "active") {
        patch.status = "draft";
      }
      if (req.body.remove === true) patch.status = "removed";

      const updated = await updateListing(listing.id, patch);
      if (!updated) return res.status(400).json({ error: "Could not update listing" });
      res.json({ listing: enrichListing(updated, users, findUserById, u.id) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not update listing" });
    }
  });

  app.post(
    "/api/marketplace/listings/:id/photos",
    requireAuth,
    runMarketplacePhotoUpload,
    async (req, res) => {
      try {
        const listing = await getListingById(req.params.id);
        if (!listing) return res.status(404).json({ error: "Listing not found" });
        if (listing.sellerId !== req.session.userId) {
          return res.status(403).json({ error: "Not your listing" });
        }
        if (!req.file) return res.status(400).json({ error: "Photo file required" });
        if (listing.photoKeys.length >= MAX_PHOTOS) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos allowed.` });
        }
        const key = req.file.filename;
        if (!isSafeMarketplacePhotoKey(key, listing.id)) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: "Invalid photo key" });
        }
        const users = await loadUsers();
        const updated = await updateListing(listing.id, {
          photoKeys: [...listing.photoKeys, key],
        });
        res.json({
          listing: enrichListing(updated, users, findUserById, req.session.userId),
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not upload photo" });
      }
    }
  );

  app.post(
    "/api/marketplace/listings/:id/digital",
    requireAuth,
    runMarketplaceDigitalUpload,
    async (req, res) => {
      try {
        const listing = await getListingById(req.params.id);
        if (!listing) return res.status(404).json({ error: "Listing not found" });
        if (listing.sellerId !== req.session.userId) {
          return res.status(403).json({ error: "Not your listing" });
        }
        if (listing.itemType !== "digital") {
          return res.status(400).json({ error: "This listing is not a digital item." });
        }
        if (!req.file) return res.status(400).json({ error: "File required (PDF or ZIP)" });
        const key = req.file.filename;
        if (!isSafeMarketplaceDigitalKey(key, listing.id)) {
          await unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: "Invalid file key" });
        }
        if (listing.digitalFileKey) {
          const oldPath = path.join(MARKETPLACE_FILE_DIR, listing.digitalFileKey);
          if (existsSync(oldPath)) await unlink(oldPath).catch(() => {});
        }
        const users = await loadUsers();
        const updated = await updateListing(listing.id, {
          digitalFileKey: key,
          digitalFileName: req.file.originalname || key,
        });
        res.json({
          listing: enrichListing(updated, users, findUserById, req.session.userId),
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not upload file" });
      }
    }
  );

  app.get("/api/marketplace/listings/:id/photos/:index", requireAuth, async (req, res) => {
    try {
      const listing = await getListingById(req.params.id);
      if (!listing) return res.status(404).end();
      const idx = Number.parseInt(req.params.index, 10);
      const key = listing.photoKeys[idx];
      if (!key || !isSafeMarketplacePhotoKey(key, listing.id)) {
        return res.status(404).end();
      }
      const filePath = path.join(MARKETPLACE_PHOTO_DIR, key);
      if (!existsSync(filePath)) return res.status(404).end();
      const ext = path.extname(key).toLowerCase();
      const type =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      res.setHeader("Content-Type", type);
      createReadStream(filePath).pipe(res);
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  });

  app.post("/api/marketplace/checkout", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const buyer = findUserById(users, req.session.userId);
      if (!buyer) return res.status(401).json({ error: "Not signed in" });

      const listingId = String(req.body?.listingId || "").trim();
      const buyerNotes = String(req.body?.buyerNotes || "").slice(0, 500);
      const listing = await getListingById(listingId);
      if (!listing || listing.status !== "active") {
        return res.status(400).json({ error: "This item is not available for purchase." });
      }
      if (listing.sellerId === buyer.id) {
        return res.status(400).json({ error: "You cannot buy your own listing." });
      }

      const orderId = randomUUID();
      const amountCents = listing.priceCents;

      if (!stripe) {
        if (!allowMockPayments) {
          return res.status(503).json({ error: "Payments are not configured." });
        }
        const sold = await markListingSold(listingId);
        if (!sold) {
          return res.status(409).json({ error: "Item was just sold to someone else." });
        }
        const paymentId = randomUUID();
        const now = new Date().toISOString();
        await upsertPaymentRecord({
          id: paymentId,
          provider: "mock",
          userId: buyer.id,
          courseId: marketplacePaymentCourseId(orderId),
          courseTitle: `Marketplace: ${listing.title}`,
          amountCents,
          currency: listing.currency,
          status: "paid",
          paymentMethodType: "mock",
          paidAt: now,
        });
        const order = await insertOrder({
          id: orderId,
          listingId,
          buyerId: buyer.id,
          sellerId: listing.sellerId,
          status: listing.itemType === "digital" ? "completed" : "paid",
          itemType: listing.itemType,
          title: listing.title,
          amountCents,
          currency: listing.currency,
          paymentId,
          buyerNotes,
          completedAt: listing.itemType === "digital" ? now : null,
        });
        return res.json({
          checkoutUrl: `${APP_BASE_URL}/marketplace/orders?payment=success&order=${encodeURIComponent(orderId)}&mock=1`,
          sessionId: `mock_${paymentId}`,
          orderId: order.id,
          mock: true,
        });
      }

      const successUrl = `${APP_BASE_URL}/marketplace/orders?payment=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${APP_BASE_URL}/marketplace/${encodeURIComponent(listingId)}?payment=cancelled`;

      const seller = findUserById(users, listing.sellerId);
      const paymentIntentData = buildCheckoutConnectPaymentIntentData(
        amountCents,
        seller?.stripeConnectAccountId
      );

      const sessionPayload = {
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: String(buyer.id),
        metadata: {
          productType: "marketplace",
          userId: String(buyer.id),
          orderId: String(orderId),
          listingId: String(listingId),
          sellerId: String(listing.sellerId),
          amountCents: String(amountCents),
          buyerNotes,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: listing.currency,
              unit_amount: amountCents,
              product_data: {
                name: listing.title,
                description: `${listing.itemType === "digital" ? "Digital download" : "Pickup"} · ${LISTING_CATEGORIES.find((c) => c.id === listing.category)?.label || "Study material"}`,
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      };
      if (paymentIntentData) {
        sessionPayload.payment_intent_data = paymentIntentData;
      }

      const session = await stripe.checkout.sessions.create(sessionPayload);

      res.json({
        checkoutUrl: session.url,
        sessionId: session.id,
        orderId,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not start checkout" });
    }
  });

  app.get("/api/marketplace/orders", requireAuth, async (req, res) => {
    try {
      const users = await loadUsers();
      const orders = await listOrdersForUser(req.session.userId);
      res.json({
        orders: orders.map((o) =>
          enrichOrder(o, users, findUserById, req.session.userId)
        ),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load orders" });
    }
  });

  app.post("/api/marketplace/orders/:id/seller-ready", requireAuth, async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.sellerId !== req.session.userId) {
        return res.status(403).json({ error: "Not your sale" });
      }
      if (order.itemType !== "physical" || order.status !== "paid") {
        return res.status(400).json({ error: "Cannot update this order" });
      }
      const now = new Date().toISOString();
      const updated = await updateOrderStatus(order.id, {
        status: "seller_ready",
        sellerReadyAt: now,
      });
      const users = await loadUsers();
      res.json({
        order: enrichOrder(updated, users, findUserById, req.session.userId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not update order" });
    }
  });

  app.post("/api/marketplace/orders/:id/confirm", requireAuth, async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.buyerId !== req.session.userId) {
        return res.status(403).json({ error: "Not your purchase" });
      }
      if (!["paid", "seller_ready"].includes(order.status)) {
        return res.status(400).json({ error: "Cannot confirm this order" });
      }
      const now = new Date().toISOString();
      const updated = await updateOrderStatus(order.id, {
        status: "completed",
        completedAt: now,
      });
      const users = await loadUsers();
      res.json({
        order: enrichOrder(updated, users, findUserById, req.session.userId),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not confirm order" });
    }
  });

  app.get("/api/marketplace/orders/:id/download", requireAuth, async (req, res) => {
    try {
      const order = await getOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.buyerId !== req.session.userId) {
        return res.status(403).json({ error: "Not your purchase" });
      }
      if (order.itemType !== "digital") {
        return res.status(400).json({ error: "Not a digital order" });
      }
      if (!["paid", "seller_ready", "completed"].includes(order.status)) {
        return res.status(403).json({ error: "Download not available" });
      }
      const listing = await getListingById(order.listingId);
      if (!listing?.digitalFileKey) {
        return res.status(404).json({ error: "File not found" });
      }
      if (!isSafeMarketplaceDigitalKey(listing.digitalFileKey, listing.id)) {
        return res.status(404).json({ error: "Invalid file" });
      }
      const filePath = path.join(MARKETPLACE_FILE_DIR, listing.digitalFileKey);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: "File missing on server" });
      }
      const name = listing.digitalFileName || listing.digitalFileKey;
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
      createReadStream(filePath).pipe(res);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not download file" });
    }
  });

  app.get("/api/admin/marketplace-reports", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Invalid admin key" });
    }
    try {
      const reports = await listOpenReports();
      const users = await loadUsers();
      const enriched = await Promise.all(
        reports.map(async (r) => {
          const listing = await getListingById(r.listingId);
          const reporter = findUserById(users, r.reporterId);
          return {
            ...r,
            listingTitle: listing?.title || "(removed)",
            listingStatus: listing?.status || "unknown",
            reporterName: reporter?.fullName || "User",
            reporterEmail: reporter?.email || "",
            reasonLabel:
              REPORT_REASONS.find((x) => x.id === r.reason)?.label || r.reason,
          };
        })
      );
      res.json({ reports: enriched });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load reports" });
    }
  });

  app.post("/api/admin/marketplace-reports/:id/dismiss", adminLimiter, async (req, res) => {
    const key = req.get("x-admin-key");
    if (!key || key !== ADMIN_KEY) {
      return res.status(401).json({ error: "Invalid admin key" });
    }
    try {
      const report = await updateReportStatus(req.params.id, "dismissed");
      if (!report) return res.status(404).json({ error: "Report not found" });
      res.json({ ok: true, report });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not dismiss report" });
    }
  });

  app.post(
    "/api/admin/marketplace-reports/:id/remove-listing",
    adminLimiter,
    async (req, res) => {
      const key = req.get("x-admin-key");
      if (!key || key !== ADMIN_KEY) {
        return res.status(401).json({ error: "Invalid admin key" });
      }
      try {
        const report = await updateReportStatus(req.params.id, "reviewed");
        if (!report) return res.status(404).json({ error: "Report not found" });
        await updateListing(report.listingId, { status: "removed" });
        res.json({ ok: true, report });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not remove listing" });
      }
    }
  );
}
