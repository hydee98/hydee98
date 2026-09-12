import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { USDC_MINT } from "./solana";

/**
 * Client-side swap of the buyer's own SOL/USDT (and, once it launches,
 * SKR) into USDC via Jupiter's aggregator - so escrow only ever holds
 * USDC, and neither this dApp's backend nor the on-chain program ever
 * custodies or has swap authority over a buyer's non-USDC balance. The
 * buyer's wallet signs the swap transaction directly, exactly like any
 * other transaction in this dApp.
 *
 * Flow for a non-USDC purchase:
 *   1. `getSwapQuote()` - ask Jupiter for the best route/price
 *   2. `buildSwapTransaction()` - turn that quote into a ready-to-sign tx
 *   3. wallet-adapter's `signTransaction`/`sendTransaction` sends it
 *   4. once confirmed, the buyer now holds USDC and `create_order` (see
 *      lib/anchorIx.ts) proceeds exactly as a USDC-funded purchase would
 *
 * Not wired into the live UI in this environment: this sandbox's network
 * egress allowlist doesn't reach api.jup.ag (or Solana devnet, which the
 * swap output would need to land on anyway), so the actual HTTP round
 * trip can't be exercised or screenshotted here. The functions below are
 * complete and match Jupiter's documented v6 API shapes - wire them into
 * BuyPanel's "pay with SOL/USDT" path once you're running somewhere with
 * outbound access to api.jup.ag.
 */

const JUPITER_API_BASE = "https://quote-api.jup.ag/v6";

/** Mint addresses Jupiter needs - USDC's is imported from lib/solana so
 * there's one source of truth; SOL/USDT are well-known constants that
 * don't depend on which marketplace deployment this is. */
export const SWAP_INPUT_MINTS = {
  SOL: "So11111111111111111111111111111111111111112", // wrapped SOL
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // mainnet USDT; use your cluster's USDT mint on devnet/testnet
} as const;

export type SwappableCurrency = keyof typeof SWAP_INPUT_MINTS;

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  [key: string]: unknown;
}

export class JupiterSwapError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JupiterSwapError";
  }
}

/**
 * Fetches a quote to swap `amountBaseUnits` of `inputMint` into USDC.
 * `amountBaseUnits` is in the input token's smallest unit (lamports for
 * SOL, 6-decimal base units for USDT) - convert your human-readable
 * amount before calling this.
 */
export async function getSwapQuote(params: {
  inputMint: string;
  amountBaseUnits: bigint;
  slippageBps?: number;
}): Promise<JupiterQuoteResponse> {
  const { inputMint, amountBaseUnits, slippageBps = 50 } = params;
  const url = new URL(`${JUPITER_API_BASE}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", USDC_MINT.toBase58());
  url.searchParams.set("amount", amountBaseUnits.toString());
  url.searchParams.set("slippageBps", String(slippageBps));

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new JupiterSwapError("Could not reach the Jupiter quote API", err);
  }
  if (!res.ok) {
    throw new JupiterSwapError(`Jupiter quote request failed with status ${res.status}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

/**
 * Turns a quote into a ready-to-sign versioned transaction that swaps
 * directly into the buyer's own USDC associated token account. The
 * caller still has to sign and send it - this function performs no
 * signing itself.
 */
export async function buildSwapTransaction(params: {
  quote: JupiterQuoteResponse;
  userPublicKey: PublicKey;
}): Promise<VersionedTransaction> {
  const { quote, userPublicKey } = params;
  let res: Response;
  try {
    res = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
  } catch (err) {
    throw new JupiterSwapError("Could not reach the Jupiter swap API", err);
  }
  if (!res.ok) {
    throw new JupiterSwapError(`Jupiter swap request failed with status ${res.status}`);
  }
  const { swapTransaction } = (await res.json()) as { swapTransaction: string };

  // Jupiter returns a base64-encoded serialized VersionedTransaction.
  const { VersionedTransaction: VersionedTransactionCtor } = await import("@solana/web3.js");
  return VersionedTransactionCtor.deserialize(Buffer.from(swapTransaction, "base64"));
}

/**
 * Convenience wrapper: quote + build in one call. Send the result with
 * the wallet adapter's `sendTransaction` (versioned transactions don't go
 * through the legacy `Transaction`/`signTransaction` path), then poll
 * `connection.confirmTransaction` before proceeding to `create_order`.
 */
export async function prepareSwapToUsdc(params: {
  currency: SwappableCurrency;
  amountBaseUnits: bigint;
  userPublicKey: PublicKey;
  slippageBps?: number;
}): Promise<{ quote: JupiterQuoteResponse; transaction: VersionedTransaction }> {
  const quote = await getSwapQuote({
    inputMint: SWAP_INPUT_MINTS[params.currency],
    amountBaseUnits: params.amountBaseUnits,
    slippageBps: params.slippageBps,
  });
  const transaction = await buildSwapTransaction({ quote, userPublicKey: params.userPublicKey });
  return { quote, transaction };
}

// Re-exported only so callers that still deal in legacy Transactions (e.g.
// composing the swap with other instructions) have the type in scope
// without a second import line.
export type { Connection, Transaction };
