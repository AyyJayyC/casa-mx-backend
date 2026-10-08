import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  createPublisherKey,
  cleanupPublisherUsers,
} from "./utils/publisherHelpers.js";

const EMAILS = ["pub-csrf@casamx.local"];

/**
 * The Publisher API authenticates with X-API-Key and carries no cookies, so it
 * must be CSRF-exempt. Existing cookie-authenticated routes must stay protected.
 */
describe("Publisher API CSRF exemption", () => {
  let app: FastifyInstance;
  let key = "";
  let ownerId = "";

  beforeAll(async () => {
    app = await buildApp({ forceSecurity: true });
    await app.ready();
    await cleanupPublisherUsers(app, EMAILS);

    const owner = await createPublisherUser(app, {
      email: EMAILS[0],
      roles: ["owner"],
      ineApproved: true,
    });
    ownerId = owner.id;
    key = await createPublisherKey(app, ownerId);
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
  });

  it("accepts a key-authenticated POST without a CSRF token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/publisher/listings",
      headers: { "x-api-key": key },
      payload: {
        externalId: "csrf-ext",
        title: "CSRF exempt",
        estado: "Jalisco",
        listingType: "for_sale",
        price: 1_000_000,
      },
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(201);
  });

  it("still rejects POST /properties without a CSRF token", async () => {
    const token = app.jwt.sign({
      id: ownerId,
      email: EMAILS[0],
      roles: ["owner"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/properties",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "No csrf",
        estado: "Jalisco",
        listingType: "for_sale",
        price: 1_000_000,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
