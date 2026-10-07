import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  createPublisherKey,
  cleanupPublisherUsers,
} from "./utils/publisherHelpers.js";

const EMAILS = ["pub-rate@casamx.local"];

describe("Publisher API per-key rate limits", () => {
  let app: FastifyInstance;
  let key = "";

  beforeAll(async () => {
    // Keep the cap tiny so the test stays fast; overridable via env.
    process.env.PUBLISHER_RATE_CREATE = "3";
    app = await buildApp();
    await app.ready();
    await cleanupPublisherUsers(app, EMAILS);

    const owner = await createPublisherUser(app, {
      email: EMAILS[0],
      roles: ["owner"],
      ineApproved: true,
    });
    key = await createPublisherKey(app, owner.id);
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
    delete process.env.PUBLISHER_RATE_CREATE;
  });

  it("returns 429 with Retry-After once the create cap is exceeded", async () => {
    const headers = { "x-api-key": key };
    const make = (i: number) =>
      app.inject({
        method: "POST",
        url: "/publisher/listings",
        headers,
        payload: {
          externalId: `rate-ext-${i}`,
          title: "Rate limit",
          estado: "Jalisco",
          listingType: "for_sale",
          price: 1_000_000,
        },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await make(i);
      statuses.push(res.statusCode);
      if (i === 3) {
        expect(res.statusCode).toBe(429);
        expect(res.headers["retry-after"]).toBeDefined();
      }
    }

    expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true);
  });
});
