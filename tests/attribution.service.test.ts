import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  resolveLeadRouting,
  resolveRefCode,
} from "../src/services/attribution.service.js";

let app: FastifyInstance;

const IDS = {
  seller: "11111111-1111-1111-1111-111111111111",
  buyer: "22222222-2222-2222-2222-222222222222",
  agent: "33333333-3333-3333-3333-333333333333",
};

describe("resolveLeadRouting (pure truth table)", () => {
  it("direct lead (no ref): seller captures, pays, and is the only one notified", () => {
    const r = resolveLeadRouting({
      sellerId: IDS.seller,
      buyerId: IDS.buyer,
      refAgentId: null,
    });
    expect(r).toEqual({
      leadOwnerId: IDS.seller,
      payerId: IDS.seller,
      notifyIds: [IDS.seller],
      captureHeadsUp: false,
    });
  });

  it("referred lead: referring agent pays and is the only notified party; seller gets a neutral heads-up", () => {
    const r = resolveLeadRouting({
      sellerId: IDS.seller,
      buyerId: IDS.buyer,
      refAgentId: IDS.agent,
    });
    expect(r).toEqual({
      leadOwnerId: IDS.seller,
      payerId: IDS.agent,
      notifyIds: [IDS.agent],
      captureHeadsUp: true,
    });
  });

  it("buyer referring themselves is ignored → direct lead", () => {
    const r = resolveLeadRouting({
      sellerId: IDS.seller,
      buyerId: IDS.buyer,
      refAgentId: IDS.buyer,
    });
    expect(r.payerId).toBe(IDS.seller);
    expect(r.captureHeadsUp).toBe(false);
    expect(r.notifyIds).toEqual([IDS.seller]);
  });

  it("seller referring themselves is ignored → direct lead", () => {
    const r = resolveLeadRouting({
      sellerId: IDS.seller,
      buyerId: IDS.buyer,
      refAgentId: IDS.seller,
    });
    expect(r.payerId).toBe(IDS.seller);
    expect(r.notifyIds).toEqual([IDS.seller]);
    expect(r.captureHeadsUp).toBe(false);
  });
});

describe("resolveRefCode", () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.prisma.userRole.deleteMany({
      where: { user: { email: { startsWith: "test-attrib-" } } },
    });
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-attrib-" } },
    });
    await app.close();
  });

  async function makeUser(email: string, roles: string[], code: string) {
    const user = await app.prisma.user.create({
      data: {
        email,
        name: email,
        emailVerified: true,
        referralCode: code,
      },
    });
    for (const name of roles) {
      const role =
        (await app.prisma.role.findUnique({ where: { name } })) ||
        (await app.prisma.role.create({ data: { name } }));
      await app.prisma.userRole.create({
        data: { userId: user.id, roleId: role.id, status: "approved" },
      });
    }
    return user;
  }

  it("returns the agent id for a valid active agent code", async () => {
    const agent = await makeUser("test-attrib-agent@example.com", ["agent"], "AGT123");
    const id = await resolveRefCode(app.prisma, "AGT123", null);
    expect(id).toBe(agent.id);
  });

  it("ignores null / unknown / non-agent codes", async () => {
    expect(await resolveRefCode(app.prisma, null, null)).toBeNull();
    expect(await resolveRefCode(app.prisma, "NOPE", null)).toBeNull();
    const client = await makeUser(
      "test-attrib-client@example.com",
      ["client"],
      "CLI123",
    );
    expect(await resolveRefCode(app.prisma, "CLI123", null)).toBeNull();
    expect(client.id).toBeTruthy();
  });

  it("excludes the property's own seller code", async () => {
    const seller = await makeUser(
      "test-attrib-seller@example.com",
      ["agent", "owner"],
      "SELL123",
    );
    const property = await app.prisma.property.create({
      data: {
        title: "Attrib Property",
        listingType: "for_sale",
        status: "disponible",
        visibility: "public",
        estado: "CDMX",
        sellerId: seller.id,
      },
    });
    expect(await resolveRefCode(app.prisma, "SELL123", property.id)).toBeNull();
    await app.prisma.property.deleteMany({ where: { sellerId: seller.id } });
  });
});
