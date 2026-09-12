import { Router } from "express";
import { getListing, updateListing } from "../data/listings.js";
import { addDisputeMessage, createOrder, getOrder, listOrders, updateOrder } from "../data/orders.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { Listing, Order } from "../types.js";

export const ordersRouter = Router();

/** Buyer or seller (of the order's listing) - used to gate actions either
 * party may take, and to derive dispute message authorship from identity
 * rather than trusting a client-supplied role. */
function roleFor(order: Order, listing: Listing | undefined, publicKey: string): "buyer" | "seller" | null {
  if (order.buyerWallet === publicKey) return "buyer";
  if (listing?.seller === publicKey) return "seller";
  return null;
}

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { listingId } = req.query;
    res.json({ orders: await listOrders(typeof listingId === "string" ? { listingId } : undefined) });
  })
);

/** Requires a signed-in wallet: only orders where the caller is the buyer
 * or the seller (of the order's listing) are returned. */
ordersRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const publicKey = req.auth!.publicKey;
    const all = await listOrders();
    const mine: Array<Order & { role: "buyer" | "seller" }> = [];
    for (const order of all) {
      const listing = await getListing(order.listingId);
      const role = roleFor(order, listing, publicKey);
      if (role) mine.push({ ...order, role });
    }
    res.json({ orders: mine });
  })
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ order });
  })
);

/** Requires a signed-in wallet - mirrors on-chain `create_order`: buyer
 * pays the listing price into escrow, listing moves to UnderOffer. The
 * buyer is always the authenticated caller, and can't be the listing's
 * own seller. */
ordersRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { listingId } = req.body ?? {};
    if (typeof listingId !== "string" || !listingId) {
      return res.status(400).json({ error: "listingId is required" });
    }
    const listing = await getListing(listingId);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.status !== "Active") {
      return res.status(409).json({ error: `Listing is not open for offers (status: ${listing.status})` });
    }
    if (listing.seller === req.auth!.publicKey) {
      return res.status(400).json({ error: "You can't buy your own listing" });
    }

    const order = await createOrder({
      listingId,
      buyerWallet: req.auth!.publicKey,
      amountLamports: listing.priceLamports,
    });
    await updateListing(listingId, { status: "UnderOffer" });

    res.status(201).json({ order });
  })
);

/** Buyer-only: mirrors on-chain `confirm_receipt` - confirms delivery/
 * handover, escrow releases to the seller. */
ordersRouter.post(
  "/:id/confirm-receipt",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.buyerWallet !== req.auth!.publicKey) {
      return res.status(403).json({ error: "Only the buyer can confirm receipt" });
    }
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order is not awaiting confirmation (status: ${order.status})` });
    }
    const updated = await updateOrder(req.params.id, { status: "Released" });
    await updateListing(order.listingId, { status: "Sold" });
    res.json({ order: updated });
  })
);

/** Buyer or seller: mirrors on-chain `cancel_order` - either party calls
 * off the deal before receipt is confirmed, buyer is refunded in full,
 * listing re-opens. */
ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const listing = await getListing(order.listingId);
    if (!roleFor(order, listing, req.auth!.publicKey)) {
      return res.status(403).json({ error: "Only the buyer or seller can cancel this order" });
    }
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order cannot be cancelled (status: ${order.status})` });
    }
    const updated = await updateOrder(req.params.id, { status: "Cancelled" });
    await updateListing(order.listingId, { status: "Active" });
    res.json({ order: updated });
  })
);

/** Buyer or seller: mirrors on-chain `open_dispute` - flags a problem
 * before receipt is confirmed; funds stay locked pending arbitration.
 * Authorship of the dispute message is derived from identity, not
 * client-supplied. */
ordersRouter.post(
  "/:id/dispute",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const listing = await getListing(order.listingId);
    const role = roleFor(order, listing, req.auth!.publicKey);
    if (!role) {
      return res.status(403).json({ error: "Only the buyer or seller can open a dispute" });
    }
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order cannot be disputed (status: ${order.status})` });
    }
    const { content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    await updateOrder(req.params.id, { status: "Disputed" });
    const updated = await addDisputeMessage(req.params.id, {
      author: role,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    });
    res.json({ order: updated });
  })
);

/** Add an additional evidence message to an already-open dispute, from
 * either party (author derived from identity). */
ordersRouter.post(
  "/:id/dispute/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const listing = await getListing(order.listingId);
    const role = roleFor(order, listing, req.auth!.publicKey);
    if (!role) {
      return res.status(403).json({ error: "Only the buyer or seller can post to this dispute" });
    }
    if (order.status !== "Disputed") {
      return res.status(409).json({ error: "Order does not have an open dispute" });
    }
    const { content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const updated = await addDisputeMessage(req.params.id, {
      author: role,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    });
    res.json({ order: updated });
  })
);

/** Authority-only (see requireAdmin): mirrors on-chain `resolve_dispute` -
 * the arbitrator releases, refunds, or splits the escrow. */
ordersRouter.post(
  "/:id/resolve",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "Disputed") {
      return res.status(409).json({ error: "Order does not have an open dispute" });
    }
    const { resolution } = req.body ?? {};
    if (!["ReleaseToSeller", "RefundBuyer", "Split"].includes(resolution)) {
      return res.status(400).json({ error: "resolution must be ReleaseToSeller, RefundBuyer, or Split" });
    }

    const updated = await updateOrder(req.params.id, { status: "Resolved" });
    await updateListing(order.listingId, { status: resolution === "RefundBuyer" ? "Active" : "Sold" });
    res.json({ order: updated });
  })
);
