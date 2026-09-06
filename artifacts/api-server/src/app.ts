import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachUser } from "./middlewares/auth";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { globalRateLimit } from "./middlewares/rateLimit";
import { corsOptions, csrfOriginGuard } from "./middlewares/security";

const app: Express = express();

// Behind a reverse proxy (the normal production shape), req.ip and req.protocol
// come from X-Forwarded-*. Without this, rate limiting keys every request to
// the proxy's address and secure cookies are never set. TRUST_PROXY takes a hop
// count or a subnet; it stays off by default because trusting the header when
// nothing strips it lets a client spoof its own IP.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}

app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "blob:", "data:", "https://fonts.gstatic.com"],
        "worker-src": ["'self'"],
        "upgrade-insecure-requests": process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);
app.use(cors(corsOptions()));
app.use(cookieParser());
app.use(globalRateLimit);
app.use(csrfOriginGuard());
// Editor content can embed base64 images, so document JSON bodies (autosave,
// format, guidelines) far exceed body-parser's 100kb default. Allow up to 50mb
// to match the upload file-size limit.
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Resolve the session before the routes so both `requireAuth` and the rate
// limiter's per-user keying can see who is calling.
app.use(attachUser);

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, router);
// Unmatched /api paths are a client error, not a request for the SPA shell.
app.use("/api", notFoundHandler);

// Serve the built frontend when it is present next to the server (the
// container layout). Hosting both from one origin means the session cookie is
// same-origin, so CORS and SameSite stop being deployment concerns at all.
// import.meta.dirname is artifacts/api-server/dist at runtime.
const WEB_ROOT =
  process.env.WEB_ROOT ??
  path.resolve(import.meta.dirname, "..", "..", "paper-formatter", "dist", "public");

if (fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
  app.use(
    express.static(WEB_ROOT, {
      // Vite fingerprints asset filenames, so they can be cached hard; the
      // HTML entry point must not be, or clients pin to a stale build.
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // Client-side routing: any other GET renders the app shell.
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(WEB_ROOT, "index.html"));
  });
}

app.use(errorHandler);

export default app;
