import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";

const EMERGENCY_ROUTES = ["/admin/run-migrations", "/admin/setup-admin"];

describe("B4 - emergency admin routes are not reachable in production", () => {
  it("returns 404 for both routes in production mode", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const app = await buildApp();
    try {
      for (const url of EMERGENCY_ROUTES) {
        const res = await app.inject({
          method: "POST",
          url,
          payload: { secret: "anything" },
        });
        expect(res.statusCode, url).toBe(404);
      }
    } finally {
      await app.close();
      process.env.NODE_ENV = prev;
    }
  });

  it("rejects a wrong-length secret without throwing (timing-safe compare)", async () => {
    process.env.MIGRATION_SECRET = "correct-horse-battery-staple";
    const app = await buildApp();
    try {
      for (const url of EMERGENCY_ROUTES) {
        const res = await app.inject({
          method: "POST",
          url,
          payload: { secret: "short" },
        });
        expect(res.statusCode, url).toBe(403);
      }
    } finally {
      await app.close();
      delete process.env.MIGRATION_SECRET;
    }
  });
});
