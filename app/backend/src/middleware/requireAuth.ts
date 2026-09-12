import type { NextFunction, Request, Response } from "express";
import { isAuthConfigured, verifySessionToken } from "../services/authService.js";

/** Requires a valid wallet session (see routes/auth.ts). Attaches
 * `req.auth = { publicKey }` for the handler to use as the caller's real
 * identity - never trust a client-supplied wallet/seller/buyer field once
 * this is in place. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "Sign-in is not configured: set JWT_SECRET in app/backend/.env" });
    return;
  }

  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "Sign in with your wallet first" });
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: "Session expired or invalid - sign in again" });
    return;
  }

  req.auth = payload;
  next();
}
