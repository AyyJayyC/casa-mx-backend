import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { signRoleToken } from "./utils/authHelpers.js";

describe("POST /analytics/events", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("stores an anonymous event without a user id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      payload: { eventName: "page_view", metadata: { path: "/properties" } },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.userId).toBeNull();
  });

  it("attaches the user id when a valid token is sent", async () => {
    const user = await app.prisma.user.findUnique({
      where: { email: "admin@casamx.local" },
    });
    if (!user) throw new Error("seeded admin user is missing");

    const token = signRoleToken(app, {
      id: user.id,
      email: user.email,
      roles: ["admin"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      headers: { authorization: `Bearer ${token}` },
      payload: { eventName: "page_view" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.userId).toBe(user.id);
  });

  it("rejects an invalid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      payload: { metadata: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
