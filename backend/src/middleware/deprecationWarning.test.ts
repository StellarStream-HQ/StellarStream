import type { Request, Response } from "express";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  V1_DEPRECATION_DATE,
  V1_MIGRATION_GUIDE_URL,
  V1_SUNSET_DATE,
  v1DeprecationWarning,
} from "./deprecationWarning.js";

describe("v1DeprecationWarning", () => {
  it("sets advisory V1 deprecation headers and continues the request", () => {
    const headers = new Map<string, string | number | readonly string[]>();
    const res = {
      setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
        headers.set(name, value);
        return res as Response;
      }),
    } as Partial<Response> as Response;
    const next = vi.fn();

    v1DeprecationWarning({} as Request, res, next);

    expect(headers.get("Deprecation")).toBe(V1_DEPRECATION_DATE);
    expect(headers.get("Sunset")).toBe(V1_SUNSET_DATE);
    expect(String(headers.get("Link"))).toContain(V1_MIGRATION_GUIDE_URL);
    expect(String(headers.get("Warning"))).toContain("StellarStream API v1 is deprecated");
    expect(String(headers.get("X-StellarStream-API-Deprecation"))).toContain(
      "documented bridge paths",
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("applies headers when mounted on the main V1 prefix", async () => {
    const app = express();
    app.use("/api/v1", v1DeprecationWarning);
    app.get("/api/v1/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    const res = await request(app).get("/api/v1/health").expect(200);

    expect(res.headers.deprecation).toBe(V1_DEPRECATION_DATE);
    expect(res.headers.sunset).toBe(V1_SUNSET_DATE);
    expect(res.headers.link).toContain(V1_MIGRATION_GUIDE_URL);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("applies headers when mounted on the legacy API prefix", async () => {
    const app = express();
    app.use("/api", v1DeprecationWarning);
    app.get("/api/streams", (_req, res) => {
      res.json({ streams: [] });
    });

    const res = await request(app).get("/api/streams").expect(200);

    expect(res.headers.deprecation).toBe(V1_DEPRECATION_DATE);
    expect(res.headers.sunset).toBe(V1_SUNSET_DATE);
    expect(res.headers.link).toContain(V1_MIGRATION_GUIDE_URL);
    expect(res.body).toEqual({ streams: [] });
  });
});
