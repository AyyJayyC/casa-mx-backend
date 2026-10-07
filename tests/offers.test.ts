import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
let sellerId: string;

async function makeProperty(status: string) {
  return app.prisma.property.create({
    data: {
      title: "B5 Property",
      listingType: "for_sale",
      price: 1000000,
      status,
      visibility: "public",
      imageUrls: ["https://example.com/a.jpg"],
      estado: "CDMX",
      sellerId,
    },
  });
}

const offerPayload = {
  offerAmount: 950000,
  financing: "cash" as const,
  buyerName: "B5 Buyer",
  buyerEmail: "buyer@example.com",
  buyerPhone: "5512345678",
};

async function submitOffer(propertyId: string) {
  return app.inject({
    method: "POST",
    url: `/properties/${propertyId}/offers`,
    headers: { authorization: `Bearer ${token}` },
    payload: offerPayload,
  });
}

describe("B5 - offers work on published properties", () => {
  beforeAll(async () => {
    app = await buildApp();
    const seller = await app.prisma.user.findUnique({
      where: { email: "seller@casamx.local" },
    });
    sellerId = seller!.id;

    const email = `test-b5-${Date.now()}@example.com`;
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        acceptLegal: true, isAdult: true,
        email,
        name: "B5 Buyer",
        password: "Password1",
        roles: ["client"],
      },
    });
    token = (reg.json() as any).token;
  });

  afterAll(async () => {
    await app.prisma.propertyOffer.deleteMany({
      where: { buyerName: "B5 Buyer" },
    });
    await app.prisma.property.deleteMany({ where: { title: "B5 Property" } });
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-b5-" } },
    });
    await app.close();
  });

  it("accepts an offer on a freshly published ('disponible') property", async () => {
    const property = await makeProperty("disponible");
    const res = await submitOffer(property.id);
    expect(res.statusCode).toBe(201);
  });

  for (const status of ["sold", "vendido", "rentado", "retirado"]) {
    it(`rejects offers on a '${status}' property`, async () => {
      const property = await makeProperty(status);
      const res = await submitOffer(property.id);
      expect(res.statusCode).toBe(400);
    });
  }
});
