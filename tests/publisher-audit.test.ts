import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  createPublisherKey,
  cleanupPublisherUsers,
} from "./utils/publisherHelpers.js";

const EMAILS = ["pub-audit@casamx.local"];

describe("Publisher API audit logging", () => {
  let app: FastifyInstance;
  let userId = "";
  let key = "";

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await cleanupPublisherUsers(app, EMAILS);

    const owner = await createPublisherUser(app, {
      email: EMAILS[0],
      roles: ["owner"],
      ineApproved: true,
    });
    userId = owner.id;
    key = await createPublisherKey(app, userId);
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
  });

  const actions = async () => {
    const rows = await app.prisma.auditLog.findMany({
      where: { actorUserId: userId, action: { startsWith: "PUBLISHER_" } },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  };

  it("writes an audit row for every mutation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/publisher/listings",
      headers: { "x-api-key": key },
      payload: {
        externalId: "audit-ext",
        title: "Audit",
        estado: "Jalisco",
        listingType: "for_sale",
        price: 1_000_000,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/publisher/listings/${id}/images`,
      headers: { "x-api-key": key },
      payload: { imageUrls: ["https://files.catbox.moe/a.jpg"] },
    });
    await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/publish`,
      headers: { "x-api-key": key },
    });
    await app.inject({
      method: "POST",
      url: `/publisher/listings/${id}/unpublish`,
      headers: { "x-api-key": key },
    });
    await app.inject({
      method: "DELETE",
      url: `/publisher/listings/${id}`,
      headers: { "x-api-key": key },
    });

    const recorded = await actions();
    expect(recorded).toContain("PUBLISHER_CREATE_LISTING");
    expect(recorded).toContain("PUBLISHER_UPDATE_IMAGES");
    expect(recorded).toContain("PUBLISHER_PUBLISH");
    expect(recorded).toContain("PUBLISHER_UNPUBLISH");
    expect(recorded).toContain("PUBLISHER_DELETE");
  });
});
