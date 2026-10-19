import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { signRoleToken } from "./utils/authHelpers.js";

/**
 * /auth/me runs on every page load to hydrate the session. A low per-IP cap
 * logs real users out after ~30 navigations and makes E2E flaky.
 */
describe("/auth/me rate limit", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    const user = await app.prisma.user.findUnique({
      where: { email: "admin@casamx.local" },
    });
    if (!user) throw new Error("seeded admin user is missing");
    token = signRoleToken(app, {
      id: user.id,
      email: user.email,
      roles: ["admin"],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("does not rate-limit session hydration after 35 page loads", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
