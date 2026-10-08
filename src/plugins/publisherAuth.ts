import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Casa MX Publisher API authentication.
 *
 * Registered as a root onRequest hook BEFORE @fastify/rate-limit so that
 * `request.publisher` is populated when the per-key rate-limit keyGenerator
 * runs. It only acts on /publisher/* paths and is otherwise inert.
 *
 * Keys are never logged; the raw header value is hashed and only the hash is
 * compared (constant-time).
 */

const PUBLISHER_PATH_PREFIX = "/publisher/";
const ALLOWED_ROLES = new Set(["owner", "agent", "admin"]);
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex hashes of equal length. */
function constantTimeHashMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const publisherAuthPlugin: FastifyPluginAsync = async (fastify) => {
  if (env.ENABLE_PUBLISHER_API !== "true") return;

  const reject = (
    reply: FastifyReply,
    code: number,
    error: string,
  ): FastifyReply => reply.code(code).send({ success: false, error });

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith(PUBLISHER_PATH_PREFIX)) return;

    const raw = request.headers["x-api-key"];
    if (typeof raw !== "string" || raw.length === 0) {
      return reject(reply, 401, "Unauthorized - missing API key");
    }
    if (!raw.startsWith("cmx_pub_")) {
      return reject(reply, 401, "Unauthorized - invalid API key");
    }

    const hash = sha256Hex(raw);
    const key = await fastify.prisma.publisherApiKey.findUnique({
      where: { keyHash: hash },
    });
    if (!key || !constantTimeHashMatch(hash, key.keyHash)) {
      return reject(reply, 401, "Unauthorized - invalid API key");
    }

    const now = Date.now();
    if (
      !key.active ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt.getTime() <= now)
    ) {
      return reject(reply, 401, "Unauthorized - invalid API key");
    }

    const userRoles = await fastify.prisma.userRole.findMany({
      where: { userId: key.userId, status: "approved" },
      select: { role: { select: { name: true } } },
    });
    if (!userRoles.some((r) => ALLOWED_ROLES.has(r.role.name))) {
      return reject(
        reply,
        403,
        "Forbidden - requires an owner, agent or admin role",
      );
    }

    // INE gate is per key, and disabled globally when PUBLISHER_REQUIRE_INE
    // is "false". Read process.env at request time so the value is testable.
    const requireIne =
      process.env.PUBLISHER_REQUIRE_INE ?? env.PUBLISHER_REQUIRE_INE;
    if (!key.skipIneVerification && requireIne !== "false") {
      const ine = await fastify.prisma.userDocument.findFirst({
        where: {
          userId: key.userId,
          documentType: "official_id",
          isVerified: true,
        },
        select: { id: true },
      });
      if (!ine) return reject(reply, 403, "Forbidden - approved INE required");
    }

    request.publisher = { keyId: key.id, userId: key.userId };

    // Throttled (>5 min) last-used stamp; fire-and-forget so it never blocks.
    if (!key.lastUsedAt || now - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      void fastify.prisma.publisherApiKey
        .update({
          where: { id: key.id },
          data: { lastUsedAt: new Date(now) },
        })
        .catch(() => {});
    }
  });
};

export default fp(publisherAuthPlugin);

declare module "fastify" {
  interface FastifyRequest {
    publisher?: { keyId: string; userId: string };
  }
}
