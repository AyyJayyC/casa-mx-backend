import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { env } from "../src/config/env.js";

describe("C14 - outbound calls carry a timeout", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: "test-c14-" } },
    });
    await app.close();
  });

  it("Google token verification passes an AbortSignal", async () => {
    const calls: Array<{ url: string; opts: any }> = [];
    global.fetch = vi.fn(async (url: any, opts: any) => {
      calls.push({ url: String(url), opts });
      return {
        ok: true,
        json: async () => ({
          sub: "c14-sub",
          email: `test-c14-${Date.now()}@example.com`,
          name: "C14 User",
          aud: env.GOOGLE_CLIENT_ID,
          email_verified: "true",
        }),
      } as any;
    }) as any;

    const res = await app.inject({
      method: "POST",
      url: "/auth/oauth/google",
      payload: { idToken: "dummy-token" },
    });

    expect(res.statusCode).toBe(200);
    const google = calls.find((c) => c.url.includes("tokeninfo"));
    expect(google).toBeTruthy();
    expect(google!.opts.signal).toBeInstanceOf(AbortSignal);
  });
});
