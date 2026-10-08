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

const AGENT_CODE = "PIIAGENT";

async function assignRole(userId: string, name: string, status = "approved") {
  const role =
    (await app.prisma.role.findUnique({ where: { name } })) ||
    (await app.prisma.role.create({ data: { name } }));
  await app.prisma.userRole.create({
    data: { userId, roleId: role.id, status },
  });
}

describe("PII firewall for referred leads", () => {
  beforeAll(async () => {
    app = await buildApp();
    const suffix = `${Date.now()}`;

    const seller = await app.prisma.user.create({
      data: {
        email: `test-pii-seller-${suffix}@example.com`,
        name: "PII Seller",
        emailVerified: true,
        whatsapp: "+525511112222",
      },
    });
    sellerId = seller.id;
    await assignRole(sellerId, "owner");
    sellerToken = app.jwt.sign({ id: sellerId, email: seller.email, roles: ["owner"] });
    await app.prisma.creditBalance.create({
      data: { userId: sellerId, balance: 100 },
    });

    const agent = await app.prisma.user.create({
      data: {
        email: `test-pii-agent-${suffix}@example.com`,
        name: "PII Agent",
        emailVerified: true,
        referralCode: AGENT_CODE,
      },
    });
    agentId = agent.id;
    await assignRole(agentId, "agent");
    agentToken = app.jwt.sign({ id: agentId, email: agent.email, roles: ["agent"] });

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true,
        isAdult: true,
        email: `test-pii-buyer-${suffix}@example.com`,
        name: "PII Buyer",
        password: "Password1",
        roles: ["client"],
      },
    });
    buyerId = (reg.json() as any).user.id;
    buyerToken = (reg.json() as any).token;

    const property = await app.prisma.property.create({
      data: {
        title: "PII Firewall Property",
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
    await app.prisma.creditTransaction.deleteMany({ where: { userId: sellerId } });
    await app.prisma.creditBalance.deleteMany({ where: { userId: sellerId } });
    await app.prisma.notification.deleteMany({
      where: { userId: { in: [sellerId, agentId, buyerId].filter(Boolean) } },
    });
    await app.prisma.referralEvent.deleteMany({ where: { referrerId: agentId } });
    await app.prisma.propertyOffer.deleteMany({ where: { propertyId } });
    await app.prisma.propertyRequest.deleteMany({ where: { propertyId } });
    await app.prisma.property.deleteMany({ where: { sellerId } });
    await app.prisma.userRole.deleteMany({
      where: { userId: { in: [sellerId, agentId].filter(Boolean) } },
    });
    await app.prisma.user.deleteMany({
      where: { id: { in: [sellerId, agentId, buyerId].filter(Boolean) } },
    });
    await app.close();
  });

  // ── offers ────────────────────────────────────────────────────────────────

  let directOfferId: string;
  let referredOfferId: string;

  it("creates a direct offer (no ref) and a referred offer", async () => {
    const direct = await app.inject({
      method: "POST",
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        offerAmount: 900000,
        financing: "cash",
        buyerName: "PII Buyer",
        buyerEmail: "direct-offer@example.com",
        buyerPhone: "5511110000",
      },
    });
    expect(direct.statusCode).toBe(201);
    directOfferId = (direct.json() as any).data.id;

    const referred = await app.inject({
      method: "POST",
      url: `/properties/${propertyId}/offers`,
      headers: {
        authorization: `Bearer ${buyerToken}`,
        cookie: `cmx_ref=${AGENT_CODE}`,
      },
      payload: {
        offerAmount: 910000,
        financing: "cash",
        buyerName: "PII Buyer",
        buyerEmail: "referred-offer@example.com",
        buyerPhone: "5522220000",
      },
    });
    expect(referred.statusCode).toBe(201);
    referredOfferId = (referred.json() as any).data.id;
  });

  it("seller's offer list redacts buyer PII until the direct lead is unlocked, and ALWAYS redacts referred leads", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/offers/seller",
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(before.statusCode).toBe(200);
    const beforeOffers = (before.json() as any).data;
    const directBefore = beforeOffers.find((o: any) => o.id === directOfferId);
    const referredBefore = beforeOffers.find((o: any) => o.id === referredOfferId);
    expect(directBefore.buyerEmail).toBeNull();
    expect(directBefore.buyerPhone).toBeNull();
    expect(referredBefore.buyerEmail).toBeNull();
    expect(referredBefore.buyerPhone).toBeNull();
    // The seller can still see who referred it (agent identity, not buyer PII).
    expect(referredBefore.referringAgentId).toBe(agentId);

    // Unlock the direct lead.
    const spend = await app.inject({
      method: "POST",
      url: "/credits/spend",
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: { leadId: directOfferId, leadType: "offer" },
    });
    expect(spend.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/offers/seller",
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    const afterOffers = (after.json() as any).data;
    const directAfter = afterOffers.find((o: any) => o.id === directOfferId);
    const referredAfter = afterOffers.find((o: any) => o.id === referredOfferId);
    expect(directAfter.buyerEmail).toBe("direct-offer@example.com");
    // Referred lead stays redacted for the capturing agent even after a spend attempt.
    expect(referredAfter.buyerEmail).toBeNull();
    expect(referredAfter.buyerPhone).toBeNull();
  });

  it("seller cannot see referred buyer PII via the per-property offer list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const referred = (res.json() as any).data.find(
      (o: any) => o.id === referredOfferId,
    );
    expect(referred.buyerEmail).toBeNull();
    expect(referred.buyerPhone).toBeNull();
  });

  // ── requests ──────────────────────────────────────────────────────────────

  it("seller's request list redacts referred buyer PII", async () => {
    const referred = await app.inject({
      method: "POST",
      url: `/requests`,
      headers: {
        authorization: `Bearer ${buyerToken}`,
        cookie: `cmx_ref=${AGENT_CODE}`,
      },
      payload: { propertyId, name: "Referred Req Buyer", phone: "5533330000" },
    });
    expect(referred.statusCode).toBe(201);

    const res = await app.inject({
      method: "GET",
      url: "/requests/seller",
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as any).data.find(
      (r: any) => r.phone === null && r.name === null && r.referringAgentId === agentId,
    );
    expect(row).toBeTruthy();
    expect(row.referringAgentId).toBe(agentId);
  });

  // ── referring agent endpoints ─────────────────────────────────────────────

  it("referring agent's /leads/referred exposes buyer contact + capturing agent contact", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leads/referred",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as any).data;
    const offer = data.offers.find((o: any) => o.id === referredOfferId);
    expect(offer).toBeTruthy();
    expect(offer.buyerEmail).toBe("referred-offer@example.com");
    expect(offer.buyerPhone).toBe("5522220000");
    expect(offer.capturingAgent?.name).toBe("PII Seller");
    expect(offer.capturingAgent?.whatsapp).toBe("+525511112222");
  });

  it("referring agent can fetch the capturing agent counterparty (one-way)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leads/offer/${referredOfferId}/counterparty`,
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(res.statusCode).toBe(200);
    const cp = (res.json() as any).data;
    expect(cp.name).toBe("PII Seller");
    expect(cp.whatsapp).toBe("+525511112222");
  });

  it("the capturing agent is 403 when fetching the referring agent's counterparty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leads/offer/${referredOfferId}/counterparty`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("the direct lead's buyer is not exposed through /leads/referred", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/leads/referred",
      headers: { authorization: `Bearer ${agentToken}` },
    });
    const offers = (res.json() as any).data.offers;
    expect(offers.some((o: any) => o.id === directOfferId)).toBe(false);
  });
});
