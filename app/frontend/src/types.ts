// Mirrors app/backend/src/types.ts - kept as a plain duplicate rather than a
// shared package to keep this demo's two npm workspaces independent.

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

export interface RwaAsset {
  id: string;
  onChainAssetId: number | null;
  originator: string | null;
  name: string;
  assetType: AssetType;
  location: string;
  description: string;
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
  score: number;
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
