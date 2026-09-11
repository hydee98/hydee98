import { Router } from "express";
import { getAsset } from "../data/assets.js";
import {
  AiServiceError,
  answerAssetQuestion,
  assessRisk,
  estimateValuation,
  generateDueDiligence,
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

aiRouter.post("/assets/:id/risk-score", async (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  try {
    const assessment = await assessRisk(asset);
    res.json({ assessment });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/assets/:id/valuation", async (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  try {
    const valuation = await estimateValuation(asset);
    res.json({ valuation });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/assets/:id/due-diligence", async (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  try {
    const report = await generateDueDiligence(asset);
    res.json({ report });
  } catch (err) {
    handleAiError(res, err);
  }
});

aiRouter.post("/assets/:id/chat", async (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });

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
    const answer = await answerAssetQuestion(asset, question, safeHistory);
    res.json({ answer });
  } catch (err) {
    handleAiError(res, err);
  }
});
