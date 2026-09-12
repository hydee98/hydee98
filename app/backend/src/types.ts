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
 * USDC (see programs/escrow_marketplace) - paying with anything else
 * means the buyer's own wallet swaps into USDC first (e.g. via Jupiter)
 * before the order is funded, so the backend and program never custody a
 * non-USDC balance. See services/pricingService.ts. */
export type PaymentCurrency = "USDC" | "USDT" | "SOL" | "SKR";

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
  /** The listing's price in USD - the canonical price tag shown in the
   * UI, and (at 6 decimals, USDC base units) exactly the `price_usdc`
   * passed to the on-chain `create_listing` instruction. USDC is pegged
   * 1:1 to the US dollar, so one number serves both purposes. */
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

/** Off-chain projection of the on-chain `Order` (escrow) account. */
export interface Order {
  id: string;
  onChainOrderId: number | null;
  listingId: string;
  /** Base58 pubkey of the buyer's wallet - the authenticated identity that
   * created this order (see requireAuth). */
  buyerWallet: string;
  /** USD value of the order - equal to the listing's priceUsd at the time
   * of purchase, and (at 6 decimals) the USDC amount actually held in the
   * on-chain escrow vault. */
  amountUsd: number;
  /** What the buyer actually paid with. Only "USDC" ever reaches the
   * on-chain escrow directly - anything else means the buyer's wallet
   * swapped into USDC client-side first (see lib/jupiterSwap.ts on the
   * frontend); this field records their original choice for the receipt/
   * order history UI. */
  paymentCurrency: PaymentCurrency;
  /** Amount paid in `paymentCurrency`'s own units (e.g. SOL, not
   * lamports) - a mock-rate conversion of amountUsd until SKR launches
   * and/or a live swap-quote feed is wired in. See pricingService.ts. */
  paymentAmount: number;
  /** The 2% platform fee (in USD) this order will incur - deducted from
   * the seller's payout only once the order actually completes
   * (confirm_receipt or a paying-out dispute resolution), never on a
   * refund/cancellation. Routed to the treasury wallet for buyback/
   * reward distribution. Informational here; the real deduction happens
   * on-chain in the Anchor program. */
  feeUsd: number;
  status: OrderStatus;
  disputeReasonUri: string | null;
  disputeMessages: DisputeMessage[];
  createdAt: string;
}

/** A real account, identified by wallet - not username/password. Created
 * (or touched) the first time a wallet completes sign-in. */
export interface User {
  publicKey: string;
  displayName: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface FraudScreening {
  score: number; // 0-100, higher = more likely fraudulent
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
  /** Meaningful only when suggestedResolution is "Split" - seller's share, 0-100. */
  suggestedSellerSharePct: number;
  reasoning: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
