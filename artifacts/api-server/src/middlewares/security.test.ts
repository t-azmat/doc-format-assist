import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { allowedOrigins, corsOptions, csrfOriginGuard } from "./security";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("allowedOrigins", () => {
  it("reads a comma-separated allowlist from the environment", () => {
    process.env.CORS_ORIGINS = "https://a.example, https://b.example/";
    expect(allowedOrigins()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("defaults to the Vite dev server outside production", () => {
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "development";
    expect(allowedOrigins()).toContain("http://localhost:5173");
  });

  it("defaults to nothing in production", () => {
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    expect(allowedOrigins()).toEqual([]);
  });
});

describe("corsOptions", () => {
  function check(origin: string | undefined): boolean {
    let allowed = false;
    const originFn = corsOptions().origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    originFn(origin, (_err, allow) => {
      allowed = Boolean(allow);
    });
    return allowed;
  }

  it("allows an origin on the list", () => {
    process.env.CORS_ORIGINS = "https://app.example";
    expect(check("https://app.example")).toBe(true);
  });

  it("rejects an origin that is not on the list", () => {
    process.env.CORS_ORIGINS = "https://app.example";
    expect(check("https://evil.example")).toBe(false);
  });

  it("allows requests with no Origin header", () => {
    process.env.CORS_ORIGINS = "https://app.example";
    expect(check(undefined)).toBe(true);
  });

  it("sends credentials, which the session cookie requires", () => {
    expect(corsOptions().credentials).toBe(true);
  });
});

describe("csrfOriginGuard", () => {
  function run(method: string, origin?: string, host = "api.example") {
    const req = {
      method,
      protocol: "https",
      get: (header: string) =>
        header.toLowerCase() === "origin" ? origin : host,
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const next = vi.fn();
    csrfOriginGuard()(req, res, next);
    return { res, next };
  }

  it("lets safe methods through regardless of origin", () => {
    const { next } = run("GET", "https://evil.example");
    expect(next).toHaveBeenCalled();
  });

  it("blocks a cross-site POST", () => {
    process.env.CORS_ORIGINS = "https://app.example";
    const { res, next } = run("POST", "https://evil.example");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows a same-origin POST", () => {
    const { next } = run("POST", "https://api.example");
    expect(next).toHaveBeenCalled();
  });

  it("allows a POST from an allowlisted origin", () => {
    process.env.CORS_ORIGINS = "https://app.example";
    const { next } = run("POST", "https://app.example");
    expect(next).toHaveBeenCalled();
  });

  it("allows a POST with no Origin header (curl, server-to-server)", () => {
    const { next } = run("POST", undefined);
    expect(next).toHaveBeenCalled();
  });
});
