import "dotenv/config";
import cors from "cors";
import express from "express";
import { ensureSchema } from "./db/migrate.js";
import { isDbEnabled } from "./db/pool.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { listingsRouter } from "./routes/listings.js";
import { ordersRouter } from "./routes/orders.js";
import { isAuthConfigured } from "./services/authService.js";
import { fetchClusterStatus } from "./services/solanaService.js";

const app = express();
const PORT = Number(process.env.PORT) || 8787;

// In production, restrict this to your deployed frontend's origin(s) via
// CORS_ORIGIN (comma-separated for multiple). Left permissive by default
// so local dev and quick demos don't need any config.
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim());
app.use(cors(allowedOrigins ? { origin: allowedOrigins } : {}));
// Raised from Express's 100kb default - listing creation can carry a
// handful of client-compressed photo data URLs in the JSON body.
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", async (_req, res) => {
  const solana = await fetchClusterStatus();
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    adminConfigured: Boolean(process.env.ADMIN_TOKEN),
    authConfigured: isAuthConfigured(),
    dbEnabled: isDbEnabled(),
    solana,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/listings", listingsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/ai", aiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Final error handler - catches anything asyncHandler() forwards via
// next(err), so a DB/unexpected error becomes a JSON 500 instead of
// Express's default HTML error page (or a hung request).
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Unexpected server error" });
  }
);

async function main() {
  if (isDbEnabled()) {
    await ensureSchema();
    console.log("Connected to database - listings/orders persist across restarts.");
  } else {
    console.warn(
      "DATABASE_URL is not set - using an in-memory store that resets on every restart (see .env.example)."
    );
  }

  app.listen(PORT, () => {
    console.log(`Marketplace AI backend listening on http://localhost:${PORT}`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(
        "ANTHROPIC_API_KEY is not set - /api/ai/* routes will return 503 until it is configured (see .env.example)."
      );
    }
    if (!process.env.ADMIN_TOKEN) {
      console.warn(
        "ADMIN_TOKEN is not set - arbitrator/authority actions (resolve dispute, review listing, dispute summary) will return 503 until it is configured (see .env.example)."
      );
    }
    if (!isAuthConfigured()) {
      console.warn(
        "JWT_SECRET is not set - wallet sign-in will return 503 until it is configured (see .env.example)."
      );
    }
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
