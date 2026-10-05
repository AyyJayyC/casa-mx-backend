import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { approveUserRole, loginAndGetToken } from "./utils/authHelpers.js";

const SENSITIVE_KEYS = [
  "address",
  "mapsUrl",
  "inventoryNotes",
  "codigoPostal",
  "sellerId",
  "verificationNote",
  "verificationStatus",
];

describe("Property public/private views (privacy)", () => {
  let app: FastifyInstance;
  let ownerId: string;
  let otherId: string;
  let ownerToken: string;
  let otherToken: string;
  let propertyId: string;
  const suffix = Date.now();
  const password = "TestPassword123!";

  const rawLat = 19.432608;
  const rawLng = -99.133209;
  const roundedLat = 19.433;
  const roundedLng = -99.133;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const ownerEmail = `privacy-owner-${suffix}@test.com`;
    const otherEmail = `privacy-other-${suffix}@test.com`;

    const ownerRes = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Privacy Owner", email: ownerEmail, password, roles: ["owner"] },
    });
    expect(ownerRes.statusCode).toBe(201);
    ownerId = ownerRes.json().user.id;
    await approveUserRole(app, ownerId, "owner");
    ownerToken = await loginAndGetToken(app, ownerEmail, password);

    const otherRes = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Privacy Other", email: otherEmail, password, roles: ["client"] },
    });
    expect(otherRes.statusCode).toBe(201);
    otherId = otherRes.json().user.id;
    otherToken = await loginAndGetToken(app, otherEmail, password);

    const createRes = await app.inject({
      method: "POST",
      url: "/properties",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        title: "Privacy Test Property",
        address: "Av. Reforma 123, Interior 4B",
        estado: "Ciudad de México",
        ciudad: "Ciudad de México",
        colonia: "Juárez",
        codigoPostal: "06600",
        listingType: "for_sale",
        price: 3500000,
        lat: rawLat,
        lng: rawLng,
        imageUrls: ["https://example.com/photo.jpg"],
      },
    });
    expect(createRes.statusCode).toBe(201);
    propertyId = createRes.json().data.id;

    // Populate fields that must never appear in a public view.
    await app.prisma.property.update({
      where: { id: propertyId },
      data: {
        mapsUrl: "https://maps.google.com/?q=secret",
        inventoryNotes: "Llaves con el portero",
        verificationNote: "Internal note about docs",
        verificationStatus: "verified",
      },
    });

    // Ensure the property is a candidate for most-viewed.
    await app.prisma.analyticsEvent.create({
      data: { eventName: "property_view", entityId: propertyId },
    });
  });

  afterAll(async () => {
    await app.prisma.analyticsEvent.deleteMany({ where: { entityId: propertyId } });
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await app.close();
  });

  const expectTrimmed = (p: any) => {
    for (const key of SENSITIVE_KEYS) {
      expect(p).not.toHaveProperty(key);
    }
    expect(p.lat).toBe(roundedLat);
    expect(p.lng).toBe(roundedLng);
    // Non-sensitive fields survive.
    expect(p.title).toBe("Privacy Test Property");
    expect(p.colonia).toBe("Juárez");
  };

  it("anon list excludes sensitive keys and rounds coordinates", async () => {
    const res = await app.inject({ method: "GET", url: "/properties?limit=100" });
    expect(res.statusCode).toBe(200);
    const found = res.json().data.find((p: any) => p.id === propertyId);
    expect(found).toBeDefined();
    expectTrimmed(found);
  });

  it("anon map excludes sensitive keys and rounds coordinates", async () => {
    const res = await app.inject({ method: "GET", url: "/properties/map" });
    expect(res.statusCode).toBe(200);
    const found = res.json().data.find((p: any) => p.id === propertyId);
    expect(found).toBeDefined();
    expectTrimmed(found);
  });

  it("anon detail excludes sensitive keys and rounds coordinates", async () => {
    const res = await app.inject({ method: "GET", url: `/properties/${propertyId}` });
    expect(res.statusCode).toBe(200);
    expectTrimmed(res.json().data);
  });

  it("non-owner authenticated detail is trimmed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/properties/${propertyId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(res.statusCode).toBe(200);
    expectTrimmed(res.json().data);
    void otherId;
  });

  it("owner detail returns the full record", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/properties/${propertyId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.address).toBe("Av. Reforma 123, Interior 4B");
    expect(data.codigoPostal).toBe("06600");
    expect(data.sellerId).toBe(ownerId);
    expect(data.verificationStatus).toBe("verified");
    expect(data.verificationNote).toBe("Internal note about docs");
    expect(data.lat).toBe(rawLat);
  });

  it("most-viewed excludes sensitive keys", async () => {
    const res = await app.inject({ method: "GET", url: "/properties/most-viewed?limit=20" });
    expect(res.statusCode).toBe(200);
    const found = res.json().properties.find((p: any) => p.id === propertyId);
    expect(found).toBeDefined();
    expectTrimmed(found);
  });
});
