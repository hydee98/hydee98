import type { NextFunction, Request, Response } from "express";

/** Wraps an async Express handler so a rejected promise reaches the error
 * middleware (`next(err)`) instead of becoming an unhandled rejection that
 * leaves the request hanging. Express 4 doesn't await handlers itself. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
