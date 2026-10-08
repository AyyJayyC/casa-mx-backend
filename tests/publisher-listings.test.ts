import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  createPublisherKey,
  cleanupPublisherUsers,
} from "./utils/publisherHelpers.js";

const EMAILS = [
  "pub-listings@casamx.local",
  "pub-listings-other@casamx.local",
];

describe("Publisher API listings", () => {
  let app: FastifyInstance;
  let ownerId = "";
  let otherId = "";
  let key = "";
  let otherKey = "";

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await cleanupPublisherUsers(app, EMAILS);

    const owner = await createPublisherUser(app, {
      email: EMAILS[0],
      roles: ["owner"],
      ineApproved: true,
    });
    ownerId = owner.id;
    const other = await createPublisherUser(app, {
      email: EMAILS[1],
      roles: ["owner"],
      ineApproved: true,
    });
    otherId = other.id;

    key = await createPublisherKey(app, ownerId);
    otherKey = await createPublisherKey(app, otherId);
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
  });

  const auth = (k = key) => ({ "x-api-key": k });

  const createListing = (payload: Record<string, unknown>, k = key) =>
    app.inject({
      method: "POST",
      url: "/publisher/listings",
      headers: auth(k),
      payload,
    });

  const basePayload = (externalId: string) => ({
    externalId,
    title: "Depto Publisher",
    estado: "Jalisco",
    ciudad: "Guadalajara",
    listingType: "for_sale",
    price: 1_500_000,
  });

  it("creates a draft listing owned by the key user", async () => {
    const res = await createListing(basePayload("ext-create"));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("incompleto");
    expect(body.data.visibility).toBe("private");
    expect(body.data.externalId).toBe("ext-create");
    expect(body.data.imageUrls).toEqual([]);

    const row = await app.prisma.property.findUnique({
      where: { id: body.data.id },
    });
    expect(row?.sellerId).toBe(ownerId);
    expect(row?.status).toBe("incompleto");
    expect(row?.visibility).toBe("private");
  });

  it("upserts by (sellerId, externalId) instead of duplicating", async () => {
    const first = await createListing(basePayload("ext-upsert"));
    const second = await createListing({
      ...basePayload("ext-upsert"),
      title: "Depto Publisher Updated",
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);

    const count = await app.prisma.property.count({
      where: { sellerId: ownerId, externalId: "ext-upsert" },
    });
    expect(count).toBe(1);

    const row = await app.prisma.property.findUnique({
      where: { id: first.json().data.id },
    });
    expect(row?.title).toBe("Depto Publisher Updated");
  });

  it("returns 400 on a schema violation", async () => {
    const res = await createListing({
      externalId: "ext-invalid",
      title: "Missing price",
      estado: "Jalisco",
      listingType: "for_sale",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it("re-POSTing an existing externalId does not unpublish a live listing", async () => {
    const created = await createListing(basePayload("ext-relist"));
    const id = created.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: auth(),
      payload: { imageUrls: ["https://files.catbox.moe/a.jpg"] },
    });
    const published = await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/publish`,
      headers: auth(),
    });
    expect(published.json().data.status).toBe("disponible");
    expect(published.json().data.visibility).toBe("public");

    const rePosted = await createListing({
      ...basePayload("ext-relist"),
      title: "Depto Relisted",
      price: 1_650_000,
    });
    expect(rePosted.statusCode).toBe(201);
    expect(rePosted.json().data.id).toBe(id);
    expect(rePosted.json().data.status).toBe("disponible");
    expect(rePosted.json().data.visibility).toBe("public");

    const row = await app.prisma.property.findUnique({ where: { id } });
    expect(row?.status).toBe("disponible");
    expect(row?.visibility).toBe("public");
    expect(row?.title).toBe("Depto Relisted");
    expect(Number(row?.price)).toBe(1_650_000);
  });

  it("replaces images and rejects non-https URLs", async () => {
    const created = await createListing(basePayload("ext-images"));
    const id = created.json().data.id;

    const bad = await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: auth(),
      payload: { imageUrls: ["http://insecure.example.com/a.jpg"] },
    });
    expect(bad.statusCode).toBe(400);

    const many = await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: auth(),
      payload: {
        imageUrls: Array.from(
          { length: 26 },
          (_, i) => `https://files.catbox.moe/img-${i}.jpg`,
        ),
      },
    });
    expect(many.statusCode).toBe(400);

    const ok = await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: auth(),
      payload: {
        imageUrls: [
          "https://files.catbox.moe/a.jpg",
          "https://files.catbox.moe/b.jpg",
        ],
      },
    });
    expect(ok.statusCode).toBe(200);

    const row = await app.prisma.property.findUnique({ where: { id } });
    expect(row?.imageUrls).toEqual([
      "https://files.catbox.moe/a.jpg",
      "https://files.catbox.moe/b.jpg",
    ]);
  });

  it("rejects publishing without images", async () => {
    const created = await createListing(basePayload("ext-noimg"));
    const id = created.json().data.id;

    const res = await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/publish`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("publishes with images, then unpublishes (idempotent)", async () => {
    const created = await createListing(basePayload("ext-publish"));
    const id = created.json().data.id;
    await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: auth(),
      payload: { imageUrls: ["https://files.catbox.moe/a.jpg"] },
    });

    const published = await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/publish`,
      headers: auth(),
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().data.status).toBe("disponible");
    expect(published.json().data.visibility).toBe("public");

    const again = await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/publish`,
      headers: auth(),
    });
    expect(again.statusCode).toBe(200);

    const unpublished = await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/unpublish`,
      headers: auth(),
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json().data.visibility).toBe("private");

    const row = await app.prisma.property.findUnique({ where: { id } });
    expect(row?.visibility).toBe("private");
  });

  it("GET returns the owner draft but 404 for another owner", async () => {
    const created = await createListing(basePayload("ext-get"));
    const id = created.json().data.id;

    const own = await app.inject({
      method: "GET",
      url: `/publisher/listings/${id}`,
      headers: auth(),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.id).toBe(id);

    const foreign = await app.inject({
      method: "GET",
      url: `/publisher/listings/${id}`,
      headers: auth(otherKey),
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("deletes a listing, is idempotent, and 404s for another owner", async () => {
    const created = await createListing(basePayload("ext-delete"));
    const id = created.json().data.id;

    const foreign = await app.inject({
      method: "DELETE",
      url: `/publisher/listings/${id}`,
      headers: auth(otherKey),
    });
    expect(foreign.statusCode).toBe(404);

    const first = await app.inject({
      method: "DELETE",
      url: `/publisher/listings/${id}`,
      headers: auth(),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "DELETE",
      url: `/publisher/listings/${id}`,
      headers: auth(),
    });
    expect(second.statusCode).toBe(200);

    const row = await app.prisma.property.findUnique({ where: { id } });
    expect(row).toBeNull();
  });
});
