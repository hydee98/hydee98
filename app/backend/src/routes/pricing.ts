import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  FEE_BPS,
  MOCK_USD_RATES,
  isPlaceholderCurrency,
  supportedCurrencies,
} from "../services/pricingService.js";

export const pricingRouter = Router();

/** Public: lets the frontend build the "pay with USDC/USDT/SOL/SKR"
 * selector and the fee disclosure from one source of truth instead of
 * hardcoding the mock rates client-side too. */
pricingRouter.get(
  "/rates",
  asyncHandler(async (_req, res) => {
    res.json({
      feeBps: FEE_BPS,
      currencies: supportedCurrencies().map((currency) => ({
        currency,
        usdRate: MOCK_USD_RATES[currency],
        isPlaceholder: isPlaceholderCurrency(currency),
      })),
    });
  })
);
