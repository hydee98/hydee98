import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  DisputeSummary,
  FraudScreening,
  Listing,
  Order,
  PriceSuggestion,
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

function describeListing(listing: Listing): string {
  return [
    `Title: ${listing.title}`,
    `Category: ${listing.category}${listing.category === "Property" ? ` (${listing.listingType === "ToLet" ? "to let" : "for sale"})` : ""}`,
    `Location: ${listing.location}`,
    `Guide price: £${listing.guidePriceGBP.toLocaleString()}`,
    `Description: ${listing.description}`,
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

async function callClaude(system: string, userPrompt: string, maxTokens = 1500): Promise<string> {
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

const FRAUD_SYSTEM_PROMPT = `You are a trust & safety analyst for a peer-to-peer marketplace (like eBay/Zoopla) \
where buyers pay in crypto held in on-chain escrow until they confirm receipt. Given a new listing, screen it \
for fraud/scam signals: pressure tactics ("must sell today"), discouraging platform escrow or pushing \
off-platform payment/contact, prices far below plausible market value, vague or copy-pasted-sounding \
descriptions, missing details a genuine seller would naturally include, and (for property) red flags like \
"landlord abroad, wire deposit before viewing". Being cheap or brief is not by itself suspicious - look for \
actual manipulation or evasion patterns. Respond with ONLY a JSON object, no other text, matching exactly \
this shape:
{"score": <integer 0-100, higher = more likely fraudulent>, "recommendation": "Approve"|"Flag"|"Reject", "flags": [<0-6 short strings, each one concrete signal you found - empty array if none>], "summary": "<2-3 sentence plain-English summary for a moderator>"}`;

export async function screenListingForFraud(listing: Listing): Promise<FraudScreening> {
  const text = await callClaude(
    FRAUD_SYSTEM_PROMPT,
    `Screen this listing:\n\n${describeListing(listing)}`
  );
  const parsed = extractJson<FraudScreening>(text);
  parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  return parsed;
}

const PRICE_SYSTEM_PROMPT = `You are a pricing analyst for a peer-to-peer marketplace. Given a listing's \
category, description, and the seller's own guide price, suggest a fair asking price range in GBP based on \
general market knowledge for this kind of property/item. You have no live market data feed - be explicit \
about that limitation, and be conservative when the description lacks details that matter for pricing \
(condition, exact spec, location detail). Respond with ONLY a JSON object, no other text, matching exactly \
this shape:
{"suggestedPriceGBP": <integer, your point estimate>, "lowGBP": <integer>, "highGBP": <integer>, "reasoning": "<3-5 sentences explaining the estimate, noting how it compares to the seller's guide price and any missing details that limit confidence>"}`;

export async function suggestPrice(listing: Listing): Promise<PriceSuggestion> {
  const text = await callClaude(
    PRICE_SYSTEM_PROMPT,
    `Suggest a fair price for this listing:\n\n${describeListing(listing)}`
  );
  return extractJson<PriceSuggestion>(text);
}

const CHAT_SYSTEM_PROMPT = `You are a buyer-support assistant for a peer-to-peer marketplace. Answer \
questions ONLY about the specific listing described below, using only the information given - do not \
invent facts, condition details, or guarantees the seller hasn't stated. If asked something the listing \
doesn't cover, say so plainly and suggest the buyer message the seller directly to ask. Keep answers \
concise (under ~100 words) and in plain English. Remind the buyer that payment is held in escrow and only \
released once they confirm receipt, if that's relevant to their question.

Listing details:
`;

export async function answerListingQuestion(
  listing: Listing,
  question: string,
  history: ChatMessage[] = []
): Promise<string> {
  const system = CHAT_SYSTEM_PROMPT + describeListing(listing);
  try {
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
      { role: "user", content: question },
    ];
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 700,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages,
    });

    if (response.stop_reason === "refusal") {
      return "I'm not able to answer that question about this listing.";
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

const DISPUTE_SYSTEM_PROMPT = `You are a dispute-resolution assistant for a peer-to-peer marketplace \
where payment is held in on-chain escrow until the buyer confirms receipt. A dispute has been opened over \
an order; you're given the listing, the order amount, and the back-and-forth messages both sides have \
posted as evidence. Summarize both sides fairly and suggest a resolution for the human arbitrator who \
makes the final call - you are not making the final decision yourself, only briefing them. Be even-handed: \
do not assume either party is lying without evidence in the messages themselves. Respond with ONLY a JSON \
object, no other text, matching exactly this shape:
{"summary": "<2-3 sentence neutral overview of the dispute>", "buyerClaim": "<1-2 sentence summary of the buyer's position>", "sellerClaim": "<1-2 sentence summary of the seller's position>", "suggestedResolution": "ReleaseToSeller"|"RefundBuyer"|"Split", "suggestedSellerSharePct": <integer 0-100, only meaningful when suggestedResolution is "Split", otherwise 0 or 100 matching the resolution>, "reasoning": "<3-5 sentences explaining the recommendation and what evidence (or lack of it) drove it>"}`;

export async function summarizeDispute(
  listing: Listing,
  order: Order
): Promise<DisputeSummary> {
  const messagesBlock = order.disputeMessages.length
    ? order.disputeMessages
        .map((m) => `[${m.author.toUpperCase()} @ ${m.createdAt}]: ${m.content}`)
        .join("\n")
    : "(no messages submitted yet)";

  const prompt = [
    `Listing:\n${describeListing(listing)}`,
    `\nOrder amount escrowed: ${(order.amountLamports / 1_000_000_000).toFixed(4)} SOL`,
    `\nDispute evidence / messages:\n${messagesBlock}`,
  ].join("\n");

  const text = await callClaude(DISPUTE_SYSTEM_PROMPT, prompt, 1200);
  const parsed = extractJson<DisputeSummary>(text);
  parsed.suggestedSellerSharePct = Math.max(0, Math.min(100, Math.round(parsed.suggestedSellerSharePct)));
  return parsed;
}
