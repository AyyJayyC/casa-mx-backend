import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

// Must be set before env.ts is imported.
vi.hoisted(() => {
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef";
});

import { buildApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;
let userId: string;

describe("C2 - access and refresh tokens are not interchangeable", () => {
  beforeAll(async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true,
        isAdult: true,
        email: `test-jwt-${Date.now()}@example.com`,
        name: "JWT User",
        password: "Password1",
        roles: ["client"],
      },
    });
    userId = res.json().user.id;
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-jwt-" } },
    });
    await app.close();
  });

  it("rejects a refresh token on an authenticated access route", async () => {
    const refresh = app.jwt.sign(
      { id: userId, type: "refresh", jti: "abc" },
      { expiresIn: "7d" },
    );

    const res = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${refresh}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("still accepts a normal access token", async () => {
    const access = app.jwt.sign(
      { id: userId, email: "test-jwt@example.com", roles: ["client"] },
      { expiresIn: "15m" },
    );

    const res = await app.inject({
      method: "GET",
      url: "/users/me",
      headers: { authorization: `Bearer ${access}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("signs refresh tokens with JWT_REFRESH_SECRET, not the access secret", async () => {
    const refresh = app.jwt.sign(
      { id: userId, type: "refresh", jti: "xyz" },
      { expiresIn: "7d" },
    );

    // Verifiable with the refresh secret...
    const decoded = jwt.verify(refresh, env.JWT_REFRESH_SECRET!) as any;
    expect(decoded.type).toBe("refresh");

    // ...but not with the access secret while a separate one is configured.
    expect(() => jwt.verify(refresh, env.JWT_SECRET)).toThrow();
  });

  it("app.jwt.verify accepts the refresh token for the refresh flow", async () => {
    const refresh = app.jwt.sign(
      { id: userId, type: "refresh", jti: "rot" },
      { expiresIn: "7d" },
    );
    const decoded = app.jwt.verify(refresh) as any;
    expect(decoded.type).toBe("refresh");
  });
});
