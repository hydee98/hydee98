export type AssetType =
  | "RealEstate"
  | "Invoice"
  | "Commodity"
  | "PrivateCredit"
  | "Other";

export type AssetStatus =
  | "PendingReview"
  | "Active"
  | "FullyFunded"
  | "Frozen"
  | "Rejected";

/** Off-chain projection of the on-chain `Asset` account, enriched with the
 * descriptive fields an AI model needs (which never fit cheaply on-chain). */
export interface RwaAsset {
  id: string;
  onChainAssetId: number | null;
  /** Base58 pubkey of the on-chain asset's originator/issuer, used together
   * with `onChainAssetId` to derive the asset/vault PDAs client-side. Null
   * until this asset has actually been registered on-chain. */
  originator: string | null;
  name: string;
  assetType: AssetType;
  location: string;
  description: string;
  /** Supporting documents/data points a due-diligence reviewer would use.
   * In production these would be fetched from the `uri` stored on-chain
   * (IPFS/Arweave); here they're inlined for the demo. */
  documents: string[];
  valuationUsd: number;
  totalShares: number;
  sharesSold: number;
  pricePerShareLamports: number;
  status: AssetStatus;
  aiRiskScore: number | null;
  mint: string | null;
  createdAt: string;
}

export interface RiskAssessment {
  score: number; // 0-100, higher = riskier
  rating: "Low" | "Medium" | "High" | "Critical";
  factors: string[];
  summary: string;
}

export interface ValuationEstimate {
  estimatedValueUsd: number;
  lowUsd: number;
  highUsd: number;
  reasoning: string;
}

export interface DueDiligenceReport {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendation: "Approve" | "ApproveWithConditions" | "Reject";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
