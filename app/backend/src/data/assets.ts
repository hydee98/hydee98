import type { RwaAsset } from "../types.js";

/**
 * In-memory demo asset store. A real deployment would read the canonical
 * asset list from the on-chain `Asset` accounts (see solanaService.ts) and
 * keep this only as an off-chain metadata cache (descriptions, documents)
 * keyed by the same id. Swap this module for a database without touching
 * the routes.
 */
const assets = new Map<string, RwaAsset>();

function seed() {
  const demo: RwaAsset[] = [
    {
      id: "asset-1",
      onChainAssetId: 0,
      originator: null,
      name: "Maple Street Duplex",
      assetType: "RealEstate",
      location: "Austin, TX, USA",
      description:
        "A fully-leased duplex in a growing Austin suburb. Both units are occupied under 12-month leases at $1,850/mo each. Built 2015, no deferred maintenance identified in the latest inspection.",
      documents: [
        "2024 third-party appraisal: $258,000",
        "Title report: clean, no liens",
        "Two active leases (12-month terms, both tenants >2 years tenure)",
        "Property inspection report (2024): no material defects",
        "Flood zone: X (minimal risk) per FEMA map",
      ],
      valuationUsd: 250_000,
      totalShares: 1000,
      sharesSold: 240,
      pricePerShareLamports: 100_000_000, // 0.1 SOL demo pricing
      status: "Active",
      aiRiskScore: 28,
      mint: null,
      createdAt: "2026-06-01T12:00:00.000Z",
    },
    {
      id: "asset-2",
      onChainAssetId: 1,
      originator: null,
      name: "Northgate Logistics - Invoice Pool #14",
      assetType: "Invoice",
      location: "Rotterdam, Netherlands",
      description:
        "A pool of 22 outstanding B2B invoices from a mid-size freight forwarder to five distinct corporate debtors, average tenor 45 days, weighted average debtor credit rating BBB.",
      documents: [
        "Invoice pool schedule (22 invoices, face value $612,400)",
        "Debtor concentration: largest single debtor is 31% of pool",
        "Historical default rate for originator's prior pools: 1.2%",
        "Credit insurance covering 80% of face value",
      ],
      valuationUsd: 612_400,
      totalShares: 5000,
      sharesSold: 5000,
      pricePerShareLamports: 25_000_000,
      status: "FullyFunded",
      aiRiskScore: 41,
      mint: null,
      createdAt: "2026-05-12T09:30:00.000Z",
    },
    {
      id: "asset-3",
      onChainAssetId: 2,
      originator: null,
      name: "Sonoran Solar Farm Offtake Rights",
      assetType: "Commodity",
      location: "Pima County, AZ, USA",
      description:
        "Tokenized rights to a 5-year fixed-price power purchase agreement (PPA) offtake stream from a 40MW solar farm. Counterparty is an investment-grade regional utility.",
      documents: [
        "Executed PPA (5-year term, fixed $/MWh)",
        "Counterparty credit rating: A- (S&P)",
        "Independent engineer production estimate (P50/P90)",
        "No environmental liens on record",
      ],
      valuationUsd: 1_450_000,
      totalShares: 10000,
      sharesSold: 1200,
      pricePerShareLamports: 15_000_000,
      status: "Active",
      aiRiskScore: 35,
      mint: null,
      createdAt: "2026-04-20T15:45:00.000Z",
    },
    {
      id: "asset-4",
      onChainAssetId: 3,
      originator: null,
      name: "Riverside Bridge Loan",
      assetType: "PrivateCredit",
      location: "Miami, FL, USA",
      description:
        "A 9-month bridge loan secured by a second-lien position on a partially-renovated mixed-use property. Borrower has missed one prior interest payment on an unrelated facility. Exit relies on refinancing that has not yet been committed.",
      documents: [
        "Loan agreement, second-lien, 9-month term",
        "Borrower payment history: one late payment (unrelated facility, cured)",
        "Exit strategy: refinance - term sheet not yet signed",
        "Appraisal is 14 months old (stale relative to renovation progress)",
      ],
      valuationUsd: 380_000,
      totalShares: 2000,
      sharesSold: 0,
      pricePerShareLamports: 10_000_000,
      status: "PendingReview",
      aiRiskScore: null,
      mint: null,
      createdAt: "2026-07-02T08:00:00.000Z",
    },
  ];

  for (const asset of demo) assets.set(asset.id, asset);
}
seed();

export function listAssets(): RwaAsset[] {
  return Array.from(assets.values());
}

export function getAsset(id: string): RwaAsset | undefined {
  return assets.get(id);
}

export function createAsset(
  input: Omit<RwaAsset, "id" | "createdAt" | "status" | "aiRiskScore" | "sharesSold">
): RwaAsset {
  const id = `asset-${assets.size + 1}-${Date.now().toString(36)}`;
  const asset: RwaAsset = {
    ...input,
    id,
    sharesSold: 0,
    status: "PendingReview",
    aiRiskScore: null,
    createdAt: new Date().toISOString(),
  };
  assets.set(id, asset);
  return asset;
}

export function updateAsset(
  id: string,
  patch: Partial<RwaAsset>
): RwaAsset | undefined {
  const existing = assets.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  assets.set(id, updated);
  return updated;
}
