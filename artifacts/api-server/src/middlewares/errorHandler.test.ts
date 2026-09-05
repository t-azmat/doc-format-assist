import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { errorHandler } from "./errorHandler";

const app = express();
app.use(express.json({ limit: "1kb" }));
app.post("/test", (_req, res) => res.json({ ok: true }));
app.use(errorHandler);

it("returns a safe 400 for malformed JSON", async () => {
  const res = await request(app).post("/test").set("Content-Type", "application/json").send('{"secret":');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: "Request body must be valid JSON." });
});

it("returns 413 for oversized JSON instead of an internal server error", async () => {
  const res = await request(app).post("/test").send({ content: "x".repeat(2048) });
  expect(res.status).toBe(413);
  expect(res.body).toEqual({ error: "Request body is too large." });
});
