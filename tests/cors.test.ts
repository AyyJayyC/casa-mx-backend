import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("CORS origin policy (A10)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: "/properties",
      headers: {
        origin,
        "access-control-request-method": "GET",
      },
    });

  it("rejects project-looking Vercel preview origins by default", async () => {
    const origin = "https://casa-mx-abc123-team.vercel.app";
    const res = await preflight(origin);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows an explicitly listed preview origin", async () => {
    const origin = "https://casa-mx-preview.vercel.app";
    process.env.CORS_EXTRA_ORIGINS = origin;
    try {
      const res = await preflight(origin);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    } finally {
      delete process.env.CORS_EXTRA_ORIGINS;
    }
  });

  it("allows the production domains", async () => {
    const res = await preflight("https://casa-mx.com");
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://casa-mx.com",
    );
  });

  it("rejects unrelated *.vercel.app origins", async () => {
    const res = await preflight("https://evil-attacker.vercel.app");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
