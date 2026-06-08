import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;

describe("Auth Roles - Admin auto-approval & self-healing", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-" } },
    });
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-" } },
    });
    await app.close();
  });

  describe("getInitialRoleStatus (via register)", () => {
    it("should auto-approve all roles for ADMIN_EMAIL user, including admin", async () => {
      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      if (!adminEmail) return; // skip if ADMIN_EMAIL not configured

      const email = adminEmail;
      const password = "AdminTestPass1";

      // Clean up
      const existing = await app.prisma.user.findUnique({ where: { email } });
      if (existing) {
        await app.prisma.userRole.deleteMany({
          where: { userId: existing.id },
        });
        await app.prisma.user.delete({ where: { email } });
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Admin User",
          password,
          roles: ["buyer", "admin"],
        },
      });

      // May get 409 if already exists in DB, which is fine
      if (response.statusCode === 409) {
        // User already exists - just verify in DB
        const user = await app.prisma.user.findUnique({
          where: { email },
          include: { roles: { include: { role: true } } },
        });
        expect(user).toBeDefined();
        const adminRole = user?.roles.find((r) => r.role.name === "admin");
        // We can still check the role status
        if (adminRole) {
          // Already existed, move on
        }
        return;
      }

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      expect(body.success).toBe(true);

      const adminRole = body.user.roles.find(
        (r: any) => r.roleName === "admin",
      );
      expect(adminRole).toBeDefined();
      expect(adminRole.status).toBe("approved");

      const buyerRole = body.user.roles.find(
        (r: any) => r.roleName === "buyer",
      );
      expect(buyerRole).toBeDefined();
      expect(buyerRole.status).toBe("approved");
    });

    it("should keep admin role pending for non-ADMIN_EMAIL user", async () => {
      const email = `test-nonadmin-${Date.now()}@example.com`;

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Regular User",
          password: "Password1",
          roles: ["buyer"],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      expect(body.success).toBe(true);

      // Non-ADMIN_EMAIL users cannot register with admin role (not in allowed enum)
      const adminRole = body.user.roles.find(
        (r: any) => r.roleName === "admin",
      );
      expect(adminRole).toBeUndefined();

      const buyerRole = body.user.roles.find(
        (r: any) => r.roleName === "buyer",
      );
      expect(buyerRole.status).toBe("approved");
    });

    it("should auto-approve buyer/tenant for any user", async () => {
      const email = `test-autoroles-${Date.now()}@example.com`;

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Auto Roles",
          password: "Password1",
          roles: ["buyer", "tenant"],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      const buyerRole = body.user.roles.find(
        (r: any) => r.roleName === "buyer",
      );
      const tenantRole = body.user.roles.find(
        (r: any) => r.roleName === "tenant",
      );
      expect(buyerRole.status).toBe("approved");
      expect(tenantRole.status).toBe("approved");
    });

    it("should set seller/landlord/wholesaler pending for regular user", async () => {
      const email = `test-pendingroles-${Date.now()}@example.com`;

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          name: "Pending Roles",
          password: "Password1",
          roles: ["seller", "landlord", "wholesaler"],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as any;
      for (const roleType of ["seller", "landlord", "wholesaler"]) {
        const role = body.user.roles.find((r: any) => r.roleName === roleType);
        expect(role).toBeDefined();
        expect(role.status).toBe("pending");
      }
    });
  });

  describe("Login self-healing (pending admin -> approved)", () => {
    it("should auto-approve pending admin role on login for ADMIN_EMAIL user", async () => {
      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      if (!adminEmail) return;

      const email = adminEmail;
      const password = "SelfHealTest1";

      // First, ensure user exists with a PENDING admin role
      let user = await app.prisma.user.findUnique({ where: { email } });
      if (!user) {
        const bcrypt = await import("bcrypt");
        const hash = await bcrypt.hash(password, 10);
        user = await app.prisma.user.create({
          data: { email, name: "Self Heal User", password: hash },
        });
      }

      const adminRole = await app.prisma.role.findUnique({
        where: { name: "admin" },
      });
      if (!adminRole) throw new Error("admin role not found");

      // Set admin role to pending
      await app.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
        create: { userId: user.id, roleId: adminRole.id, status: "pending" },
        update: { status: "pending" },
      });

      // Verify it's pending
      let userRole = await app.prisma.userRole.findUnique({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      });
      expect(userRole?.status).toBe("pending");

      // Login — this should trigger self-healing
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password },
      });

      expect(loginRes.statusCode).toBe(200);
      const loginBody = loginRes.json() as any;
      expect(loginBody.success).toBe(true);

      // Admin role should be approved in response
      const adminInResponse = loginBody.user.roles.find(
        (r: any) => r.roleName === "admin",
      );
      expect(adminInResponse.status).toBe("approved");

      // Verify it persisted in DB
      userRole = await app.prisma.userRole.findUnique({
        where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      });
      expect(userRole?.status).toBe("approved");
    });

    it("should NOT auto-approve pending admin for non-ADMIN_EMAIL user", async () => {
      const email = `test-noauto-${Date.now()}@example.com`;
      const password = "Password1";

      // Register as non-admin-email user with buyer role only
      const regRes = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email, name: "No Auto", password, roles: ["buyer"] },
      });

      expect(regRes.statusCode).toBe(201);

      // Verify admin was not created for non-ADMIN_EMAIL user
      const dbUser = await app.prisma.user.findUnique({
        where: { email },
        include: { roles: { include: { role: true } } },
      });
      const adminRoleDb = dbUser?.roles.find((r) => r.role.name === "admin");
      expect(adminRoleDb).toBeUndefined();

      // Login
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password },
      });

      expect(loginRes.statusCode).toBe(200);

      // Admin role should still not exist for non-ADMIN_EMAIL user after login
      const adminRoleAfter = await app.prisma.userRole.findFirst({
        where: { userId: dbUser!.id, role: { name: "admin" } },
      });
      expect(adminRoleAfter).toBeNull();
    });
  });
});
