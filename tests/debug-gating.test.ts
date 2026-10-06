import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

describe("C3 - public debug write endpoints are gated", () => {
  afterEach(() => {
    delete process.env.ENABLE_PUBLIC_DEBUG;
  });

  it("returns 404 for anonymous writes by default", async () => {
    delete process.env.ENABLE_PUBLIC_DEBUG;
    const app = await buildApp();
    try {
      for (const url of ["/debug/session", "/debug/action", "/debug/error"]) {
        const res = await app.inject({
          method: "POST",
          url,
          payload: { sessionId: "x", actionType: "a", actionName: "b", errorMessage: "e" },
        });
        expect(res.statusCode, url).toBe(404);
      }
    } finally {
      await app.close();
    }
  });

  it("registers them only when explicitly enabled", async () => {
    process.env.ENABLE_PUBLIC_DEBUG = "true";
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/session",
        payload: { initialRoute: "/properties" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
