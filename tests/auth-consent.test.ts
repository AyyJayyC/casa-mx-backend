import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService, CONSENT_VERSION } from "../src/services/auth.service.js";

describe("Registration consent (A2)", () => {
  let app: FastifyInstance;
  const suffix = Date.now();
  const password = "TestPassword123!";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  it("rejects registration when acceptLegal is false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "No Consent",
        email: `no-consent-${suffix}@test.com`,
        password,
        roles: ["client"],
        acceptLegal: false,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects registration when acceptLegal is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Missing Consent",
        email: `missing-consent-${suffix}@test.com`,
        password,
        roles: ["client"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("persists consent timestamps and version on valid registration", async () => {
    const email = `consent-ok-${suffix}@test.com`;
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Consent OK",
        email,
        password,
        roles: ["client"],
        acceptLegal: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const userId = res.json().user.id;
    createdUserIds.push(userId);

    const row = await app.prisma.user.findUnique({ where: { id: userId } });
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(row?.privacyAcceptedAt).toBeInstanceOf(Date);
    expect(row?.consentVersion).toBe(CONSENT_VERSION);
  });

  it("leaves consent fields null for OAuth signups", async () => {
    const email = `oauth-consent-${suffix}@test.com`;
    const service = new AuthService(app.prisma);
    const user = await service.loginOrCreateOAuthUser({
      provider: "google",
      providerId: `test-provider-${suffix}`,
      email,
      name: "OAuth User",
    });
    createdUserIds.push(user.id);

    const row = await app.prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.termsAcceptedAt).toBeNull();
    expect(row?.privacyAcceptedAt).toBeNull();
    expect(row?.consentVersion).toBeNull();
  });
});
