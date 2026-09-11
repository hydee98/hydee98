import type {
  ChatMessage,
  DisputeSummary,
  FraudScreening,
  Listing,
  ListingCategory,
  Order,
  PriceSuggestion,
} from "../types";
import { clearAdminToken, getAdminToken } from "../lib/adminAuth";

/** In dev, Vite proxies /api/* to the backend (see vite.config.ts). In a
 * static production build, set VITE_API_BASE_URL to the backend's origin. */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(
  path: string,
  init?: RequestInit & { admin?: boolean }
): Promise<T> {
  const { admin, ...rest } = init ?? {};
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (admin) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers, ...rest });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A stored admin token that the server rejects is worse than no token -
    // drop it so AdminGate re-prompts instead of retrying forever.
    if (admin && res.status === 401) clearAdminToken();
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export const api = {
  listListings: (category?: ListingCategory) =>
    request<{ listings: Listing[] }>(`/api/listings${category ? `?category=${category}` : ""}`),

  getListing: (id: string) => request<{ listing: Listing }>(`/api/listings/${id}`),

  createListing: (input: {
    title: string;
    category: ListingCategory;
    listingType: Listing["listingType"];
    location: string;
    description: string;
    images: string[];
    priceLamports: number;
    guidePriceGBP: number;
  }) =>
    request<{ listing: Listing }>("/api/listings", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listOrders: (listingId?: string) =>
    request<{ orders: Order[] }>(`/api/orders${listingId ? `?listingId=${listingId}` : ""}`),

  getOrder: (id: string) => request<{ order: Order }>(`/api/orders/${id}`),

  createOrder: (listingId: string, buyerName: string) =>
    request<{ order: Order }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ listingId, buyerName }),
    }),

  confirmReceipt: (orderId: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/confirm-receipt`, { method: "POST" }),

  cancelOrder: (orderId: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/cancel`, { method: "POST" }),

  openDispute: (orderId: string, author: "buyer" | "seller", content: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ author, content }),
    }),

  addDisputeMessage: (orderId: string, author: "buyer" | "seller", content: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/dispute/messages`, {
      method: "POST",
      body: JSON.stringify({ author, content }),
    }),

  resolveDispute: (orderId: string, resolution: "ReleaseToSeller" | "RefundBuyer" | "Split") =>
    request<{ order: Order }>(`/api/orders/${orderId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
      admin: true,
    }),

  reviewListing: (listingId: string, aiFraudScore: number, aiFraudFlags: string[]) =>
    request<{ listing: Listing }>(`/api/listings/${listingId}/review`, {
      method: "POST",
      body: JSON.stringify({ aiFraudScore, aiFraudFlags }),
      admin: true,
    }),

  getFraudScreening: (listingId: string) =>
    request<{ screening: FraudScreening }>(`/api/ai/listings/${listingId}/fraud-screen`, {
      method: "POST",
    }),

  getPriceSuggestion: (listingId: string) =>
    request<{ suggestion: PriceSuggestion }>(`/api/ai/listings/${listingId}/price-suggestion`, {
      method: "POST",
    }),

  askListingQuestion: (listingId: string, question: string, history: ChatMessage[]) =>
    request<{ answer: string }>(`/api/ai/listings/${listingId}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),

  getDisputeSummary: (orderId: string) =>
    request<{ summary: DisputeSummary }>(`/api/ai/orders/${orderId}/dispute-summary`, {
      method: "POST",
      admin: true,
    }),

  health: () =>
    request<{
      ok: boolean;
      aiConfigured: boolean;
      solana: { programDeployed: boolean; slot: number | null };
    }>("/api/health"),
};
