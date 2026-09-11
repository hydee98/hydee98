import "dotenv/config";
import cors from "cors";
import express from "express";
import { aiRouter } from "./routes/ai.js";
import { listingsRouter } from "./routes/listings.js";
import { ordersRouter } from "./routes/orders.js";
import { fetchClusterStatus } from "./services/solanaService.js";

const app = express();
const PORT = Number(process.env.PORT) || 8787;

// In production, restrict this to your deployed frontend's origin(s) via
// CORS_ORIGIN (comma-separated for multiple). Left permissive by default
// so local dev and quick demos don't need any config.
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim());
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const solana = await fetchClusterStatus();
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    solana,
  });
});

app.use("/api/listings", listingsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/ai", aiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Marketplace AI backend listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "ANTHROPIC_API_KEY is not set - /api/ai/* routes will return 503 until it is configured (see .env.example)."
    );
  }
});
