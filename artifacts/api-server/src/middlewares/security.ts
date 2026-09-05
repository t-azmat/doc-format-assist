import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

/**
 * Origins allowed to call the API with credentials.
 *
 * `cors()` with no arguments reflects every origin, which combined with cookie
 * auth would let any site on the internet make authenticated requests on a
 * signed-in user's behalf. The list is explicit and comes from the environment.
 */
export function allowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (configured.length > 0) return configured;

  // Development default: the Vite dev server. In production the app is served
  // same-origin behind one host, so an empty list is the correct, safe default.
  return process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://127.0.0.1:5173"];
}

export function corsOptions(): CorsOptions {
  const allowlist = allowedOrigins();
  return {
    origin(origin, callback) {
      // No Origin header: same-origin fetches, curl, health checks. There is no
      // cross-site risk to allow here, and blocking it breaks probes.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowlist.includes(origin.replace(/\/$/, "")));
    },
    // Required for the session cookie to travel on cross-origin dev requests.
    credentials: true,
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject cross-site state-changing requests.
 *
 * SameSite=Lax already blocks the cookie on cross-site POSTs in current
 * browsers; this is the belt to that suspenders, and it also covers older
 * clients. A mutating request must either carry no Origin (same-origin form
 * posts, server-to-server) or an Origin on the allowlist.
 */
export function csrfOriginGuard(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");
    if (!origin) {
      next();
      return;
    }

    const normalized = origin.replace(/\/$/, "");
    const sameOrigin = `${req.protocol}://${req.get("host")}`;
    if (normalized === sameOrigin || allowedOrigins().includes(normalized)) {
      next();
      return;
    }

    res.status(403).json({ error: "Cross-site request blocked." });
  };
}
