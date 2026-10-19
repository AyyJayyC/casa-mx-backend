import Fastify, { type FastifyInstance } from "fastify";
import compressionPlugin from "../src/plugins/compression.js";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(compressionPlugin);
  app.get("/big", async () => ({ data: "x".repeat(4096) }));
  app.get("/small", async () => ({ ok: true }));
  return app;
}

describe("compression plugin", () => {
  it("gzips a JSON body over 1 KB when the client accepts gzip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/big",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers["content-encoding"]).toBe("gzip");
    await app.close();
  });

  it("leaves tiny bodies uncompressed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/small",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers["content-encoding"]).toBeUndefined();
    await app.close();
  });

  it("does not compress when the client does not accept it", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/big" });
    expect(res.headers["content-encoding"]).toBeUndefined();
    await app.close();
  });
});
