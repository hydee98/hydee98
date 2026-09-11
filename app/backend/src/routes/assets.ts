import { Router } from "express";
import { createAsset, getAsset, listAssets, updateAsset } from "../data/assets.js";
import type { AssetType } from "../types.js";

export const assetsRouter = Router();

assetsRouter.get("/", (_req, res) => {
  res.json({ assets: listAssets() });
});

assetsRouter.get("/:id", (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  res.json({ asset });
});

const VALID_TYPES: AssetType[] = [
  "RealEstate",
  "Invoice",
  "Commodity",
  "PrivateCredit",
  "Other",
];

/** Demo listing endpoint - a production version would only accept this
 * after off-chain KYB on the originator, and the on-chain `register_asset`
 * instruction is what actually creates the asset & mint (see the Anchor
 * program). This lets the frontend demo the full lifecycle without a
 * deployed program. */
assetsRouter.post("/", (req, res) => {
  const {
    name,
    assetType,
    location,
    description,
    documents,
    valuationUsd,
    totalShares,
    pricePerShareLamports,
  } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!VALID_TYPES.includes(assetType)) {
    return res
      .status(400)
      .json({ error: `assetType must be one of ${VALID_TYPES.join(", ")}` });
  }
  if (typeof valuationUsd !== "number" || valuationUsd <= 0) {
    return res.status(400).json({ error: "valuationUsd must be a positive number" });
  }
  if (typeof totalShares !== "number" || totalShares <= 0) {
    return res.status(400).json({ error: "totalShares must be a positive number" });
  }
  if (typeof pricePerShareLamports !== "number" || pricePerShareLamports <= 0) {
    return res
      .status(400)
      .json({ error: "pricePerShareLamports must be a positive number" });
  }

  const asset = createAsset({
    name: name.trim(),
    assetType,
    location: typeof location === "string" ? location : "",
    description: typeof description === "string" ? description : "",
    documents: Array.isArray(documents) ? documents.filter((d) => typeof d === "string") : [],
    valuationUsd,
    totalShares,
    pricePerShareLamports,
    onChainAssetId: null,
    originator: null,
    mint: null,
  });

  res.status(201).json({ asset });
});

/** Applies the outcome of `POST /api/ai/risk-score` to an asset, mirroring
 * what the platform authority would relay on-chain via `approve_asset`. */
assetsRouter.post("/:id/approve", (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset not found" });

  const { aiRiskScore } = req.body ?? {};
  if (typeof aiRiskScore !== "number" || aiRiskScore < 0 || aiRiskScore > 100) {
    return res.status(400).json({ error: "aiRiskScore must be a number between 0 and 100" });
  }

  const status = aiRiskScore <= 70 ? "Active" : "Rejected";
  const updated = updateAsset(req.params.id, { aiRiskScore, status });
  res.json({ asset: updated });
});
