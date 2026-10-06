import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;

describe("B2 - rate limiting keys on the forwarded client IP", () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("gives two distinct x-forwarded-for addresses independent buckets", async () => {
    const ipA = "203.0.113.10";
    const ipB = "198.51.100.20";
    // Payload fails validation fast but still consumes a rate-limit slot.
    const payload = { email: "not-an-email" };

    // /auth/register is capped at 50/15min in test mode. Exhaust IP A.
    let lastStatus = 0;
    for (let i = 0; i < 51; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { "x-forwarded-for": ipA },
        payload,
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);

    // IP B has a separate bucket and must not be throttled by IP A's traffic.
    const resB = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "x-forwarded-for": ipB },
      payload,
    });
    expect(resB.statusCode).toBe(400);
  });
});
