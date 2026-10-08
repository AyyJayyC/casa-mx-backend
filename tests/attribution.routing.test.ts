import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;

// Users created directly so we control roles + referralCode.
let sellerId: string;
let agentId: string;
let buyerId: string;
let buyerToken: string;

const AGENT_CODE = "REFAGENT1";
const OWNER_CODE = "REFOWNER1";

async function assignRole(userId: string, name: string) {
  const role =
    (await app.prisma.role.findUnique({ where: { name } })) ||
    (await app.prisma.role.create({ data: { name } }));
  await app.prisma.userRole.create({
    data: { userId, roleId: role.id, status: "approved" },
  });
}

async function makeProperty() {
  return app.prisma.property.create({
    data: {
      title: "Attrib Routing Property",
      listingType: "for_sale",
      price: 1000000,
      status: "disponible",
      visibility: "public",
      estado: "CDMX",
      sellerId,
    },
  });
}

describe("lead attribution routing", () => {
  beforeAll(async () => {
    app = await buildApp();

    const suffix = `${Date.now()}`;
    const seller = await app.prisma.user.create({
      data: {
        email: `test-routing-seller-${suffix}@example.com`,
        name: "Routing Seller",
        emailVerified: true,
        referralCode: OWNER_CODE,
      },
    });
    sellerId = seller.id;
    await assignRole(sellerId, "owner");

    const agent = await app.prisma.user.create({
      data: {
        email: `test-routing-agent-${suffix}@example.com`,
        name: "Routing Agent",
        emailVerified: true,
        referralCode: AGENT_CODE,
      },
    });
    agentId = agent.id;
    await assignRole(agentId, "agent");

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true,
        isAdult: true,
        email: `test-routing-buyer-${suffix}@example.com`,
        name: "Routing Buyer",
        password: "Password1",
        roles: ["client"],
      },
    });
    const body = reg.json() as any;
    buyerId = body.user.id;
    buyerToken = body.token;
  });

  afterAll(async () => {
    await app.prisma.notification.deleteMany({
      where: {
        userId: { in: [sellerId, agentId, buyerId].filter(Boolean) },
      },
    });
    await app.prisma.referralEvent.deleteMany({
      where: { referrerId: agentId },
    });
    await app.prisma.propertyOffer.deleteMany({ where: { buyerId } });
    await app.prisma.propertyRequest.deleteMany({ where: { buyerId } });
    await app.prisma.property.deleteMany({ where: { sellerId } });
    await app.prisma.userRole.deleteMany({
      where: { userId: { in: [sellerId, agentId].filter(Boolean) } },
    });
    await app.prisma.user.deleteMany({
      where: { id: { in: [sellerId, agentId, buyerId].filter(Boolean) } },
    });
    await app.close();
  });

  const offerPayload = {
    offerAmount: 950000,
    financing: "cash",
    buyerName: "Routing Buyer",
    buyerEmail: "routing-buyer@example.com",
    buyerPhone: "5512345678",
  };

  it("direct offer notifies seller and leaves attribution columns null", async () => {
    const property = await makeProperty();
    const res = await app.inject({
      method: "POST",
      url: `/properties/${property.id}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: offerPayload,
    });
    expect(res.statusCode).toBe(201);
    const offerId = (res.json() as any).data.id;

    const offer = await app.prisma.propertyOffer.findUnique({
      where: { id: offerId },
    });
    expect(offer?.referringAgentId).toBeNull();
    expect(offer?.attributionCode).toBeNull();
    expect(offer?.attributedAt).toBeNull();

    const sellerNotifs = await app.prisma.notification.findMany({
      where: { userId: sellerId, entityId: offerId },
    });
    expect(sellerNotifs.some((n) => n.type === "offer_received")).toBe(true);
    // No lead_referred noise on a direct lead.
    expect(sellerNotifs.some((n) => n.type === "lead_referred_received")).toBe(
      false,
    );
  });

  it("referred offer stamps columns, notifies ONLY the referring agent with buyer contact, and gives the seller a neutral in-app heads-up", async () => {
    const property = await makeProperty();
    const res = await app.inject({
      method: "POST",
      url: `/properties/${property.id}/offers`,
      headers: {
        authorization: `Bearer ${buyerToken}`,
        cookie: `cmx_ref=${AGENT_CODE}`,
      },
      payload: offerPayload,
    });
    expect(res.statusCode).toBe(201);
    const offerId = (res.json() as any).data.id;

    const offer = await app.prisma.propertyOffer.findUnique({
      where: { id: offerId },
    });
    expect(offer?.referringAgentId).toBe(agentId);
    expect(offer?.attributionCode).toBe(AGENT_CODE);
    expect(offer?.attributedAt).toBeTruthy();

    // ReferralEvent recorded.
    const event = await app.prisma.referralEvent.findFirst({
      where: { referrerId: agentId, eventType: "lead" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.referralCode).toBe(AGENT_CODE);

    // Referring agent gets the buyer's contact.
    const agentNotifs = await app.prisma.notification.findMany({
      where: { userId: agentId, entityId: offerId },
    });
    expect(agentNotifs.some((n) => n.type === "lead_referred")).toBe(true);
    expect(agentNotifs[0]?.message).toContain("routing-buyer@example.com");

    // Capturing agent (seller) gets a neutral, PII-free in-app-only heads-up.
    const sellerNotifs = await app.prisma.notification.findMany({
      where: { userId: sellerId, entityId: offerId },
    });
    expect(sellerNotifs.some((n) => n.type === "lead_referred_received")).toBe(
      true,
    );
    for (const n of sellerNotifs) {
      expect(n.message).not.toContain("routing-buyer@example.com");
      expect(n.message).not.toContain("5512345678");
    }
    // Seller must not get the normal "offer received" with buyer info.
    expect(sellerNotifs.some((n) => n.type === "offer_received")).toBe(false);
  });

  it("invalid ref code is ignored → direct lead", async () => {
    const property = await makeProperty();
    const res = await app.inject({
      method: "POST",
      url: `/properties/${property.id}/offers`,
      headers: {
        authorization: `Bearer ${buyerToken}`,
        cookie: `cmx_ref=DOES_NOT_EXIST`,
      },
      payload: offerPayload,
    });
    expect(res.statusCode).toBe(201);
    const offerId = (res.json() as any).data.id;
    const offer = await app.prisma.propertyOffer.findUnique({
      where: { id: offerId },
    });
    expect(offer?.referringAgentId).toBeNull();
  });

  it("direct request now notifies the seller", async () => {
    const property = await makeProperty();
    const res = await app.inject({
      method: "POST",
      url: `/requests`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: { propertyId: property.id, name: "Routing Buyer", phone: "5512345678" },
    });
    expect(res.statusCode).toBe(201);
    const reqId = (res.json() as any).data.id;

    const sellerNotifs = await app.prisma.notification.findMany({
      where: { userId: sellerId, entityId: reqId },
    });
    expect(sellerNotifs.length).toBeGreaterThan(0);
  });

  it("referred request notifies the referring agent, not the seller's buyer contact", async () => {
    const property = await makeProperty();
    const res = await app.inject({
      method: "POST",
      url: `/requests`,
      headers: {
        authorization: `Bearer ${buyerToken}`,
        cookie: `cmx_ref=${AGENT_CODE}`,
      },
      payload: {
        propertyId: property.id,
        name: "Routing Buyer",
        phone: "5598765432",
      },
    });
    expect(res.statusCode).toBe(201);
    const reqId = (res.json() as any).data.id;

    const req = await app.prisma.propertyRequest.findUnique({
      where: { id: reqId },
    });
    expect(req?.referringAgentId).toBe(agentId);

    const agentNotifs = await app.prisma.notification.findMany({
      where: { userId: agentId, entityId: reqId },
    });
    expect(agentNotifs.some((n) => n.type === "lead_referred")).toBe(true);

    const sellerNotifs = await app.prisma.notification.findMany({
      where: { userId: sellerId, entityId: reqId },
    });
    expect(sellerNotifs.some((n) => n.type === "lead_referred_received")).toBe(
      true,
    );
    for (const n of sellerNotifs) {
      expect(n.message).not.toContain("5598765432");
    }
  });
});
