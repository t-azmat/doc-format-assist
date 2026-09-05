import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Exercise the actual production bundle and static asset layout without a DB.
const port = process.env.SMOKE_PORT || "18089";
const base = `http://127.0.0.1:${port}`;
let output = "";
const child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: port,
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    STORAGE_DIR: fileURLToPath(new URL("../tmp/smoke-storage", import.meta.url)),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
let spawnError;
child.on("error", error => { spawnError = error; });

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      ready = (await fetch(`${base}/api/healthz`)).ok;
    } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, `Server did not start: ${output}`);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Editorial Desk/);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(page.headers.get("cache-control"), "no-cache");
  const deepLink = await fetch(`${base}/documents/123`);
  assert.match(await deepLink.text(), /Editorial Desk/);
  assert.equal(deepLink.headers.get("cache-control"), "no-cache");
  const theme = await fetch(`${base}/theme-init.js`);
  assert.match(theme.headers.get("content-type"), /javascript/);
  const privateData = await fetch(`${base}/api/documents`);
  assert.equal(privateData.status, 401);
  assert.equal(privateData.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  const invalid = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(invalid.status, 400);
  console.log("Production smoke checks passed: frontend, deep links, CSP, cache policy, authentication, and JSON errors.");
} finally {
  child.kill();
}
