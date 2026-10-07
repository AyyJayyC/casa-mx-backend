import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import { getCookie } from "./utils/authHelpers.js";

/**
 * CSRF enforcement. The test env disables security for the rest of the suite,
 * so this file forces it back on.
 */
describe("CSRF protection", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ forceSecurity: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const analyticsPayload = { eventName: "csrf_probe" };

  /** Obtain CSRF cookies from a GET, then log in as the seeded buyer. */
  async function bootstrap() {
    const seed = await app.inject({ method: "GET", url: "/health" });
    const seedSecret = getCookie(seed, "_csrf");
    const seedToken = getCookie(seed, "csrfToken");

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { cookie: `_csrf=${seedSecret}`, "x-csrf-token": seedToken },
      payload: { email: "buyer@casamx.local", password: "buyer123" },
    });

    return {
      login,
      accessToken: getCookie(login, "accessToken"),
      refreshToken: getCookie(login, "refreshToken"),
      secret: getCookie(login, "_csrf") ?? seedSecret,
      token: getCookie(login, "csrfToken") ?? seedToken,
    };
  }

  it("rejects a mutating request without a token", async () => {
    const { accessToken } = await bootstrap();

    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: analyticsPayload,
    });

    expect(res.statusCode).toBe(403);
  });

  it("accepts a mutating request that carries the issued token", async () => {
    const { accessToken, secret, token } = await bootstrap();

    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: `_csrf=${secret}`,
        "x-csrf-token": token,
      },
      payload: analyticsPayload,
    });

    expect(res.statusCode).toBe(201);
  });

  it("exempts the signature-verified Stripe webhook", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/credits/webhook",
      payload: {},
    });

    expect(res.statusCode).not.toBe(403);
  });

  it("keeps login -> refresh -> offer submit working with a token", async () => {
    const { login, accessToken, refreshToken, secret, token } =
      await bootstrap();
    expect(login.statusCode).toBe(200);
    expect(accessToken).toBeTruthy();

    const refresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: `refreshToken=${refreshToken}; _csrf=${secret}`,
        "x-csrf-token": token,
      },
    });
    expect(refresh.statusCode).toBe(200);

    const seller = await app.prisma.user.findUnique({
      where: { email: "seller@casamx.local" },
      select: { id: true },
    });
    const property = await app.prisma.property.create({
      data: {
        title: "CSRF Offer Property",
        listingType: "for_sale",
        price: 1_000_000,
        status: "available",
        estado: "Jalisco",
        sellerId: seller!.id,
      },
    });

    try {
      const offer = await app.inject({
        method: "POST",
        url: `/properties/${property.id}/offers`,
        headers: {
          authorization: `Bearer ${accessToken}`,
          cookie: `_csrf=${secret}`,
          "x-csrf-token": token,
        },
        payload: {
          offerAmount: 900_000,
          financing: "cash",
          buyerName: "Test Buyer",
          buyerEmail: "buyer@casamx.local",
          buyerPhone: "5551234567",
        },
      });

      expect(offer.statusCode).toBe(201);
    } finally {
      await app.prisma.propertyOffer.deleteMany({
        where: { propertyId: property.id },
      });
      await app.prisma.property.delete({ where: { id: property.id } });
    }
  });
});
