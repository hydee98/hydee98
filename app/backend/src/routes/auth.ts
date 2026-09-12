import { PublicKey } from "@solana/web3.js";
import { Router } from "express";
import { getUser, touchUser, updateUser } from "../data/users.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  AuthError,
  isAuthConfigured,
  issueNonce,
  issueSessionToken,
  verifyNonceSignature,
} from "../services/authService.js";

export const authRouter = Router();

function isValidPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Step 1: the frontend asks for a nonce to sign, proving wallet
 * ownership without ever touching a private key or moving any SOL. */
authRouter.post("/nonce", (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: "Sign-in is not configured: set JWT_SECRET in app/backend/.env" });
  }
  const { publicKey } = req.body ?? {};
  if (!isValidPublicKey(publicKey)) {
    return res.status(400).json({ error: "A valid Solana public key is required" });
  }
  const { message } = issueNonce(publicKey);
  res.json({ message });
});

/** Step 2: verify the signed nonce and issue a session. Creates the user
 * on first sign-in. */
authRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { publicKey, signature } = req.body ?? {};
    if (!isValidPublicKey(publicKey)) {
      return res.status(400).json({ error: "A valid Solana public key is required" });
    }
    if (typeof signature !== "string" || !signature) {
      return res.status(400).json({ error: "signature is required" });
    }

    try {
      verifyNonceSignature(publicKey, signature);
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: err.message });
      }
      throw err;
    }

    const user = await touchUser(publicKey);
    const token = issueSessionToken(publicKey);
    res.json({ token, user });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUser(req.auth!.publicKey);
    res.json({ user: user ?? null });
  })
);

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { displayName } = req.body ?? {};
    if (displayName !== null && typeof displayName !== "string") {
      return res.status(400).json({ error: "displayName must be a string or null" });
    }
    const updated = await updateUser(req.auth!.publicKey, {
      displayName: typeof displayName === "string" ? displayName.trim().slice(0, 40) : null,
    });
    res.json({ user: updated });
  })
);
