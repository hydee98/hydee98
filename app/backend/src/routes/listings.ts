import { Router } from "express";
import { createListing, getListing, listListings, updateListing } from "../data/listings.js";
import type { ListingCategory, ListingType } from "../types.js";

export const listingsRouter = Router();

listingsRouter.get("/", (req, res) => {
  const { category } = req.query;
  const all = listListings();
  const filtered =
    typeof category === "string" && category
      ? all.filter((l) => l.category === category)
      : all;
  res.json({ listings: filtered });
});

listingsRouter.get("/:id", (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  res.json({ listing });
});

const VALID_CATEGORIES: ListingCategory[] = ["Property", "Item"];
const VALID_TYPES: ListingType[] = ["ForSale", "ToLet"];

/** Demo listing endpoint - a production version would only accept this
 * after basic seller verification, and the on-chain `create_listing`
 * instruction is what actually creates the listing PDA (see the Anchor
 * program). This lets the frontend demo the full lifecycle without a
 * deployed program. */
listingsRouter.post("/", (req, res) => {
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

  const listing = createListing({
    title: title.trim(),
    category,
    listingType,
    location: typeof location === "string" ? location : "N/A",
    description: typeof description === "string" ? description : "",
    images: Array.isArray(images) ? images.filter((i) => typeof i === "string") : [],
    priceLamports,
    guidePriceGBP,
  });

  res.status(201).json({ listing });
});

/** Applies the outcome of `POST /api/ai/listings/:id/fraud-screen` to a
 * listing, mirroring what the platform authority would relay on-chain via
 * `review_listing`. */
listingsRouter.post("/:id/review", (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const { aiFraudScore, aiFraudFlags } = req.body ?? {};
  if (typeof aiFraudScore !== "number" || aiFraudScore < 0 || aiFraudScore > 100) {
    return res.status(400).json({ error: "aiFraudScore must be a number between 0 and 100" });
  }

  const status = aiFraudScore <= 60 ? "Active" : "Flagged";
  const updated = updateListing(req.params.id, {
    aiFraudScore,
    aiFraudFlags: Array.isArray(aiFraudFlags) ? aiFraudFlags : [],
    status,
  });
  res.json({ listing: updated });
});
