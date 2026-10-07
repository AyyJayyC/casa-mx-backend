import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import { refreshTokenStoreService } from "../src/services/refreshTokenStore.service.js";

let app: FastifyInstance;
const createdUserIds: string[] = [];

async function registerUser(prefix: string, roles: string[] = ["client"]) {
  const email = `test-arco-${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}@example.com`;
  const password = "Password1";
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      acceptLegal: true, isAdult: true,
      email,
      name: `ARCO ${prefix}`,
      password,
      roles,
    },
  });
  const body = res.json() as any;
  createdUserIds.push(body.user.id);
  return { email, password, token: body.token, id: body.user.id };
}

describe("B6 - ARCO data export and account deletion", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-arco-" } },
    });
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    refreshTokenStoreService.clearMemoryStateForTests();
    await app.close();
  });

  it("exports only the requester's data", async () => {
    const a = await registerUser("export-a");
    const b = await registerUser("export-b");

    await app.prisma.creditBalance.create({
      data: { userId: a.id, balance: 42 },
    });
    await app.prisma.creditTransaction.create({
      data: {
        userId: a.id,
        type: "bonus",
        amount: 42,
        description: "welcome bonus",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/users/me/export",
      headers: { authorization: `Bearer ${a.token}` },
    });

    expect(res.statusCode).toBe(200);
    const payload = res.json() as any;
    expect(payload.success).toBe(true);
    expect(payload.data.profile.email).toBe(a.email);
    expect(payload.data.creditTransactions.length).toBeGreaterThanOrEqual(1);
    // Must never leak another user's data.
    expect(JSON.stringify(payload)).not.toContain(b.email);
    expect(JSON.stringify(payload)).not.toContain(b.id);
  });

  it("deletes the account: revokes tokens, anonymizes PII, blocks login", async () => {
    const c = await registerUser("delete-c");

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: c.email, password: c.password },
    });
    expect(login.statusCode).toBe(200);

    const activeJti = await refreshTokenStoreService.getActiveJtiForUser(c.id);
    expect(activeJti).toBeTruthy();

    const del = await app.inject({
      method: "DELETE",
      url: "/users/me",
      headers: { authorization: `Bearer ${c.token}` },
    });
    expect(del.statusCode).toBe(200);

    const dbUser = await app.prisma.user.findUnique({ where: { id: c.id } });
    expect(dbUser?.deletedAt).toBeTruthy();
    expect(dbUser?.email).not.toBe(c.email);
    expect(dbUser?.name).toBe("Usuario eliminado");
    expect(dbUser?.password).toBeNull();
    expect(dbUser?.phone).toBeNull();

    // Sessions revoked.
    expect(
      await refreshTokenStoreService.getActiveJtiForUser(c.id),
    ).toBeNull();
    expect(await refreshTokenStoreService.isJtiRevoked(activeJti!)).toBe(true);

    // Original credentials no longer work.
    const relogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: c.email, password: c.password },
    });
    expect(relogin.statusCode).toBe(401);
  });

  it("is self-only: an admin cannot delete another user via the endpoint", async () => {
    const victim = await registerUser("victim");

    // Build a real admin (approved role) without touching the shared seeded admin.
    const attacker = await registerUser("admin-attacker");
    const adminRole = await app.prisma.role.findUnique({
      where: { name: "admin" },
    });
    await app.prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: attacker.id, roleId: adminRole!.id },
      },
      create: { userId: attacker.id, roleId: adminRole!.id, status: "approved" },
      update: { status: "approved" },
    });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: attacker.email, password: attacker.password },
    });
    expect(adminLogin.statusCode).toBe(200);
    const adminToken = (adminLogin.json() as any).token;
    const adminPayload = app.jwt.decode(adminToken) as any;
    expect(adminPayload.roles).toContain("admin");

    // Attempt to delete the victim by smuggling an id in the body.
    const del = await app.inject({
      method: "DELETE",
      url: "/users/me",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { id: victim.id },
    });
    expect(del.statusCode).toBe(200);

    const victimAfter = await app.prisma.user.findUnique({
      where: { id: victim.id },
    });
    expect(victimAfter?.deletedAt).toBeNull();

    // No arbitrary-target deletion route exists.
    const byId = await app.inject({
      method: "DELETE",
      url: `/users/${victim.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(byId.statusCode).toBe(404);
  });
});
