import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ListingCategory, ListingType } from "../types";

export function CreateListing() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<ListingCategory>("Item");
  const [listingType, setListingType] = useState<ListingType>("ForSale");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [guidePriceGBP, setGuidePriceGBP] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCategoryChange = (next: ListingCategory) => {
    setCategory(next);
    if (next === "Item") setListingType("ForSale");
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || !description.trim() || guidePriceGBP <= 0) {
      setError("Please fill in a title, description, and a price greater than zero.");
      return;
    }
    setBusy(true);
    try {
      // Demo-only nominal GBP -> lamports conversion so the escrow amount
      // scales with the guide price. A real deployment would let the
      // seller quote directly in SOL/a stablecoin, or use a live price feed.
      const priceLamports = Math.round(guidePriceGBP * 10_000_000);
      const { listing } = await api.createListing({
        title: title.trim(),
        category,
        listingType,
        location: category === "Property" ? location.trim() || "N/A" : "N/A",
        description: description.trim(),
        images: [],
        priceLamports,
        guidePriceGBP,
      });
      navigate(`/listing/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create listing");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>List something for sale</h1>
      <p className="subtitle">
        New listings start Pending Review - run the AI fraud screen on the
        listing page and apply its score to activate it, just like{" "}
        <code>review_listing</code> does on-chain.
      </p>

      <section className="panel form-panel">
        <label>
          Category
          <select value={category} onChange={(e) => onCategoryChange(e.target.value as ListingCategory)}>
            <option value="Item">Item</option>
            <option value="Property">Property</option>
          </select>
        </label>

        {category === "Property" && (
          <label>
            Listing type
            <select value={listingType} onChange={(e) => setListingType(e.target.value as ListingType)}>
              <option value="ForSale">For sale</option>
              <option value="ToLet">To let</option>
            </select>
          </label>
        )}

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mountain bike, full suspension" />
        </label>

        {category === "Property" && (
          <label>
            Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Manchester, M21" />
          </label>
        )}

        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe the condition, features, and anything a buyer should know…"
          />
        </label>

        <label>
          Guide price (£)
          <input
            type="number"
            min={1}
            value={guidePriceGBP}
            onChange={(e) => setGuidePriceGBP(Math.max(0, Number(e.target.value)))}
          />
        </label>

        {error && <p className="error-banner">{error}</p>}

        <button onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create listing"}
        </button>
      </section>
    </div>
  );
}
