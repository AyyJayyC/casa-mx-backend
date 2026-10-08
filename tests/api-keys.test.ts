import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { FastifyInstance } from "fastify";
import {
  createPublisherUser,
  cleanupPublisherUsers,
} from "./utils/publisherHelpers.js";

/**
 * Self-serve API key management: /users/me/api-keys.
 *
 * These routes are cookie/bearer authenticated (NOT the X-API-Key publisher
 * API) and therefore must remain CSRF-protected. The key itself is returned
 * exactly once on creation; only its sha256 hash is persisted.
 */

const EMAILS = [
  "api-keys-owner@casamx.local",
  "api-keys-other@casamx.local",
  "api-keys-noine@casamx.local",
  "api-keys-client@casamx.local",
];

describe("API key management (/users/me/api-keys)", () => {
  let app: FastifyInstance;
  let owner: { id: string };
  let other: { id: string };
  let noIne: { id: string };
  let client: { id: string };
  let ownerToken: string;
  let otherToken: string;
  let noIneToken: string;
  let clientToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await cleanupPublisherUsers(app, EMAILS);

    owner = await createPublisherUser(app, {
      email: EMAILS[0],
      roles: ["owner"],
      ineApproved: true,
    });
    other = await createPublisherUser(app, {
      email: EMAILS[1],
      roles: ["owner"],
      ineApproved: true,
    });
    noIne = await createPublisherUser(app, {
      email: EMAILS[2],
      roles: ["owner"],
      ineApproved: false,
    });
    client = await createPublisherUser(app, {
      email: EMAILS[3],
      roles: ["client"],
      ineApproved: true,
    });

    ownerToken = app.jwt.sign({ id: owner.id, email: EMAILS[0], roles: ["owner"] });
    otherToken = app.jwt.sign({ id: other.id, email: EMAILS[1], roles: ["owner"] });
    noIneToken = app.jwt.sign({ id: noIne.id, email: EMAILS[2], roles: ["owner"] });
    clientToken = app.jwt.sign({ id: client.id, email: EMAILS[3], roles: ["client"] });
  });

  afterAll(async () => {
    await cleanupPublisherUsers(app, EMAILS);
    await app.close();
  });

  it("401 without authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users/me/api-keys",
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a key, returns the raw value once, stores only the hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(ownerToken),
      payload: { label: "Pipeline Hermosillo" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBeTruthy();
    expect(body.data.label).toBe("Pipeline Hermosillo");
    expect(body.data.key).toMatch(/^cmx_pub_/);
    expect(body.data.prefix).toBe(body.data.key.slice(0, 12));

    const row = await app.prisma.publisherApiKey.findFirst({
      where: { userId: owner.id, label: "Pipeline Hermosillo" },
    });
    expect(row).toBeTruthy();
    expect(row!.keyHash).toHaveLength(64);
    expect(row!.keyPrefix).toBe(body.data.key.slice(0, 12));
    // The raw key must never be persisted anywhere on the row.
    expect(JSON.stringify(row)).not.toContain(body.data.key);
    expect(row!.keyHash).toBe(
      createHash("sha256").update(body.data.key).digest("hex"),
    );
  });

  it("lists only metadata — never the key or hash", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users/me/api-keys",
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const k of body.data) {
      expect(k).not.toHaveProperty("key");
      expect(k).not.toHaveProperty("keyHash");
      expect(k.id).toBeTruthy();
      expect(k.label).toBeTruthy();
      expect(k.keyPrefix).toMatch(/^cmx_pub_/);
    }
    // Only the requester's own keys are listed.
    const all = body.data as Array<{ id: string }>;
    const otherRows = await app.prisma.publisherApiKey.count({
      where: { userId: other.id },
    });
    expect(otherRows).toBe(0);
    expect(all.length).toBe(
      await app.prisma.publisherApiKey.count({ where: { userId: owner.id } }),
    );
  });

  it("rejects labels outside 1–60 characters", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(ownerToken),
      payload: { label: "" },
    });
    expect(empty.statusCode).toBe(400);

    const tooLong = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(ownerToken),
      payload: { label: "x".repeat(61) },
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it("allows creation without a verified INE but returns a warning", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(noIneToken),
      payload: { label: "No INE yet" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as any;
    expect(body.data.key).toMatch(/^cmx_pub_/);
    expect(typeof body.data.warning).toBe("string");
    expect(body.data.warning.length).toBeGreaterThan(0);
  });

  it("forbids users without a publisher role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(clientToken),
      payload: { label: "Nope" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("revokes an owned key and is idempotent", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(ownerToken),
      payload: { label: "To revoke" },
    });
    const keyId = (created.json() as any).data.id;

    const first = await app.inject({
      method: "DELETE",
      url: `/users/me/api-keys/${keyId}`,
      headers: auth(ownerToken),
    });
    expect(first.statusCode).toBe(200);

    const row = await app.prisma.publisherApiKey.findUnique({
      where: { id: keyId },
    });
    expect(row!.active).toBe(false);
    expect(row!.revokedAt).toBeTruthy();

    const second = await app.inject({
      method: "DELETE",
      url: `/users/me/api-keys/${keyId}`,
      headers: auth(ownerToken),
    });
    expect(second.statusCode).toBe(200);
  });

  it("cannot revoke another user's key (404)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/users/me/api-keys",
      headers: auth(otherToken),
      payload: { label: "Other key" },
    });
    const keyId = (created.json() as any).data.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/users/me/api-keys/${keyId}`,
      headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(404);

    const row = await app.prisma.publisherApiKey.findUnique({
      where: { id: keyId },
    });
    expect(row!.active).toBe(true);
    expect(row!.revokedAt).toBeNull();
  });

  it("is CSRF-protected: POST without a token is rejected", async () => {
    const secure = await buildApp({ forceSecurity: true });
    await secure.ready();
    try {
      const token = secure.jwt.sign({
        id: owner.id,
        email: EMAILS[0],
        roles: ["owner"],
      });
      const res = await secure.inject({
        method: "POST",
        url: "/users/me/api-keys",
        headers: { authorization: `Bearer ${token}` },
        payload: { label: "csrf probe" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await secure.close();
    }
  });

  it("rate limits key creation per bucket", async () => {
    process.env.API_KEYS_RATE_CREATE = "3";
    const rl = await buildApp();
    await rl.ready();
    try {
      const token = rl.jwt.sign({
        id: owner.id,
        email: EMAILS[0],
        roles: ["owner"],
      });
      let last = 0;
      for (let i = 0; i < 4; i++) {
        const res = await rl.inject({
          method: "POST",
          url: "/users/me/api-keys",
          headers: { authorization: `Bearer ${token}` },
          payload: { label: `rl-${i}` },
        });
        last = res.statusCode;
        if (i === 3) expect(res.statusCode).toBe(429);
      }
      expect(last).toBe(429);
    } finally {
      await rl.close();
      delete process.env.API_KEYS_RATE_CREATE;
    }
  });
});
