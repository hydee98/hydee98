import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  DueDiligenceReport,
  RiskAssessment,
  RwaAsset,
  ValuationEstimate,
} from "../types.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiServiceError(
      "AI features are not configured: set ANTHROPIC_API_KEY in app/backend/.env"
    );
  }
  if (!client) client = new Anthropic();
  return client;
}

/** Thrown when the AI layer can't be reached (missing/invalid credentials,
 * rate limiting, etc). Routes translate this into a clean HTTP response
 * instead of a stack trace. */
export class AiServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AiServiceError";
  }
}

function describeAsset(asset: RwaAsset): string {
  return [
    `Name: ${asset.name}`,
    `Type: ${asset.assetType}`,
    `Location: ${asset.location}`,
    `Stated valuation: $${asset.valuationUsd.toLocaleString()}`,
    `Total shares: ${asset.totalShares} (sold: ${asset.sharesSold})`,
    `Status: ${asset.status}`,
    `Description: ${asset.description}`,
    `Supporting documents / data points:`,
    ...asset.documents.map((d) => `  - ${d}`),
  ].join("\n");
}

/** Pull the first JSON object out of a model response, tolerating markdown
 * code fences and any leading/trailing prose. */
function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new AiServiceError("AI response did not contain a JSON object");
  }
  const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonSlice) as T;
  } catch (err) {
    throw new AiServiceError("Failed to parse AI response as JSON", err);
  }
}

async function callClaude(system: string, userPrompt: string, maxTokens = 2000): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: userPrompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new AiServiceError("The model declined to answer this request.");
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new AiServiceError("AI response contained no text content");
    }
    return text.text;
  } catch (err) {
    if (err instanceof AiServiceError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiServiceError(
        "AI features are not configured: set ANTHROPIC_API_KEY in app/backend/.env",
        err
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiServiceError("AI service is rate-limited, try again shortly", err);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiServiceError(`AI service error: ${err.message}`, err);
    }
    throw new AiServiceError("Unexpected error calling the AI service", err);
  }
}

const RISK_SYSTEM_PROMPT = `You are a risk analyst for a real-world-asset (RWA) tokenization platform. \
Given an asset's description and supporting documents, assess the investment risk of tokenizing and \
offering fractional shares of it to retail investors. Consider: valuation credibility, documentation \
completeness, counterparty/debtor/tenant quality, legal/title clarity, liquidity of the underlying \
asset, and concentration risk. Be skeptical of thin or stale documentation - flag it. Respond with ONLY \
a JSON object, no other text, matching exactly this shape:
{"score": <integer 0-100, higher = riskier>, "rating": "Low"|"Medium"|"High"|"Critical", "factors": [<3-6 short strings, each one concrete risk or strength driving the score>], "summary": "<2-3 sentence plain-English summary for an investor>"}`;

export async function assessRisk(asset: RwaAsset): Promise<RiskAssessment> {
  const text = await callClaude(
    RISK_SYSTEM_PROMPT,
    `Assess this asset:\n\n${describeAsset(asset)}`
  );
  const parsed = extractJson<RiskAssessment>(text);
  parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  return parsed;
}

const VALUATION_SYSTEM_PROMPT = `You are a valuation analyst for a real-world-asset (RWA) tokenization \
platform. Given an asset's stated valuation, description, and supporting documents, sanity-check the \
stated figure and produce an independent estimate range. You are not a licensed appraiser and have no \
market data beyond what's given - be explicit about that limitation in your reasoning, and be \
conservative when documentation is thin or stale. Respond with ONLY a JSON object, no other text, \
matching exactly this shape:
{"estimatedValueUsd": <integer, your point estimate>, "lowUsd": <integer>, "highUsd": <integer>, "reasoning": "<3-5 sentences explaining the estimate and calling out any red flags in the documentation>"}`;

export async function estimateValuation(asset: RwaAsset): Promise<ValuationEstimate> {
  const text = await callClaude(
    VALUATION_SYSTEM_PROMPT,
    `Sanity-check the valuation of this asset:\n\n${describeAsset(asset)}`
  );
  return extractJson<ValuationEstimate>(text);
}

const DUE_DILIGENCE_SYSTEM_PROMPT = `You are a due-diligence analyst preparing an investor-facing report \
for a real-world-asset (RWA) tokenization platform. Given an asset's description and supporting \
documents, write a concise due-diligence report. Respond with ONLY a JSON object, no other text, \
matching exactly this shape:
{"summary": "<2-4 sentence overview>", "strengths": [<2-5 short strings>], "risks": [<2-5 short strings>], "recommendation": "Approve"|"ApproveWithConditions"|"Reject"}`;

export async function generateDueDiligence(asset: RwaAsset): Promise<DueDiligenceReport> {
  const text = await callClaude(
    DUE_DILIGENCE_SYSTEM_PROMPT,
    `Prepare a due-diligence report for this asset:\n\n${describeAsset(asset)}`
  );
  return extractJson<DueDiligenceReport>(text);
}

const CHAT_SYSTEM_PROMPT = `You are an investor-support assistant for a real-world-asset (RWA) \
tokenization platform. Answer questions ONLY about the specific asset described below, using only the \
information given - do not invent facts, financial guarantees, or legal/tax/investment advice. If asked \
something the provided information can't answer, say so plainly and suggest what document or step would \
resolve it. Keep answers concise (under ~120 words) and in plain English. Always include a brief \
reminder that this is not financial advice when the question concerns whether to invest.

Asset details:
`;

export async function answerAssetQuestion(
  asset: RwaAsset,
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const system = CHAT_SYSTEM_PROMPT + describeAsset(asset);
  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
      { role: "user", content: question },
    ];
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 800,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages,
    });

    if (response.stop_reason === "refusal") {
      return "I'm not able to answer that question about this asset.";
    }
    const text = response.content.find((b) => b.type === "text");
    return text && text.type === "text"
      ? text.text
      : "I couldn't generate a response - please try rephrasing your question.";
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AiServiceError(
        "AI features are not configured: set ANTHROPIC_API_KEY in app/backend/.env",
        err
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiServiceError("AI service is rate-limited, try again shortly", err);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiServiceError(`AI service error: ${err.message}`, err);
    }
    throw new AiServiceError("Unexpected error calling the AI service", err);
  }
}
