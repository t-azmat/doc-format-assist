import { defineConfig } from "drizzle-kit";
import path from "path";
import { config as loadEnv } from "dotenv";

// drizzle-kit runs this file in its own process, so it needs the repo-root .env
// loaded here too — otherwise `migrate`/`push` see an empty DATABASE_URL even
// when the API server can read it fine.
loadEnv({ path: path.resolve(__dirname, "..", "..", ".env"), quiet: true });

// `drizzle-kit generate` only reads the schema — it writes SQL files without
// touching a database — so a missing DATABASE_URL must not break codegen. The
// commands that do connect (migrate/push/studio) fail on their own if the URL
// is absent, and the API server refuses to boot without it.
const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  // Use forward slashes: drizzle-kit treats this as a glob, and on Windows the
  // backslashes from path.join are interpreted as escape characters (no match).
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  // Relative, unlike `schema` above: drizzle-kit resolves `out` against the
  // config's directory, so an absolute path here gets appended to it and the
  // snapshot lookup fails with a doubled path.
  out: "./migrations",
  dialect: "postgresql",
  strict: true,
  dbCredentials: {
    url,
  },
});
