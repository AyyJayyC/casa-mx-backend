import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import { AuthService } from "../src/services/auth.service.js";
import { bootstrapAdmin } from "../src/plugins/bootstrapAdmin.js";

const ADMIN_EMAIL = "test-admin-escalation@example.com";

let app: FastifyInstance;

async function cleanup() {
  await app.prisma.user.deleteMany({
    where: {
      OR: [
        { email: ADMIN_EMAIL },
        { email: { startsWith: "test-escalation-" } },
      ],
    },
  });
}

describe("B1 - Admin escalation is impossible from register/OAuth/login", () => {
  beforeAll(async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
    app = await buildApp();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    delete process.env.ADMIN_EMAIL;
    await app.close();
  });

  it("does not grant approved admin when registering with ADMIN_EMAIL (pending + unverified)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true,
        email: ADMIN_EMAIL,
        name: "Escalation Attempt",
        password: "Password1",
        roles: ["client"],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;

    const adminRole = body.user.roles.find(
      (r: any) => r.roleName === "admin",
    );
    // If an admin record exists it must be pending, never approved.
    if (adminRole) {
      expect(adminRole.status).toBe("pending");
    }

    // Token must not carry approved admin.
    const tokenPayload = app.jwt.decode(body.token) as any;
    expect(tokenPayload.roles).not.toContain("admin");

    const dbUser = await app.prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      include: { roles: { include: { role: true } } },
    });
    expect(dbUser?.emailVerified).toBe(false);
    const dbAdmin = dbUser?.roles.find((r) => r.role.name === "admin");
    if (dbAdmin) expect(dbAdmin.status).toBe("pending");
  });

  it("does not grant admin when the same email arrives via OAuth", async () => {
    const authService = new AuthService(app.prisma);
    const user = await authService.loginOrCreateOAuthUser({
      provider: "google",
      providerId: "escalation-oauth-sub",
      email: ADMIN_EMAIL,
      name: "OAuth Attempt",
    });

    const approvedAdmin = user.roles.find(
      (r) => r.roleName === "admin" && r.status === "approved",
    );
    expect(approvedAdmin).toBeUndefined();

    // OAuth of a brand-new ADMIN_EMAIL must not create admin either.
    const freshEmail = `test-escalation-oauth-${Date.now()}@example.com`;
    process.env.ADMIN_EMAIL = freshEmail;
    const fresh = await authService.loginOrCreateOAuthUser({
      provider: "google",
      providerId: `escalation-fresh-${Date.now()}`,
      email: freshEmail,
      name: "Fresh OAuth",
    });
    expect(fresh.roles.find((r) => r.roleName === "admin")).toBeUndefined();
    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  });

  it("does not mutate roles on login", async () => {
    const email = `test-escalation-login-${Date.now()}@example.com`;
    const password = "Password1";

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { acceptLegal: true, email, name: "Login Mutate", password, roles: ["client"] },
    });
    expect(reg.statusCode).toBe(201);

    const user = await app.prisma.user.findUnique({ where: { email } });
    const adminRole = await app.prisma.role.findUnique({
      where: { name: "admin" },
    });
    await app.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user!.id, roleId: adminRole!.id } },
      create: { userId: user!.id, roleId: adminRole!.id, status: "pending" },
      update: { status: "pending" },
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);

    const stillPending = await app.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user!.id, roleId: adminRole!.id } },
    });
    expect(stillPending?.status).toBe("pending");

    // No new roles conjured by login (owner was never requested).
    const rolesAfter = await app.prisma.userRole.findMany({
      where: { userId: user!.id },
      include: { role: true },
    });
    expect(rolesAfter.find((r) => r.role.name === "owner")).toBeUndefined();
  });

  it("bootstrapAdmin only approves an email-verified user", async () => {
    const verifyEmail = `test-escalation-bootstrap-${Date.now()}@example.com`;
    process.env.ADMIN_EMAIL = verifyEmail;

    const user = await app.prisma.user.create({
      data: { email: verifyEmail, name: "Bootstrap Me", emailVerified: false },
    });
    const adminRole = await app.prisma.role.findUnique({
      where: { name: "admin" },
    });

    // Unverified: bootstrap must not approve.
    await bootstrapAdmin(app);
    let role = await app.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: adminRole!.id } },
    });
    expect(role?.status === "approved").toBe(false);

    // Verified: bootstrap may approve.
    await app.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    await bootstrapAdmin(app);
    role = await app.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: adminRole!.id } },
    });
    expect(role?.status).toBe("approved");

    process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  });
});
