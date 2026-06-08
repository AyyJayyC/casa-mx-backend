import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import crypto from "crypto";

let app: FastifyInstance;

describe("Forgot Password & Reset Password Flow", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-fp-" } },
    });
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-fp-" } },
    });
    await app.close();
  });

  describe("POST /auth/forgot-password", () => {
    it("should return 200 for existing user and generate reset token", async () => {
      const email = `test-fp-${Date.now()}@example.com`;
      const password = "Password1";

      // Create user
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, name: "FP User", password, roles: ["buyer"] },
      });

      // Request password reset
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as any;
      expect(body.success).toBe(true);

      // Verify token was stored in DB
      const user = await app.prisma.user.findUnique({ where: { email } });
      expect(user?.passwordResetToken).toBeTruthy();
      expect(user?.passwordResetToken?.length).toBe(64); // 32 bytes hex = 64 chars
      expect(user?.passwordResetTokenExpiresAt).toBeDefined();
      expect(
        new Date(user!.passwordResetTokenExpiresAt!).getTime(),
      ).toBeGreaterThan(Date.now());
    });

    it("should return 200 for non-existent email (user enumeration protection)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: `nonexistent-${Date.now()}@example.com` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as any;
      expect(body.success).toBe(true);
      // Same message as success case
      expect(body.message).toContain("If the email exists");
    });

    it("should return 400 for invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/forgot-password",
        payload: { email: "not-an-email" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should be rate-limited", async () => {
      const email = "rate-limit-test@example.com";
      const responses: number[] = [];

      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          payload: { email },
        });
        responses.push(res.statusCode);
      }

      // At least one should be 429 (rate limited at 3 per 15 min)
      expect(responses.some((s) => s === 429)).toBe(true);
    });
  });

  describe("POST /auth/reset-password", () => {
    it("should reset password with valid token", async () => {
      const email = `test-fp-reset-${Date.now()}@example.com`;
      const oldPassword = "OldPass1";

      // Create user
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Reset User",
          password: oldPassword,
          roles: ["buyer"],
        },
      });

      // Generate reset token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await app.prisma.user.update({
        where: { email },
        data: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: expiresAt,
        },
      });

      // Reset password
      const newPassword = "NewPass1";
      const response = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: newPassword },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as any;
      expect(body.success).toBe(true);

      // Verify token is cleared
      const user = await app.prisma.user.findUnique({ where: { email } });
      expect(user?.passwordResetToken).toBeNull();
      expect(user?.passwordResetTokenExpiresAt).toBeNull();

      // Verify new password works
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: newPassword },
      });
      expect(loginRes.statusCode).toBe(200);

      // Old password should fail
      const oldLoginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: oldPassword },
      });
      expect(oldLoginRes.statusCode).toBe(401);
    });

    it("should reject expired token", async () => {
      const email = `test-fp-expired-${Date.now()}@example.com`;

      // Create user
      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Expired User",
          password: "Password1",
          roles: ["buyer"],
        },
      });

      // Generate expired token
      const token = crypto.randomBytes(32).toString("hex");
      const expiredAt = new Date(Date.now() - 1000); // 1 second ago

      await app.prisma.user.update({
        where: { email },
        data: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: expiredAt,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "NewPass1" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json() as any;
      expect(body.error).toContain("expired");
    });

    it("should reject invalid token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: {
          token: crypto.randomBytes(32).toString("hex"),
          password: "NewPass1",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate password strength", async () => {
      const email = `test-fp-weak-${Date.now()}@example.com`;

      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Weak Pass",
          password: "Password1",
          roles: ["buyer"],
        },
      });

      const token = crypto.randomBytes(32).toString("hex");
      await app.prisma.user.update({
        where: { email },
        data: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: new Date(Date.now() + 3600000),
        },
      });

      // Too short
      const shortRes = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "Ab1" },
      });
      expect(shortRes.statusCode).toBe(400);

      // No uppercase
      const noUpperRes = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "password123" },
      });
      expect(noUpperRes.statusCode).toBe(400);

      // No digit
      const noDigitRes = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "Password" },
      });
      expect(noDigitRes.statusCode).toBe(400);
    });

    it("should clear lockout state after successful reset", async () => {
      const email = `test-fp-lockout-${Date.now()}@example.com`;

      await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Lockout User",
          password: "Password1",
          roles: ["buyer"],
        },
      });

      // Set lockout state
      await app.prisma.user.update({
        where: { email },
        data: {
          failedLoginAttempts: 5,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
          lastFailedLoginAt: new Date(),
        },
      });

      const token = crypto.randomBytes(32).toString("hex");
      await app.prisma.user.update({
        where: { email },
        data: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: new Date(Date.now() + 3600000),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: { token, password: "NewPass1" },
      });

      expect(response.statusCode).toBe(200);

      // Verify lockout cleared
      const user = await app.prisma.user.findUnique({ where: { email } });
      expect(user?.failedLoginAttempts).toBe(0);
      expect(user?.lockedUntil).toBeNull();
      expect(user?.lastFailedLoginAt).toBeNull();
    });
  });
});
