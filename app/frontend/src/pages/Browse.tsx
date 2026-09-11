import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { ListingCard } from "../components/ListingCard";
import type { Listing, ListingCategory } from "../types";

const FILTERS: { label: string; value: ListingCategory | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Property", value: "Property" },
  { label: "Items", value: "Item" },
];

export function Browse() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListingCategory | undefined>(undefined);

  useEffect(() => {
    setListings(null);
    api
      .listListings(filter)
      .then((res) => setListings(res.listings))
      .catch((err) => setError(err.message));
  }, [filter]);

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

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={filter === f.value ? "filter-tab active" : "filter-tab"}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="error-banner">Failed to load listings: {error}</p>}
      {!listings && !error && <p>Loading listings…</p>}

      <div className="asset-grid">
        {listings?.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}
