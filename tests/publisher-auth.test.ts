import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  createPublisherKey,
  cleanupPublisherUsers,
  generateRawKey,
  hashPublisherKey,
} from "./utils/publisherHelpers.js";

const EMAILS = [
  "pub-auth-owner@casamx.local",
  "pub-auth-norole@casamx.local",
  "pub-auth-noine@casamx.local",
];

describe("Publisher API authentication", () => {
  let app: FastifyInstance;
  let ownerId = "";
  let listingId = "";
  let noIneListingId = "";
  let ownerKey = "";
  let noRoleKey = "";
  let noIneKey = "";
  let skipIneKey = "";
  let revokedKey = "";
  let expiredKey = "";
  let inactiveKey = "";
  let lastUsedKey = "";

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
    const noRole = await createPublisherUser(app, {
      email: EMAILS[1],
      roles: ["client"],
      ineApproved: true,
    });
    const noIne = await createPublisherUser(app, {
      email: EMAILS[2],
      roles: ["owner"],
      ineApproved: false,
    });

    ownerKey = await createPublisherKey(app, ownerId, { label: "owner" });
    noRoleKey = await createPublisherKey(app, noRole.id, { label: "norole" });
    noIneKey = await createPublisherKey(app, noIne.id, { label: "noine" });
    skipIneKey = await createPublisherKey(app, noIne.id, {
      label: "skipine",
      skipIne: true,
    });
    revokedKey = await createPublisherKey(app, ownerId, {
      label: "revoked",
      revokedAt: new Date(),
    });
    expiredKey = await createPublisherKey(app, ownerId, {
      label: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    inactiveKey = await createPublisherKey(app, ownerId, {
      label: "inactive",
      active: false,
    });
    lastUsedKey = await createPublisherKey(app, ownerId, { label: "lastused" });

    const listing = await app.prisma.property.create({
      data: { title: "Auth listing", estado: "Jalisco", sellerId: ownerId },
    });
    listingId = listing.id;

    const noIneListing = await app.prisma.property.create({
      data: { title: "Auth noine listing", estado: "Jalisco", sellerId: noIne.id },
    });
    noIneListingId = noIneListing.id;
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
  });

  const get = (headers: Record<string, string> = {}, id = listingId) =>
    app.inject({
      method: "GET",
      url: `/publisher/listings/${id}`,
      headers,
    });

  it("401 when the key header is missing", async () => {
    const res = await get();
    expect(res.statusCode).toBe(401);
    expect(res.json().success).toBe(false);
  });

  it("401 for a malformed key", async () => {
    const res = await get({ "x-api-key": "not-a-cmx-key" });
    expect(res.statusCode).toBe(401);
  });

  it("401 for an unknown key", async () => {
    const res = await get({ "x-api-key": generateRawKey() });
    expect(res.statusCode).toBe(401);
  });

  it("401 for a revoked key", async () => {
    const res = await get({ "x-api-key": revokedKey });
    expect(res.statusCode).toBe(401);
  });

  it("401 for an expired key", async () => {
    const res = await get({ "x-api-key": expiredKey });
    expect(res.statusCode).toBe(401);
  });

  it("401 for an inactive key", async () => {
    const res = await get({ "x-api-key": inactiveKey });
    expect(res.statusCode).toBe(401);
  });

  it("200 for a valid key on an owned listing", async () => {
    const res = await get({ "x-api-key": ownerKey });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(listingId);
  });

  it("403 when the key owner lacks a publisher role", async () => {
    const res = await get({ "x-api-key": noRoleKey });
    expect(res.statusCode).toBe(403);
  });

  it("403 when the key owner has no approved INE", async () => {
    const res = await get({ "x-api-key": noIneKey });
    expect(res.statusCode).toBe(403);
  });

  it("200 with an approved INE when PUBLISHER_REQUIRE_INE=false", async () => {
    process.env.PUBLISHER_REQUIRE_INE = "false";
    try {
      const res = await get({ "x-api-key": noIneKey }, noIneListingId);
      expect(res.statusCode).toBe(200);
    } finally {
      delete process.env.PUBLISHER_REQUIRE_INE;
    }
  });

  it("200 when the key skips INE verification", async () => {
    const res = await get({ "x-api-key": skipIneKey }, noIneListingId);
    expect(res.statusCode).toBe(200);
  });

  it("updates lastUsedAt on a successful call", async () => {
    const hash = hashPublisherKey(lastUsedKey);
    const before = await app.prisma.publisherApiKey.findUnique({
      where: { keyHash: hash },
      select: { lastUsedAt: true },
    });
    expect(before?.lastUsedAt).toBeNull();

    const res = await get({ "x-api-key": lastUsedKey });
    expect(res.statusCode).toBe(200);

    // The stamp is written fire-and-forget; poll briefly for it to land.
    let after = await app.prisma.publisherApiKey.findUnique({
      where: { keyHash: hash },
      select: { lastUsedAt: true },
    });
    for (let i = 0; i < 20 && !after?.lastUsedAt; i++) {
      await new Promise((r) => setTimeout(r, 50));
      after = await app.prisma.publisherApiKey.findUnique({
        where: { keyHash: hash },
        select: { lastUsedAt: true },
      });
    }
    expect(after?.lastUsedAt).not.toBeNull();
  });
});
