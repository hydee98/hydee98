import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SignInGate } from "../components/SignInGate";
import { compressImageFile } from "../lib/imageCompress";
import type { ListingCategory, ListingType } from "../types";

const MAX_IMAGES = 6;

export function CreateListing() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<ListingCategory>("Item");
  const [listingType, setListingType] = useState<ListingType>("ForSale");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [priceUsd, setPriceUsd] = useState(100);
  const [images, setImages] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCategoryChange = (next: ListingCategory) => {
    setCategory(next);
    if (next === "Item") setListingType("ForSale");
  };

  const onFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const remaining = MAX_IMAGES - images.length;
    const files = Array.from(fileList).slice(0, remaining);
    setCompressing(true);
    try {
      const compressed = await Promise.all(files.map((f) => compressImageFile(f)));
      setImages((prev) => [...prev, ...compressed]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process one or more images");
    } finally {
      setCompressing(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async () => {
    setError(null);
    if (!title.trim() || !description.trim() || priceUsd <= 0) {
      setError("Please fill in a title, description, and a price greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const { listing } = await api.createListing({
        title: title.trim(),
        category,
        listingType,
        location: category === "Property" ? location.trim() || "N/A" : "N/A",
        description: description.trim(),
        images,
        priceUsd,
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

      <SignInGate prompt="Sign in with your wallet to list something - you'll be the listing's seller.">
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
            Price (USD)
            <input
              type="number"
              min={1}
              value={priceUsd}
              onChange={(e) => setPriceUsd(Math.max(0, Number(e.target.value)))}
            />
          </label>
          <p className="muted">
            Escrowed on-chain in USDC at this exact dollar value. Buyers can pay with USDC, USDT, SOL, or
            (once launched) SKR - their wallet converts to USDC automatically before funding escrow.
          </p>

          <label>
            Photos ({images.length}/{MAX_IMAGES})
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={images.length >= MAX_IMAGES || compressing}
              onChange={(e) => {
                onFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {compressing && <p className="muted">Processing photos…</p>}
          {images.length > 0 && (
            <div className="photo-preview-grid">
              {images.map((src, i) => (
                <div key={i} className="photo-preview">
                  <img src={src} alt={`Upload ${i + 1}`} />
                  <button type="button" className="photo-remove" onClick={() => removeImage(i)} aria-label="Remove photo">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="error-banner">{error}</p>}

          <button onClick={submit} disabled={busy || compressing}>
            {busy ? "Creating…" : "Create listing"}
          </button>
        </section>
      </SignInGate>
    </div>
  );
}
