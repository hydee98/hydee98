import { Router } from "express";
import { getListing } from "../data/listings.js";
import { getOrder } from "../data/orders.js";
import {
  AiServiceError,
  answerListingQuestion,
  screenListingForFraud,
  suggestPrice,
  summarizeDispute,
} from "../services/aiService.js";
import type { ChatMessage } from "../types.js";

export const aiRouter = Router();

function handleAiError(res: import("express").Response, err: unknown) {
  if (err instanceof AiServiceError) {
    // 503: the request was valid, the AI backend is the problem.
    return res.status(503).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "Unexpected server error" });
}

aiRouter.post("/listings/:id/fraud-screen", async (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  try {
    const screening = await screenListingForFraud(listing);
    res.json({ screening });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/listings/:id/price-suggestion", async (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  try {
    const suggestion = await suggestPrice(listing);
    res.json({ suggestion });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/listings/:id/chat", async (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const { question, history } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "question is required" });
  }
  const safeHistory: ChatMessage[] = Array.isArray(history)
    ? history
        .filter(
          (m): m is ChatMessage =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .slice(-10) // keep the request small; the API is stateless anyway
    : [];

  try {
    const answer = await answerListingQuestion(listing, question, safeHistory);
    res.json({ answer });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/orders/:id/dispute-summary", async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "Disputed") {
    return res.status(409).json({ error: "Order does not have an open dispute" });
  }
  const listing = getListing(order.listingId);
  if (!listing) return res.status(404).json({ error: "Listing not found for this order" });

  try {
    const summary = await summarizeDispute(listing, order);
    res.json({ summary });
  } catch (err) {
    handleAiError(res, err);
  }
});
