import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/**
 * Load the repo-root .env before anything reads process.env.
 *
 * This module must be imported first in the process entry point: `@workspace/db`
 * throws at import time when DATABASE_URL is missing, and ESM evaluates imports
 * in declaration order, so a later import would be too late.
 *
 * The path is resolved explicitly rather than relying on dotenv's cwd default,
 * because `npm run dev:api` runs with the cwd set to artifacts/api-server while
 * the .env lives at the repo root.
 *
 * Node 20 has no --env-file-if-exists (it landed in 22) and bare --env-file
 * throws when the file is absent, so a dependency is the portable option here.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

// dist/ at runtime, src/lib/ in source form — walk up to the repo root from
// either, and let dotenv ignore the one that does not exist.
const candidates = [
  path.resolve(here, "..", "..", "..", ".env"), // dist  -> api-server -> artifacts -> root
  path.resolve(here, "..", "..", "..", "..", ".env"), // src/lib -> src -> api-server -> artifacts -> root
];

config({ path: candidates, quiet: true });
