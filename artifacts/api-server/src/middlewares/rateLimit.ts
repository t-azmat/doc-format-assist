import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

const disabled = process.env.RATE_LIMIT_DISABLED === "true";

// Per-user when signed in, per-IP otherwise. Keying purely on IP would let one
// user behind a shared NAT exhaust the budget for everyone at that address.
// ipKeyGenerator normalises IPv6 to a /64 so a single host cannot cycle through
// addresses to reset its own counter.
function userOrIpKey(req: Request): string {
  return req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const common = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  skip: () => disabled,
  keyGenerator: userOrIpKey,
};

/** Broad backstop for the whole API. Generous enough that normal editing —
 *  which autosaves — never trips it. */
export const globalRateLimit = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 600,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

/** Login and registration: strict, because this is where credential stuffing
 *  lands. Successful requests are not counted, so a legitimate user is never
 *  locked out by their own activity. */
export const authRateLimit = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

/** Uploads and exports each spawn a Python process and touch the disk, so they
 *  are far more expensive than a normal request. */
export const heavyRateLimit = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 20,
  message: {
    error: "Too many document operations in progress. Try again in a minute.",
  },
});

/** The AI analysis route bills a third-party API per call. Without a cap, an
 *  authenticated user can run up an unbounded OpenAI invoice. */
export const aiRateLimit = rateLimit({
  ...common,
  windowMs: 60 * 60_000,
  limit: 40,
  message: {
    error: "Hourly analysis limit reached. Try again later.",
  },
});
