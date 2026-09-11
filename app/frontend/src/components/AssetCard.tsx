import { Link } from "react-router-dom";
import { lamportsToSol } from "../lib/solana";
import type { RwaAsset } from "../types";
import { RiskBadge } from "./RiskBadge";
import { StatusBadge } from "./StatusBadge";

const TYPE_LABELS: Record<RwaAsset["assetType"], string> = {
  RealEstate: "Real Estate",
  Invoice: "Invoice Financing",
  Commodity: "Commodity / Energy",
  PrivateCredit: "Private Credit",
  Other: "Other",
};

export function AssetCard({ asset }: { asset: RwaAsset }) {
  const pctFunded = Math.round((asset.sharesSold / asset.totalShares) * 100);

  return (
    <Link to={`/asset/${asset.id}`} className="asset-card">
      <div className="asset-card-header">
        <span className="asset-type">{TYPE_LABELS[asset.assetType]}</span>
        <StatusBadge status={asset.status} />
      </div>
      <h3>{asset.name}</h3>
      <p className="asset-location">{asset.location}</p>
      <div className="asset-stats">
        <div>
          <span className="stat-label">Valuation</span>
          <span className="stat-value">${asset.valuationUsd.toLocaleString()}</span>
        </div>
        <div>
          <span className="stat-label">Price / share</span>
          <span className="stat-value">
            {lamportsToSol(asset.pricePerShareLamports)} SOL
          </span>
        </div>
      </div>
      <div className="funding-bar">
        <div className="funding-bar-fill" style={{ width: `${pctFunded}%` }} />
      </div>
      <p className="funding-caption">
        {asset.sharesSold.toLocaleString()} / {asset.totalShares.toLocaleString()} shares
        funded ({pctFunded}%)
      </p>
      <RiskBadge score={asset.aiRiskScore} />
    </Link>
  );
}
