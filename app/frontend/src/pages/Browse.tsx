import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ListingFilters } from "../api/client";
import { ListingCard } from "../components/ListingCard";
import type { Listing, ListingCategory } from "../types";

const CATEGORY_TABS: { label: string; value: ListingCategory | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Property", value: "Property" },
  { label: "Items", value: "Item" },
];

export function Browse() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<ListingCategory | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Debounce the free-text search so we don't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const filters: ListingFilters = useMemo(
    () => ({
      category,
      q: q.trim() || undefined,
      location: location.trim() || undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    }),
    [category, q, location, minPrice, maxPrice]
  );

  useEffect(() => {
    setListings(null);
    api
      .listListings(filters)
      .then((res) => setListings(res.listings))
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const activeFilterCount = [location, minPrice, maxPrice].filter(Boolean).length;
  const clearAdvancedFilters = () => {
    setLocation("");
    setMinPrice("");
    setMaxPrice("");
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Buy, sell, or let - paid in crypto, held in escrow</h1>
        <p className="subtitle">
          List a property or an item, get paid in SOL. Funds sit in an
          on-chain escrow vault until the buyer confirms they've received it
          - and every new listing is AI-screened for scam signals before it
          goes live.
        </p>
        <Link to="/sell" className="cta-link">
          + List something for sale
        </Link>
      </div>

      <div className="search-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search listings by title or description…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button
          className="secondary-button filter-toggle"
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      <div className="filter-tabs">
        {CATEGORY_TABS.map((f) => (
          <button
            key={f.label}
            className={category === f.value ? "filter-tab active" : "filter-tab"}
            onClick={() => setCategory(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="filters-panel">
          <label>
            Location
            <input
              type="text"
              placeholder="e.g. Manchester"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Min price ($)
            <input
              type="number"
              min={0}
              placeholder="0"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
          </label>
          <label>
            Max price ($)
            <input
              type="number"
              min={0}
              placeholder="Any"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </label>
          {activeFilterCount > 0 && (
            <button className="secondary-button" onClick={clearAdvancedFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {error && <p className="error-banner">Failed to load listings: {error}</p>}
      {!listings && !error && <p>Loading listings…</p>}
      {listings && listings.length === 0 && (
        <p className="muted">No listings match your search - try widening your filters.</p>
      )}

      <div className="asset-grid">
        {listings?.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}
