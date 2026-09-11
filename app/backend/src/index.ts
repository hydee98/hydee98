import "dotenv/config";
import cors from "cors";
import express from "express";
import { aiRouter } from "./routes/ai.js";
import { assetsRouter } from "./routes/assets.js";
import { fetchClusterStatus } from "./services/solanaService.js";

const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const solana = await fetchClusterStatus();
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    solana,
  });
});

app.use("/api/assets", assetsRouter);
app.use("/api/ai", aiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`RWA AI backend listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "ANTHROPIC_API_KEY is not set - /api/ai/* routes will return 503 until it is configured (see .env.example)."
    );
  }
});
