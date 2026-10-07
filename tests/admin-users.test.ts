import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import { getCookie } from "./utils/authHelpers.js";

let app: FastifyInstance;
let adminToken: string;

describe("C4 - GET /admin/users never leaks credentials", () => {
  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@casamx.local",
        password: process.env.TEST_ADMIN_PASSWORD || "admin123",
      },
    });
    adminToken = getCookie(login, "accessToken") ?? (login.json() as any).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns users without password hashes or tokens", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    for (const user of body.data) {
      expect(user).not.toHaveProperty("password");
      expect(user).not.toHaveProperty("verificationToken");
      expect(user).not.toHaveProperty("passwordResetToken");
      expect(user).not.toHaveProperty("pendingEmail");
    }

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("$2b$");
    expect(serialized).not.toContain("verificationToken");
  });
});
