import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;

let sellerId: string;
let sellerToken: string;
let agentId: string;
let agentToken: string;
let buyerId: string;
let buyerToken: string;
let propertyId: string;

const AGENT_CODE = "PAYERAGENT";

async function assignRole(userId: string, name: string) {
  const role =
    (await app.prisma.role.findUnique({ where: { name } })) ||
    (await app.prisma.role.create({ data: { name } }));
  await app.prisma.userRole.create({
    data: { userId, roleId: role.id, status: "approved" },
  });
}

async function referredOffer() {
  const res = await app.inject({
    method: "POST",
    url: `/properties/${propertyId}/offers`,
    headers: {
      authorization: `Bearer ${buyerToken}`,
      cookie: `cmx_ref=${AGENT_CODE}`,
    },
    payload: {
      offerAmount: 900000,
      financing: "cash",
      buyerName: "Payer Buyer",
      buyerEmail: "payer-buyer@example.com",
      buyerPhone: "5512340000",
    },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as any).data.id as string;
}

describe("credits payer follows the lead's referring agent", () => {
  beforeAll(async () => {
    app = await buildApp();
    const suffix = `${Date.now()}`;

    const seller = await app.prisma.user.create({
      data: {
        email: `test-payer-seller-${suffix}@example.com`,
        name: "Payer Seller",
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    await assignRole(sellerId, "owner");
    sellerToken = app.jwt.sign({ id: sellerId, email: seller.email, roles: ["owner"] });
    await app.prisma.creditBalance.create({ data: { userId: sellerId, balance: 30 } });

    const agent = await app.prisma.user.create({
      data: {
        email: `test-payer-agent-${suffix}@example.com`,
        name: "Payer Agent",
        emailVerified: true,
        referralCode: AGENT_CODE,
      },
    });
    agentId = agent.id;
    await assignRole(agentId, "agent");
    agentToken = app.jwt.sign({ id: agentId, email: agent.email, roles: ["agent"] });
    await app.prisma.creditBalance.create({ data: { userId: agentId, balance: 30 } });

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true,
        isAdult: true,
        email: `test-payer-buyer-${suffix}@example.com`,
        name: "Payer Buyer",
        password: "Password1",
        roles: ["client"],
      },
    });
    buyerId = (reg.json() as any).user.id;
    buyerToken = (reg.json() as any).token;

    const property = await app.prisma.property.create({
      data: {
        title: "Payer Property",
        listingType: "for_sale",
        price: 1000000,
        status: "disponible",
        visibility: "public",
        estado: "CDMX",
        sellerId,
      },
    });
    propertyId = property.id;
  });

  afterAll(async () => {
    await app.prisma.creditTransaction.deleteMany({
      where: { userId: { in: [sellerId, agentId] } },
    });
    await app.prisma.creditBalance.deleteMany({
      where: { userId: { in: [sellerId, agentId] } },
    });
    await app.prisma.notification.deleteMany({
      where: { userId: { in: [sellerId, agentId, buyerId].filter(Boolean) } },
    });
    await app.prisma.referralEvent.deleteMany({ where: { referrerId: agentId } });
    await app.prisma.propertyOffer.deleteMany({ where: { propertyId } });
    await app.prisma.property.deleteMany({ where: { sellerId } });
    await app.prisma.userRole.deleteMany({
      where: { userId: { in: [sellerId, agentId].filter(Boolean) } },
    });
    await app.prisma.user.deleteMany({
      where: { id: { in: [sellerId, agentId, buyerId].filter(Boolean) } },
    });
    await app.close();
  });

  it("403s the capturing agent when the lead is referred (they are not the payer)", async () => {
    const offerId = await referredOffer();
    const res = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: { leadId: offerId, leadType: "offer" },
    });
    expect(res.statusCode).toBe(403);

    const sellerBalance = await app.prisma.creditBalance.findUnique({
      where: { userId: sellerId },
    });
    expect(sellerBalance?.balance).toBe(30);
  });

  it("charges the referring agent and is idempotent", async () => {
    const offerId = await referredOffer();

    const first = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { leadId: offerId, leadType: "offer" },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as any).newBalance).toBe(20);

    const agentBalance = await app.prisma.creditBalance.findUnique({
      where: { userId: agentId },
    });
    expect(agentBalance?.balance).toBe(20);

    const second = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { leadId: offerId, leadType: "offer" },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as any).alreadyUnlocked).toBe(true);

    const after = await app.prisma.creditBalance.findUnique({
      where: { userId: agentId },
    });
    expect(after?.balance).toBe(20);
  });

  it("402s the referring agent when their balance is below the cost", async () => {
    await app.prisma.creditBalance.update({
      where: { userId: agentId },
      data: { balance: 9 },
    });
    const offerId = await referredOffer();

    const res = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${agentToken}` },
      payload: { leadId: offerId, leadType: "offer" },
    });
    expect(res.statusCode).toBe(402);

    await app.prisma.creditBalance.update({
      where: { userId: agentId },
      data: { balance: 30 },
    });
  });

  it("keeps the seller as payer for direct leads", async () => {
    const direct = await app.inject({
      method: "POST",
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        offerAmount: 880000,
        financing: "cash",
        buyerName: "Payer Buyer",
        buyerEmail: "direct-payer@example.com",
        buyerPhone: "5599990000",
      },
    });
    const offerId = (direct.json() as any).data.id;

    const res = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: { leadId: offerId, leadType: "offer" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).newBalance).toBe(20);
  });
});
