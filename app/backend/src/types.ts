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

/** Off-chain projection of the on-chain `Listing` account, enriched with the
 * descriptive fields an AI model needs (full description, photos) that
 * never fit cheaply on-chain. */
export interface Listing {
  id: string;
  onChainListingId: number | null;
  /** Base58 pubkey of the seller's wallet, once this listing has actually
   * been created on-chain via `create_listing`. Null for demo listings. */
  seller: string | null;
  category: ListingCategory;
  listingType: ListingType;
  title: string;
  description: string;
  /** Postcode/area for Property; "N/A" for a general Item. */
  location: string;
  images: string[];
  priceLamports: number;
  /** Display-only guide price in GBP - independent of any live SOL/GBP
   * exchange rate, purely so the listing reads like a real Zoopla/eBay
   * price tag in the UI. */
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

/** Off-chain projection of the on-chain `Order` (escrow) account. */
export interface Order {
  id: string;
  onChainOrderId: number | null;
  listingId: string;
  /** Display name/handle for the demo - a real deployment keys this off
   * the buyer's wallet pubkey instead. */
  buyerName: string;
  amountLamports: number;
  status: OrderStatus;
  disputeReasonUri: string | null;
  disputeMessages: DisputeMessage[];
  createdAt: string;
}

export interface FraudScreening {
  score: number; // 0-100, higher = more likely fraudulent
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
  /** Meaningful only when suggestedResolution is "Split" - seller's share, 0-100. */
  suggestedSellerSharePct: number;
  reasoning: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
