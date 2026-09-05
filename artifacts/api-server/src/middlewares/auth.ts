import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE, resolveSession } from "../lib/session";

function unauthorized(res: Response): void {
  res.status(401).json({ error: "Authentication required." });
}

/**
 * Attach `req.user` when the request carries a valid session cookie.
 *
 * Never rejects — routes that need a user use `requireAuth`. This exists so
 * endpoints like `/auth/me` can answer "nobody is logged in" without a 401
 * being logged as an error.
 */
export const attachUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) {
    next();
    return;
  }
  resolveSession(token)
    .then((session) => {
      if (session) {
        req.user = session.user;
        req.sessionId = session.sessionId;
      }
      next();
    })
    .catch(next);
};

/** Reject anything without a valid session. */
export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    unauthorized(res);
    return;
  }
  next();
};

/**
 * The id of the authenticated user.
 *
 * Throws rather than returning undefined: every call site sits behind
 * requireAuth, so a missing user means the middleware chain is wired wrong,
 * and failing loudly beats silently querying with `ownerId === undefined`.
 */
export function currentUserId(req: Request): number {
  if (!req.user) {
    throw new Error("currentUserId called on an unauthenticated request");
  }
  return req.user.id;
}
