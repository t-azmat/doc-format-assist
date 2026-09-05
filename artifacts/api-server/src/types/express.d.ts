import type { User } from "@workspace/db";

// Populated by the auth middleware. Route handlers behind requireAuth can rely
// on `req.user` being present; everything else must null-check.
declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

export {};
