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

/** Currencies a buyer can pay with. Escrow is always held on-chain in
 * USDC - paying with anything else swaps into USDC in the buyer's own
 * wallet first (see lib/jupiterSwap.ts) before create_order runs. */
export type PaymentCurrency = "USDC" | "USDT" | "SOL" | "SKR";

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
  /** The listing's price in USD - also, at 6 decimals, the USDC amount
   * escrowed on-chain (USDC is pegged 1:1 to the dollar). */
  priceUsd: number;
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
  buyerWallet: string;
  /** USD value of the order (== USDC amount held in escrow). */
  amountUsd: number;
  /** What the buyer actually paid with - only "USDC" reaches escrow
   * directly, anything else was swapped client-side first. */
  paymentCurrency: PaymentCurrency;
  /** Amount paid in `paymentCurrency`'s own units (e.g. SOL, not
   * lamports). */
  paymentAmount: number;
  /** The 2% platform fee (USD) this order incurs once it completes -
   * never charged on a refund/cancellation. */
  feeUsd: number;
  status: OrderStatus;
  disputeReasonUri: string | null;
  disputeMessages: DisputeMessage[];
  createdAt: string;
  /** Present only on results from /api/orders/mine - the caller's
   * relationship to this order. */
  role?: "buyer" | "seller";
}

export interface FraudScreening {
  score: number;
  recommendation: "Approve" | "Flag" | "Reject";
  flags: string[];
  summary: string;
}

export interface PriceSuggestion {
  suggestedPriceUsd: number;
  lowUsd: number;
  highUsd: number;
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
