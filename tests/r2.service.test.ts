import { describe, expect, it, vi } from "vitest";

// Configure a fake R2 environment before env.ts is imported.
vi.hoisted(() => {
  process.env.R2_ENDPOINT = "https://acct.r2.cloudflarestorage.com";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_REGION = "auto";
  process.env.R2_IMAGES_BUCKET = "casa-mx-images";
  process.env.R2_PUBLIC_BASE_URL = "https://pub-test.r2.dev";
});

import {
  getPublicUrl,
  keyFromPublicUrl,
  uploadPublicImage,
  deletePublicImage,
} from "../src/services/s3.service.js";

describe("R2 public image helpers", () => {
  it("getPublicUrl joins base + key", () => {
    expect(getPublicUrl("property-images/p1/abc.webp")).toBe(
      "https://pub-test.r2.dev/property-images/p1/abc.webp",
    );
  });

  it("keyFromPublicUrl returns the key for the configured host", () => {
    expect(
      keyFromPublicUrl("https://pub-test.r2.dev/property-images/p1/abc.webp"),
    ).toBe("property-images/p1/abc.webp");
  });

  it("keyFromPublicUrl returns null for a foreign host", () => {
    expect(keyFromPublicUrl("https://evil.example.com/abc.webp")).toBeNull();
    expect(keyFromPublicUrl("not-a-url")).toBeNull();
  });

  it("uploadPublicImage rejects non-image mime types", async () => {
    await expect(
      uploadPublicImage(Buffer.from("%PDF-1.4"), "application/pdf", "p"),
    ).rejects.toThrow(/allowed/i);
  });

  it("uploadPublicImage rejects bytes that do not match the declared type", async () => {
    await expect(
      uploadPublicImage(Buffer.from("not really a webp"), "image/webp", "p"),
    ).rejects.toThrow(/does not match/i);
  });

  it("deletePublicImage skips external URLs without touching storage", async () => {
    // External host -> no DeleteObject call, must resolve (would throw if it
    // tried to reach the fake endpoint with real credentials).
    await expect(
      deletePublicImage("https://evil.example.com/abc.webp"),
    ).resolves.toBeUndefined();
  });
});
