import { Router } from "express";
import { getListing, updateListing } from "../data/listings.js";
import { addDisputeMessage, createOrder, getOrder, listOrders, updateOrder } from "../data/orders.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const ordersRouter = Router();

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { listingId } = req.query;
    res.json({ orders: await listOrders(typeof listingId === "string" ? { listingId } : undefined) });
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

/** Demo Buy-It-Now endpoint - mirrors on-chain `create_order`: buyer pays
 * the listing price into escrow, listing moves to UnderOffer. */
ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { listingId, buyerName } = req.body ?? {};
    if (typeof listingId !== "string" || !listingId) {
      return res.status(400).json({ error: "listingId is required" });
    }
    if (typeof buyerName !== "string" || !buyerName.trim()) {
      return res.status(400).json({ error: "buyerName is required" });
    }
    const listing = await getListing(listingId);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.status !== "Active") {
      return res.status(409).json({ error: `Listing is not open for offers (status: ${listing.status})` });
    }

    const order = await createOrder({
      listingId,
      buyerName: buyerName.trim(),
      amountLamports: listing.priceLamports,
    });
    await updateListing(listingId, { status: "UnderOffer" });

    res.status(201).json({ order });
  })
);

/** Mirrors on-chain `confirm_receipt`: buyer confirms delivery/handover,
 * escrow releases to the seller. */
ordersRouter.post(
  "/:id/confirm-receipt",
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order is not awaiting confirmation (status: ${order.status})` });
    }
    const updated = await updateOrder(req.params.id, { status: "Released" });
    await updateListing(order.listingId, { status: "Sold" });
    res.json({ order: updated });
  })
);

/** Mirrors on-chain `cancel_order`: either party calls off the deal before
 * receipt is confirmed, buyer is refunded in full, listing re-opens. */
ordersRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order cannot be cancelled (status: ${order.status})` });
    }
    const updated = await updateOrder(req.params.id, { status: "Cancelled" });
    await updateListing(order.listingId, { status: "Active" });
    res.json({ order: updated });
  })
);

/** Mirrors on-chain `open_dispute`: either party flags a problem before
 * receipt is confirmed; funds stay locked pending arbitration. */
ordersRouter.post(
  "/:id/dispute",
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "Funded") {
      return res.status(409).json({ error: `Order cannot be disputed (status: ${order.status})` });
    }
    const { author, content } = req.body ?? {};
    if (author !== "buyer" && author !== "seller") {
      return res.status(400).json({ error: "author must be 'buyer' or 'seller'" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    await updateOrder(req.params.id, { status: "Disputed" });
    const updated = await addDisputeMessage(req.params.id, {
      author,
      content: content.trim(),
      createdAt: new Date().toISOString(),
    });
    res.json({ order: updated });
  })
);

/** Add an additional evidence message to an already-open dispute, from
 * either party. */
ordersRouter.post(
  "/:id/dispute/messages",
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "Disputed") {
      return res.status(409).json({ error: "Order does not have an open dispute" });
    }
    const { author, content } = req.body ?? {};
    if (author !== "buyer" && author !== "seller") {
      return res.status(400).json({ error: "author must be 'buyer' or 'seller'" });
    }
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const updated = await addDisputeMessage(req.params.id, {
      author,
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
