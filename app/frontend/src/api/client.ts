import type {
  ChatMessage,
  DisputeSummary,
  FraudScreening,
  Listing,
  ListingCategory,
  ListingType,
  Order,
  PriceSuggestion,
} from "../types";
import { clearAdminToken, getAdminToken } from "../lib/adminAuth";
import { clearSession, getSessionToken, type SessionUser } from "../lib/session";

/** In dev, Vite proxies /api/* to the backend (see vite.config.ts). In a
 * static production build, set VITE_API_BASE_URL to the backend's origin. */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(
  path: string,
  init?: RequestInit & { admin?: boolean; auth?: boolean }
): Promise<T> {
  const { admin, auth, ...rest } = init ?? {};
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (admin) {
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (auth) {
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers, ...rest });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A stored token the server rejects is worse than no token - drop it
    // so the relevant gate (AdminGate / sign-in prompt) re-prompts
    // instead of retrying forever.
    if (admin && res.status === 401) clearAdminToken();
    if (auth && res.status === 401) clearSession();
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export interface ListingFilters {
  category?: ListingCategory;
  listingType?: ListingType;
  q?: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
}

function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  listListings: (filters?: ListingFilters) =>
    request<{ listings: Listing[] }>(`/api/listings${buildQuery(filters ?? {})}`),

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
      auth: true,
    }),

  listOrders: (listingId?: string) =>
    request<{ orders: Order[] }>(`/api/orders${listingId ? `?listingId=${listingId}` : ""}`),

  listMyOrders: () => request<{ orders: Order[] }>("/api/orders/mine", { auth: true }),

  getOrder: (id: string) => request<{ order: Order }>(`/api/orders/${id}`),

  createOrder: (listingId: string) =>
    request<{ order: Order }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ listingId }),
      auth: true,
    }),

  confirmReceipt: (orderId: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/confirm-receipt`, { method: "POST", auth: true }),

  cancelOrder: (orderId: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/cancel`, { method: "POST", auth: true }),

  openDispute: (orderId: string, content: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ content }),
      auth: true,
    }),

  addDisputeMessage: (orderId: string, content: string) =>
    request<{ order: Order }>(`/api/orders/${orderId}/dispute/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
      auth: true,
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

  getSignInMessage: (publicKey: string) =>
    request<{ message: string }>("/api/auth/nonce", {
      method: "POST",
      body: JSON.stringify({ publicKey }),
    }),

  verifySignIn: (publicKey: string, signature: string) =>
    request<{ token: string; user: SessionUser }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ publicKey, signature }),
    }),

  updateProfile: (displayName: string | null) =>
    request<{ user: SessionUser }>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
      auth: true,
    }),

  health: () =>
    request<{
      ok: boolean;
      aiConfigured: boolean;
      authConfigured: boolean;
      solana: { programDeployed: boolean; slot: number | null };
    }>("/api/health"),
};
