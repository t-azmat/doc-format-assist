import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only: everything here runs without a database or a Python
    // interpreter, so `npm test` stays usable in CI and on a fresh clone.
    include: ["src/**/*.test.ts"],
    environment: "node",
    // scrypt is deliberately slow (~100ms per hash) and the password suite
    // does a dozen of them.
    testTimeout: 20_000,
  },
});
