import type { PaymentCurrency } from "../types.js";

/** Platform fee in basis points (200 = 2%), matching MAX_FEE_BPS/fee_bps
 * in programs/escrow_marketplace/src/lib.rs. Deducted from the seller's
 * payout only when an order actually completes (confirm_receipt, or a
 * paying-out dispute resolution) - never on a refund/cancellation - and
 * routed to the treasury wallet for buyback/reward distribution to
 * holders of the platform token.
 *
 * Overridable via PLATFORM_FEE_BPS so this off-chain projection can be
 * kept in sync if you ever call `set_fee_config` to change the rate
 * on-chain without redeploying the backend. The actual deduction always
 * happens on-chain - this constant only drives the informational
 * `feeUsd` shown in the UI before an order is funded. */
export const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS) || 200;

/**
 * Indicative USD price per unit of each supported payment currency.
 *
 * USDC and USDT are pegged 1:1 to the US dollar by design. SOL uses an
 * illustrative fixed rate - a live deployment would source this from the
 * same DEX aggregator quote (e.g. Jupiter) used for the actual
 * client-side swap into USDC, rather than a hardcoded number.
 *
 * SKR is a placeholder: the token has not launched yet, so there is no
 * real market price for it. It's listed here purely so "Pay with SKR"
 * can appear as a (clearly marked "coming soon") option in the UI ahead
 * of launch. Replace this rate with a live quote once SKR has an actual
 * market - do not ship this mock rate to a production deployment where
 * SKR is live.
 */
export const MOCK_USD_RATES: Record<PaymentCurrency, number> = {
  USDC: 1,
  USDT: 1,
  SOL: 150,
  SKR: 0.05,
};

/** SKR doesn't exist yet - flag it in the UI/API so buyers aren't misled
 * into thinking this is a real, liquid conversion rate. */
export function isPlaceholderCurrency(currency: PaymentCurrency): boolean {
  return currency === "SKR";
}

export function supportedCurrencies(): PaymentCurrency[] {
  return ["USDC", "USDT", "SOL", "SKR"];
}

/** How much of `currency` a buyer would need to pay for a listing priced
 * at `usdAmount`, at the mock rate above (in that currency's own units,
 * e.g. SOL - not lamports). */
export function usdToCurrencyAmount(usdAmount: number, currency: PaymentCurrency): number {
  const rate = MOCK_USD_RATES[currency];
  return usdAmount / rate;
}

/** The platform fee, in USD, an order of this value will incur once it
 * actually completes. Rounded to cents. */
export function feeUsdFor(amountUsd: number): number {
  return Math.round(amountUsd * FEE_BPS) / 10_000;
}
