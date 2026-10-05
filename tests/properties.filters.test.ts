import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { registerUser } from "./utils/authHelpers.js";

describe("GET /properties — filters, search and caching", () => {
  let app: FastifyInstance;
  let ownerId: string;
  const suffix = Date.now();
  const password = "TestPassword123!";
  const email = `filters-owner-${suffix}@test.com`;
  const searchToken = `Zzq${suffix}`;

  let matchId: string;
  let otherId: string;

  const list = async (qs: string) =>
    app.inject({ method: "GET", url: `/properties?${qs}` });
  const idsFrom = (res: any): string[] =>
    res.json().data.map((p: any) => p.id);

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const owner = await registerUser(app, {
      name: "Filter Owner",
      email,
      password,
    });
    ownerId = owner.id;

    const base = {
      estado: "Jalisco",
      ciudad: "Guadalajara",
      listingType: "for_sale" as const,
      price: 1000000,
      sellerId: ownerId,
      visibility: "public",
    };

    const match = await app.prisma.property.create({
      data: {
        ...base,
        title: `Casa ${searchToken}`,
        colonia: `${searchToken} Colonia`,
        status: "disponible",
        condition: "nuevo",
        petFriendly: true,
        squareMeters: 100,
        lotSize: 200,
        amenities: ["Alberca"],
        includedServices: ["Agua"],
        financeOptions: ["cash"],
      },
    });
    matchId = match.id;

    const other = await app.prisma.property.create({
      data: {
        ...base,
        title: "Otra casa",
        colonia: "Otra colonia",
        status: "preventa",
        condition: "usado",
        petFriendly: false,
        squareMeters: 500,
        lotSize: 1000,
        amenities: ["Gimnasio"],
        includedServices: ["Luz"],
        financeOptions: ["bankLoan"],
      },
    });
    otherId = other.id;
  });

  afterAll(async () => {
    await app.prisma.property.deleteMany({
      where: { id: { in: [matchId, otherId] } },
    });
    await app.prisma.user.deleteMany({ where: { id: ownerId } });
    await app.close();
  });

  it("filters by condition", async () => {
    const ids = idsFrom(await list("condition=nuevo&limit=100"));
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(otherId);
  });

  it("filters by status", async () => {
    const ids = idsFrom(await list("status=disponible&limit=100"));
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(otherId);
  });

  it("filters by petFriendly", async () => {
    const ids = idsFrom(await list("petFriendly=true&limit=100"));
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(otherId);
  });

  it("filters by construction meters range", async () => {
    const big = idsFrom(await list("minConstructionMeters=150&limit=100"));
    expect(big).toContain(otherId);
    expect(big).not.toContain(matchId);

    const small = idsFrom(await list("maxConstructionMeters=150&limit=100"));
    expect(small).toContain(matchId);
    expect(small).not.toContain(otherId);
  });

  it("filters by lot size range", async () => {
    const big = idsFrom(await list("minLotSize=500&limit=100"));
    expect(big).toContain(otherId);
    expect(big).not.toContain(matchId);

    const small = idsFrom(await list("maxLotSize=500&limit=100"));
    expect(small).toContain(matchId);
    expect(small).not.toContain(otherId);
  });

  it("searches title/colonia/ciudad via q", async () => {
    const ids = idsFrom(await list(`q=${searchToken}&limit=100`));
    expect(ids).toContain(matchId);
    expect(ids).not.toContain(otherId);
  });

  it("filters by amenities, services and financing", async () => {
    const amenities = idsFrom(await list("amenities=Alberca&limit=100"));
    expect(amenities).toContain(matchId);
    expect(amenities).not.toContain(otherId);

    const services = idsFrom(await list("services=Agua&limit=100"));
    expect(services).toContain(matchId);
    expect(services).not.toContain(otherId);

    const financing = idsFrom(await list("financing=cash&limit=100"));
    expect(financing).toContain(matchId);
    expect(financing).not.toContain(otherId);
  });

});
