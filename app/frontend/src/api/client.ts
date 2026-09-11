import type {
  ChatMessage,
  DueDiligenceReport,
  RiskAssessment,
  RwaAsset,
  ValuationEstimate,
} from "../types";

/** In dev, Vite proxies /api/* to the backend (see vite.config.ts). In a
 * static production build, set VITE_API_BASE_URL to the backend's origin. */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return body as T;
}

export const api = {
  listAssets: () => request<{ assets: RwaAsset[] }>("/api/assets"),

  getAsset: (id: string) => request<{ asset: RwaAsset }>(`/api/assets/${id}`),

  getRiskScore: (id: string) =>
    request<{ assessment: RiskAssessment }>(`/api/ai/assets/${id}/risk-score`, {
      method: "POST",
    }),

  getValuation: (id: string) =>
    request<{ valuation: ValuationEstimate }>(`/api/ai/assets/${id}/valuation`, {
      method: "POST",
    }),

  getDueDiligence: (id: string) =>
    request<{ report: DueDiligenceReport }>(`/api/ai/assets/${id}/due-diligence`, {
      method: "POST",
    }),

  askQuestion: (id: string, question: string, history: ChatMessage[]) =>
    request<{ answer: string }>(`/api/ai/assets/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),

  health: () =>
    request<{
      ok: boolean;
      aiConfigured: boolean;
      solana: { programDeployed: boolean; slot: number | null };
    }>("/api/health"),
};
