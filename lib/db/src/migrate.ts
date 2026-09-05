/**
 * Apply pending SQL migrations from lib/db/migrations.
 *
 * This replaces `drizzle-kit push` as the way schema changes reach a real
 * environment. `push` diffs the live database against the schema and applies
 * whatever it decides is needed — no review step, no ordering guarantees, and
 * no way back. Checked-in migrations are reviewable in a PR, run in a fixed
 * order, and are recorded in drizzle's journal table so re-running is a no-op.
 *
 * Run with: npm run migrate -w @workspace/db
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Load the repo-root .env before ./index, which throws when DATABASE_URL is
// unset. ESM evaluates imports in order, so this has to sit above that import.
config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"),
  quiet: true,
});

const { db, pool } = await import("./index");

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "migrations");

async function main(): Promise<void> {
  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
}

main()
  .catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
