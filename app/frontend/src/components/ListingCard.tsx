import { Link } from "react-router-dom";
import { lamportsToSol } from "../lib/solana";
import type { Listing } from "../types";
import { FraudBadge } from "./FraudBadge";
import { ListingStatusBadge } from "./ListingStatusBadge";

function categoryLabel(listing: Listing): string {
  if (listing.category === "Property") {
    return listing.listingType === "ToLet" ? "Property · To Let" : "Property · For Sale";
  }
  return "Item · For Sale";
}

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link to={`/listing/${listing.id}`} className="asset-card">
      <div className="asset-card-header">
        <span className="asset-type">{categoryLabel(listing)}</span>
        <ListingStatusBadge status={listing.status} />
      </div>
      <h3>{listing.title}</h3>
      {listing.location !== "N/A" && <p className="asset-location">{listing.location}</p>}
      <div className="asset-stats">
        <div>
          <span className="stat-label">{listing.listingType === "ToLet" ? "Rent" : "Price"}</span>
          <span className="stat-value">£{listing.guidePriceGBP.toLocaleString()}</span>
        </div>
        <div>
          <span className="stat-label">Escrow amount</span>
          <span className="stat-value">{lamportsToSol(listing.priceLamports)} SOL</span>
        </div>
      </div>
      <FraudBadge score={listing.aiFraudScore} />
    </Link>
  );
}
