import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import { z } from "zod";

function normalizeTag(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics
}

const tagsRoutes: FastifyPluginAsync = async (app) => {
  // GET /users/tags — list user's tag subscriptions
  app.get(
    "/users/tags",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const subs = await (app as any).prisma.tagSubscription.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ subscriptions: subs });
    },
  );

  // POST /users/tags — add a tag subscription
  app.post(
    "/users/tags",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const body = request.body as any;
      const tagType = body?.tagType;
      const tagName = String(body?.tagName || "").trim();
      const estado = String(body?.estado || "").trim() || null;

      if (!tagName)
        return reply.code(400).send({ error: "tagName is required" });
      if (!["ciudad", "colonia"].includes(tagType)) {
        return reply
          .code(400)
          .send({ error: "tagType must be ciudad or colonia" });
      }

      const tagNormal = normalizeTag(tagName);
      const prisma = (app as any).prisma;

      // Check for duplicate
      const existing = await prisma.tagSubscription.findUnique({
        where: { userId_tagType_tagNormal: { userId, tagType, tagNormal } },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "Already subscribed to this tag" });
      }

      const sub = await prisma.tagSubscription.create({
        data: {
          userId,
          tagType,
          tagName,
          tagNormal,
          estado: estado || undefined,
        },
      });

      return reply.code(201).send({ subscription: sub });
    },
  );

  // DELETE /users/tags/:id — remove a tag subscription
  app.delete(
    "/users/tags/:id",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { id } = request.params as { id: string };
      const prisma = (app as any).prisma;

      const sub = await prisma.tagSubscription.findUnique({ where: { id } });
      if (!sub) return reply.code(404).send({ error: "Not found" });
      if (sub.userId !== userId)
        return reply.code(403).send({ error: "Forbidden" });

      await prisma.tagSubscription.delete({ where: { id } });
      return reply.code(204).send();
    },
  );

  // GET /tags/autocomplete — suggest existing tags as user types
  app.get("/tags/autocomplete", async (request, reply) => {
    const q = normalizeTag(String((request.query as any)?.q || ""));
    const type = String((request.query as any)?.type || "colonia");

    if (q.length < 2) return reply.send({ suggestions: [] });

    const prisma = (app as any).prisma;

    // Get distinct tag names matching the query
    const results = await prisma.tagSubscription.findMany({
      where: {
        tagType: type,
        tagNormal: { startsWith: q },
      },
      select: { tagName: true, tagNormal: true, estado: true },
      distinct: ["tagNormal"],
      take: 10,
    });

    return reply.send({ suggestions: results });
  });
};

export default tagsRoutes;
