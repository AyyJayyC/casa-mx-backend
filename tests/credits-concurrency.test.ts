import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;
let sellerToken: string;
let sellerId: string;
let propertyId: string;

async function register(prefix: string) {
  const email = `test-conc-${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      acceptLegal: true,
      isAdult: true,
      email,
      name: `Conc ${prefix}`,
      password: "Password1",
      roles: ["client"],
    },
  });
  const body = res.json() as any;
  return { id: body.user.id as string, token: body.token as string };
}

describe("C10 - concurrent credit spends charge once", () => {
  beforeAll(async () => {
    app = await buildApp();
    const seller = await register("seller");
    sellerToken = seller.token;
    sellerId = seller.id;

    const property = await app.prisma.property.create({
      data: {
        title: "C10 Property",
        listingType: "for_sale",
        price: 1000000,
        status: "disponible",
        visibility: "public",
        estado: "CDMX",
        sellerId,
      },
    });
    propertyId = property.id;

    await app.prisma.creditBalance.create({
      data: { userId: sellerId, balance: 30 },
    });
  });

  afterAll(async () => {
    await app.prisma.creditTransaction.deleteMany({
      where: { user: { email: { startsWith: "test-conc-" } } },
    });
    await app.prisma.propertyRequest.deleteMany({ where: { propertyId } });
    await app.prisma.creditBalance.deleteMany({ where: { userId: sellerId } });
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-conc-" } },
    });
    await app.close();
  });

  it("charges a single time for two parallel spends on the same lead", async () => {
    const buyer = await register("buyer");
    const lead = await app.prisma.propertyRequest.create({
      data: {
        propertyId,
        buyerId: buyer.id,
        name: "Concurrent Lead",
        phone: "5512345678",
      },
    });

    const spend = () =>
      app.inject({
        method: "POST",
        url: "/credits/spend",
        headers: { authorization: `Bearer ${sellerToken}` },
        payload: { leadId: lead.id, leadType: "request" },
      });

    const [a, b] = await Promise.all([spend(), spend()]);

    // Both calls succeed (one may short-circuit as already-unlocked).
    expect([200, 402]).toContain(a.statusCode);
    expect([200, 402]).toContain(b.statusCode);
    expect(
      [a.statusCode, b.statusCode].some((s) => s === 200),
    ).toBe(true);

    const txns = await app.prisma.creditTransaction.findMany({
      where: { userId: sellerId, referenceId: lead.id, type: "spend" },
    });
    expect(txns.length).toBe(1);

    const balance = await app.prisma.creditBalance.findUnique({
      where: { userId: sellerId },
    });
    expect(balance?.balance).toBe(20);
  });

  it("rejects a duplicate spend transaction at the database level", async () => {
    const buyer = await register("dup-buyer");
    const lead = await app.prisma.propertyRequest.create({
      data: {
        propertyId,
        buyerId: buyer.id,
        name: "Duplicate Lead",
        phone: "5598765432",
      },
    });

    await app.prisma.creditTransaction.create({
      data: {
        userId: sellerId,
        type: "spend",
        amount: -10,
        description: "first",
        referenceId: lead.id,
      },
    });

    await expect(
      app.prisma.creditTransaction.create({
        data: {
          userId: sellerId,
          type: "spend",
          amount: -10,
          description: "duplicate",
          referenceId: lead.id,
        },
      }),
    ).rejects.toThrow();
  });
});
