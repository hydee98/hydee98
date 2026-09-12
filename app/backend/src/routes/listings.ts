import { Router } from "express";
import { createListing, getListing, listListings, updateListing } from "../data/listings.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { ListingCategory, ListingType } from "../types.js";

export const listingsRouter = Router();

const MAX_IMAGES = 6;
// ~4MB of base64 text decodes to ~3MB of image data - generous for a
// client-side-compressed photo, small enough to keep a JSONB row healthy.
const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024;

listingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category, q, minPrice, maxPrice, location, listingType } = req.query;
    let results = await listListings();

    if (typeof category === "string" && category) {
      results = results.filter((l) => l.category === category);
    }
    if (typeof listingType === "string" && listingType) {
      results = results.filter((l) => l.listingType === listingType);
    }
    if (typeof location === "string" && location.trim()) {
      const needle = location.trim().toLowerCase();
      results = results.filter((l) => l.location.toLowerCase().includes(needle));
    }
    if (typeof q === "string" && q.trim()) {
      const needle = q.trim().toLowerCase();
      results = results.filter(
        (l) =>
          l.title.toLowerCase().includes(needle) || l.description.toLowerCase().includes(needle)
      );
    }
    const min = typeof minPrice === "string" ? Number(minPrice) : undefined;
    if (min !== undefined && !Number.isNaN(min)) {
      results = results.filter((l) => l.guidePriceGBP >= min);
    }
    const max = typeof maxPrice === "string" ? Number(maxPrice) : undefined;
    if (max !== undefined && !Number.isNaN(max)) {
      results = results.filter((l) => l.guidePriceGBP <= max);
    }

    res.json({ listings: results });
  })
);

listingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const listing = await getListing(req.params.id);
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    res.json({ listing });
  })
);

const VALID_CATEGORIES: ListingCategory[] = ["Property", "Item"];
const VALID_TYPES: ListingType[] = ["ForSale", "ToLet"];

/** Requires a signed-in wallet (see requireAuth) - the seller is always
 * the authenticated caller, never a client-supplied value. Mirrors the
 * on-chain `create_listing` instruction, which likewise takes the
 * seller's identity from the transaction signer. */
listingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, category, listingType, location, description, images, priceLamports, guidePriceGBP } =
      req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of ${VALID_CATEGORIES.join(", ")}` });
    }
    if (!VALID_TYPES.includes(listingType)) {
      return res.status(400).json({ error: `listingType must be one of ${VALID_TYPES.join(", ")}` });
    }
    if (category === "Item" && listingType !== "ForSale") {
      return res.status(400).json({ error: "listingType must be ForSale for an Item" });
    }
    if (typeof priceLamports !== "number" || priceLamports <= 0) {
      return res.status(400).json({ error: "priceLamports must be a positive number" });
    }
    if (typeof guidePriceGBP !== "number" || guidePriceGBP <= 0) {
      return res.status(400).json({ error: "guidePriceGBP must be a positive number" });
    }

    const rawImages: unknown[] = Array.isArray(images) ? images : [];
    if (rawImages.length > MAX_IMAGES) {
      return res.status(400).json({ error: `At most ${MAX_IMAGES} images are allowed` });
    }
    const cleanedImages: string[] = [];
    for (const img of rawImages) {
      if (typeof img !== "string") continue;
      const isDataUrl = img.startsWith("data:image/");
      const isHttpUrl = img.startsWith("http://") || img.startsWith("https://");
      if (!isDataUrl && !isHttpUrl) {
        return res.status(400).json({ error: "Images must be image data URLs or http(s) URLs" });
      }
      if (isDataUrl && img.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return res.status(400).json({ error: "One or more images are too large (compress before upload)" });
      }
      cleanedImages.push(img);
    }

    const listing = await createListing({
      title: title.trim(),
      seller: req.auth!.publicKey,
      category,
      listingType,
      location: typeof location === "string" ? location : "N/A",
      description: typeof description === "string" ? description : "",
      images: cleanedImages,
      priceLamports,
      guidePriceGBP,
    });

    res.status(201).json({ listing });
  })
);

/** Authority-only (see requireAdmin): applies the outcome of
 * `POST /api/ai/listings/:id/fraud-screen` to a listing, mirroring what
 * the platform authority would relay on-chain via `review_listing`. */
listingsRouter.post(
  "/:id/review",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const listing = await getListing(req.params.id);
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    const { aiFraudScore, aiFraudFlags } = req.body ?? {};
    if (typeof aiFraudScore !== "number" || aiFraudScore < 0 || aiFraudScore > 100) {
      return res.status(400).json({ error: "aiFraudScore must be a number between 0 and 100" });
    }

    const status = aiFraudScore <= 60 ? "Active" : "Flagged";
    const updated = await updateListing(req.params.id, {
      aiFraudScore,
      aiFraudFlags: Array.isArray(aiFraudFlags) ? aiFraudFlags : [],
      status,
    });
    res.json({ listing: updated });
  })
);
