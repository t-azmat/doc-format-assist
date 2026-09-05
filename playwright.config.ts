import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18090",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node artifacts/api-server/dist/index.mjs",
    url: "http://127.0.0.1:18090/api/healthz",
    timeout: 30_000,
    env: {
      NODE_ENV: "production",
      PORT: "18090",
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    },
  },
});
