// Must stay first: it populates process.env, and @workspace/db (reached via
// ./app) throws at import time when DATABASE_URL is unset.
import "./lib/env";
import app from "./app";
import { logger } from "./lib/logger";
import { sweepExpiredSessions } from "./lib/session";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to localhost by default; override with HOST (e.g. 0.0.0.0) if needed.
const host = process.env["HOST"] ?? "127.0.0.1";

const server = app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
});

// A long-running Docling extraction can legitimately hold a request open for
// minutes; Node's default header/request timeouts would cut it off first.
server.requestTimeout = 10 * 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

// Expired sessions would otherwise accumulate forever. Hourly is plenty:
// expiry is already enforced on read, so this only reclaims space.
const SWEEP_INTERVAL_MS = 60 * 60_000;
const sweepTimer = setInterval(() => {
  sweepExpiredSessions()
    .then((count) => {
      if (count > 0) logger.info({ count }, "Swept expired sessions");
    })
    .catch((err: unknown) => logger.warn({ err }, "Session sweep failed"));
}, SWEEP_INTERVAL_MS);
// Housekeeping should not keep the process alive on its own.
sweepTimer.unref();

// Stop accepting new connections but let in-flight work finish, so a deploy
// does not truncate someone's export mid-download.
function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  clearInterval(sweepTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => shutdown(signal));
}
