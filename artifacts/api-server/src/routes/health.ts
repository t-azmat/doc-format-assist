import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { engineLoad } from "../lib/pythonClient";

const router: IRouter = Router();

// Liveness: is the process up? Deliberately dependency-free, so a database
// blip does not cause an orchestrator to restart a perfectly healthy server.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness: should this instance receive traffic? This one *does* touch the
// database, because an instance that cannot reach Postgres can serve nothing.
router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    res.status(503).json({ status: "unavailable", database: "unreachable" });
    return;
  }

  res.json({ status: "ok", database: "ok", engine: engineLoad() });
});

export default router;
