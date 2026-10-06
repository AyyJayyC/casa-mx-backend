import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import { CREDIT_SPEND_COST } from "../src/services/credits.service.js";

let app: FastifyInstance;

async function register(prefix: string) {
  const email = `test-credits-${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      acceptLegal: true,
      isAdult: true,
      email,
      name: `Credits ${prefix}`,
      password: "Password1",
      roles: ["client"],
    },
  });
  const body = res.json() as any;
  return { id: body.user.id as string, token: body.token as string, email };
}

let sellerToken: string;
let sellerId: string;
let propertyId: string;

describe("B10 - credit spend cost is 10", () => {
  beforeAll(async () => {
    app = await buildApp();
    const seller = await register("seller");
    sellerToken = seller.token;
    sellerId = seller.id;

    const property = await app.prisma.property.create({
      data: {
        title: "B10 Property",
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
      where: { user: { email: { startsWith: "test-credits-" } } },
    });
    await app.prisma.propertyRequest.deleteMany({
      where: { propertyId },
    });
    await app.prisma.creditBalance.deleteMany({ where: { userId: sellerId } });
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-credits-" } },
    });
    await app.close();
  });

  it("exposes a single 10-credit constant", () => {
    expect(CREDIT_SPEND_COST).toBe(10);
  });

  it("deducts exactly 10 credits on unlock", async () => {
    const buyer = await register("buyer");
    const request = await app.prisma.propertyRequest.create({
      data: {
        propertyId,
        buyerId: buyer.id,
        name: "Lead Buyer",
        phone: "5512345678",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: { leadId: request.id, leadType: "request" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.newBalance).toBe(20);

    const dbBalance = await app.prisma.creditBalance.findUnique({
      where: { userId: sellerId },
    });
    expect(dbBalance?.balance).toBe(20);
  });

  it("returns 402 when the balance is below 10", async () => {
    await app.prisma.creditBalance.update({
      where: { userId: sellerId },
      data: { balance: 9 },
    });

    const buyer = await register("broke-buyer");
    const request = await app.prisma.propertyRequest.create({
      data: {
        propertyId,
        buyerId: buyer.id,
        name: "Second Lead",
        phone: "5598765432",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: { leadId: request.id, leadType: "request" },
    });

    expect(res.statusCode).toBe(402);

    const dbBalance = await app.prisma.creditBalance.findUnique({
      where: { userId: sellerId },
    });
    expect(dbBalance?.balance).toBe(9);
  });

  it("returns a plain receipt with no fake CFDI RFC", async () => {
    const txn = await app.prisma.creditTransaction.create({
      data: {
        userId: sellerId,
        type: "purchase",
        amount: 100,
        description: "Compra de prueba",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/credits/invoice/${txn.id}`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.receipt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("XAXX010101000");
  });
});
