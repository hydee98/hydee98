import type { NextFunction, Request, Response } from "express";

/**
 * Guards arbitrator/authority-only actions (resolving a dispute, briefing
 * the arbitrator, approving a listing) - the off-chain equivalent of the
 * on-chain program's `require_keys_eq!(marketplace.authority, ...)`
 * checks. This is a single shared secret, not a real user/roles system -
 * appropriate for a small admin surface like this one, not a substitute
 * for proper auth if this grows real staff accounts.
 *
 * The frontend's Disputes page prompts for this token once and stores it
 * in localStorage, sending it back as `Authorization: Bearer <token>`.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res
      .status(503)
      .json({ error: "Admin actions are not configured: set ADMIN_TOKEN in app/backend/.env" });
    return;
  }

  const header = req.header("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Missing or invalid admin token" });
    return;
  }

  next();
}
