// Mirrors app/backend/src/types.ts - kept as a plain duplicate rather than a
// shared package to keep this demo's two npm workspaces independent.

export type ListingCategory = "Property" | "Item";
export type ListingType = "ForSale" | "ToLet";
export type ListingStatus =
  | "PendingReview"
  | "Active"
  | "Flagged"
  | "UnderOffer"
  | "Sold"
  | "Removed";
export type OrderStatus = "Funded" | "Released" | "Disputed" | "Resolved" | "Cancelled";

export interface Listing {
  id: string;
  onChainListingId: number | null;
  seller: string | null;
  category: ListingCategory;
  listingType: ListingType;
  title: string;
  description: string;
  location: string;
  images: string[];
  priceLamports: number;
  guidePriceGBP: number;
  status: ListingStatus;
  aiFraudScore: number | null;
  aiFraudFlags: string[];
  createdAt: string;
}

export interface DisputeMessage {
  author: "buyer" | "seller";
  content: string;
  createdAt: string;
}

export interface Order {
  id: string;
  onChainOrderId: number | null;
  listingId: string;
  buyerName: string;
  amountLamports: number;
  status: OrderStatus;
  disputeReasonUri: string | null;
  disputeMessages: DisputeMessage[];
  createdAt: string;
}

export interface FraudScreening {
  score: number;
  recommendation: "Approve" | "Flag" | "Reject";
  flags: string[];
  summary: string;
}

export interface PriceSuggestion {
  suggestedPriceGBP: number;
  lowGBP: number;
  highGBP: number;
  reasoning: string;
}

export type DisputeResolutionSuggestion = "ReleaseToSeller" | "RefundBuyer" | "Split";

export interface DisputeSummary {
  summary: string;
  buyerClaim: string;
  sellerClaim: string;
  suggestedResolution: DisputeResolutionSuggestion;
  suggestedSellerSharePct: number;
  reasoning: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
