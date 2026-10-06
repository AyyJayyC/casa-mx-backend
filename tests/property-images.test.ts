import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";

// Must run before env.ts is imported so R2_PUBLIC_BASE_URL is set.
vi.hoisted(() => {
  process.env.R2_PUBLIC_BASE_URL = "https://pub-test.r2.dev";
});

vi.mock("../src/services/s3.service.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    uploadPublicImage: vi.fn(),
    deletePublicImage: vi.fn(),
    isR2Configured: vi.fn(),
  };
});

import { buildApp } from "../src/app.js";
import {
  uploadPublicImage,
  deletePublicImage,
  isR2Configured,
} from "../src/services/s3.service.js";
import { approveUserRole, loginAndGetToken } from "./utils/authHelpers.js";

const R2_BASE = "https://pub-test.r2.dev";

// Minimal valid WebP header (RIFF magic) + padding so size checks can run.
const WEBP = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46]), Buffer.alloc(64)]);

describe("property image pipeline (R2)", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let ownerToken: string;
  let otherToken: string;
  const createdPropertyIds: string[] = [];
  const createdUserIds: string[] = [];
  const suffix = Date.now();
  const password = "TestPassword123!";

  async function uploadImage(
    propertyId: string,
    token: string,
    content: Buffer,
    mime = "image/webp",
    filename = "photo.webp",
  ) {
    // Real HTTP (not inject): @fastify/multipart's file stream never ends
    // under light-my-request, so we hit a live listener with fetch/FormData.
    const form = new FormData();
    form.append("file", new Blob([content], { type: mime }), filename);
    return fetch(`${baseUrl}/properties/${propertyId}/images`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  }

  async function createProperty(token: string, imageUrls?: string[]) {
    const res = await app.inject({
      method: "POST",
      url: "/properties",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "R2 Image Test " + Math.random().toString(16).slice(2),
        estado: "Ciudad de México",
        listingType: "for_sale",
        price: 1000000,
        ...(imageUrls ? { imageUrls } : {}),
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id;
    createdPropertyIds.push(id);
    return id;
  }

  async function register(
    name: string,
    email: string,
    roles: string[],
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { acceptLegal: true, isAdult: true, name, email, password, roles },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().user.id;
    for (const role of roles) await approveUserRole(app, id, role);
    createdUserIds.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });

    await register("R2 Owner", `r2-owner-${suffix}@test.com`, ["owner"]);
    await register("R2 Other", `r2-other-${suffix}@test.com`, ["client"]);
    ownerToken = await loginAndGetToken(app, `r2-owner-${suffix}@test.com`, password);
    otherToken = await loginAndGetToken(app, `r2-other-${suffix}@test.com`, password);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isR2Configured).mockReturnValue(true);
  });

  afterAll(async () => {
    await app.prisma.property.deleteMany({ where: { id: { in: createdPropertyIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it("happy path uploads and returns an R2 public URL", async () => {
    const id = await createProperty(ownerToken);
    vi.mocked(uploadPublicImage).mockResolvedValue({
      key: `property-images/${id}/abc.webp`,
      publicUrl: `${R2_BASE}/property-images/${id}/abc.webp`,
    });

    const res = await uploadImage(id, ownerToken, WEBP);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.image.url).toBe(`${R2_BASE}/property-images/${id}/abc.webp`);
    expect(body.image.key).toBe(`property-images/${id}/abc.webp`);
  });

  it("rejects bytes that do not match the declared type", async () => {
    const id = await createProperty(ownerToken);
    const res = await uploadImage(id, ownerToken, Buffer.from("not an image at all"));
    expect(res.status).toBe(400);
    expect(uploadPublicImage).not.toHaveBeenCalled();
  });

  it("rejects files over 3MB", async () => {
    const id = await createProperty(ownerToken);
    const big = Buffer.concat([WEBP, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await uploadImage(id, ownerToken, big);
    expect(res.status).toBe(413);
    expect(uploadPublicImage).not.toHaveBeenCalled();
  });

  it("rejects a non-owner upload", async () => {
    const id = await createProperty(ownerToken);
    const res = await uploadImage(id, otherToken, WEBP);
    expect(res.status).toBe(403);
    expect(uploadPublicImage).not.toHaveBeenCalled();
  });

  it("rejects upload past the 10-image cap", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `${R2_BASE}/p/${i}.webp`);
    const id = await createProperty(ownerToken, ten);
    const res = await uploadImage(id, ownerToken, WEBP);
    expect(res.status).toBe(400);
    expect(uploadPublicImage).not.toHaveBeenCalled();
  });

  it("create no longer drops imageUrls", async () => {
    const urls = [`${R2_BASE}/a.webp`, `${R2_BASE}/b.webp`];
    const res = await app.inject({
      method: "POST",
      url: "/properties",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        title: "Create keeps images " + Math.random().toString(16).slice(2),
        estado: "Ciudad de México",
        listingType: "for_sale",
        price: 500000,
        imageUrls: urls,
      },
    });
    expect(res.statusCode).toBe(201);
    createdPropertyIds.push(res.json().data.id);
    expect(res.json().data.imageUrls).toEqual(urls);
  });

  it("property DELETE removes managed R2 objects and skips external URLs", async () => {
    vi.mocked(deletePublicImage).mockResolvedValue(undefined);
    const managed = `${R2_BASE}/managed.webp`;
    const external = "https://images.unsplash.com/photo-123.jpg";
    const id = await createProperty(ownerToken, [managed, external]);

    const res = await app.inject({
      method: "DELETE",
      url: `/properties/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(deletePublicImage).toHaveBeenCalledTimes(1);
    expect(deletePublicImage).toHaveBeenCalledWith(managed);
  });

  it("DELETE /images rejects a foreign host", async () => {
    const id = await createProperty(ownerToken);
    const res = await app.inject({
      method: "DELETE",
      url: `/properties/${id}/images`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { url: "https://evil.example.com/x.webp" },
    });
    expect(res.statusCode).toBe(400);
    expect(deletePublicImage).not.toHaveBeenCalled();
  });
});
