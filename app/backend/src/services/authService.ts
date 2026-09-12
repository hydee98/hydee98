import { PublicKey } from "@solana/web3.js";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nacl from "tweetnacl";

/**
 * "Sign-In With Solana" - a wallet's signature over a short-lived,
 * server-issued nonce IS the account. No email/password, no signup form:
 * the first successful verify() for a public key creates its user row
 * (see data/users.ts touchUser()).
 *
 * Nonces live in memory only (a single Render web-service instance is
 * fine with this; a multi-instance deployment would need a shared store
 * like Redis instead - noted here rather than silently breaking under
 * horizontal scaling).
 */

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL = "7d";

interface PendingNonce {
  nonce: string;
  expiresAt: number;
}

const pendingNonces = new Map<string, PendingNonce>();

export function isAuthConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET);
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set - wallet sign-in is unavailable until it is configured");
  }
  return secret;
}

export function messageForNonce(nonce: string): string {
  return `Sign in to MarketAI\n\nNonce: ${nonce}\n\nThis request will not trigger a transaction or cost any SOL.`;
}

/** Step 1 of sign-in: issue a fresh nonce for this public key, discarding
 * any previous one (only the latest nonce per key is valid). */
export function issueNonce(publicKey: string): { nonce: string; message: string } {
  const nonce = crypto.randomBytes(16).toString("hex");
  pendingNonces.set(publicKey, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
  return { nonce, message: messageForNonce(nonce) };
}

export class AuthError extends Error {}

/** Step 2 of sign-in: verify the wallet actually signed the nonce we
 * issued for it. Consumes the nonce either way (single use). */
export function verifyNonceSignature(publicKey: string, signatureBase64: string): void {
  const pending = pendingNonces.get(publicKey);
  pendingNonces.delete(publicKey); // single-use regardless of outcome

  if (!pending) {
    throw new AuthError("No sign-in request found for this wallet - request a new nonce and try again");
  }
  if (Date.now() > pending.expiresAt) {
    throw new AuthError("Sign-in request expired - request a new nonce and try again");
  }

  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = new PublicKey(publicKey).toBytes();
  } catch {
    throw new AuthError("Invalid wallet public key");
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = new Uint8Array(Buffer.from(signatureBase64, "base64"));
  } catch {
    throw new AuthError("Invalid signature encoding");
  }

  const messageBytes = new TextEncoder().encode(messageForNonce(pending.nonce));
  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  if (!valid) {
    throw new AuthError("Signature does not match this wallet and message");
  }
}

export function issueSessionToken(publicKey: string): string {
  return jwt.sign({ sub: publicKey }, getJwtSecret(), { expiresIn: SESSION_TTL });
}

export function verifySessionToken(token: string): { publicKey: string } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload === "object" && payload && typeof payload.sub === "string") {
      return { publicKey: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}
