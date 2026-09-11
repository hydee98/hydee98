import { useEffect, useState } from "react";
import { api } from "../api/client";
import { AssetCard } from "../components/AssetCard";
import type { RwaAsset } from "../types";

export function Marketplace() {
  const [assets, setAssets] = useState<RwaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAssets()
      .then((res) => setAssets(res.assets))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tokenized Real World Assets</h1>
        <p className="subtitle">
          Browse fractional-ownership offerings across real estate, invoice
          pools, commodities, and private credit - each with an AI-generated
          risk score and due-diligence report.
        </p>
      </div>

      {error && <p className="error-banner">Failed to load assets: {error}</p>}
      {!assets && !error && <p>Loading assets…</p>}

      <div className="asset-grid">
        {assets?.map((asset) => (
          <AssetCard key={asset.id} asset={asset} />
        ))}
      </div>
    </div>
  );
}
