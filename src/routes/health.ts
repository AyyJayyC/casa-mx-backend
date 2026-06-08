import { FastifyPluginAsync } from "fastify";
import { cacheService } from "../services/cache.service.js";
import { verifyConnection, isConfigured } from "../services/email.service.js";
import { env } from "../config/env.js";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;

      const cacheConfigured = Boolean(process.env.REDIS_URL);
      let cacheStatus: "ok" | "down" | "not_configured" = "not_configured";
      if (cacheConfigured) {
        try {
          const healthy = cacheService.isAvailable();
          cacheStatus = healthy ? "ok" : "down";
        } catch {
          fastify.log.warn("Redis configured but unreachable for health check");
          cacheStatus = "down";
        }
      }

      let emailStatus: "ok" | "degraded" | "not_configured" = "not_configured";
      if (isConfigured()) {
        try {
          const emailResult = await verifyConnection();
          emailStatus = emailResult.ok ? "ok" : "degraded";
        } catch (err: any) {
          fastify.log.warn(
            { err },
            "Email health check threw — marking degraded",
          );
          emailStatus = "degraded";
        }
      }

      const stripeStatus = env.STRIPE_SECRET_KEY ? "ok" : "not_configured";

      const checks: Record<string, string> = {
        database: "ok",
        cache: cacheStatus,
        email: emailStatus,
        stripe: stripeStatus,
      };

      const dbDown = false; // reached this point means DB is ok

      // Always return 200 while DB is up. Other services report their
      // status in `checks` for monitoring dashboards — degrading the HTTP
      // status triggers Railway to kill the deploy, which causes outages
      // for non-critical service issues (e.g. Resend domain not verified).
      return reply.code(200).send({
        status: dbDown ? "unhealthy" : "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
      });
    } catch (error: any) {
      return reply.code(503).send({
        status: "unhealthy",
        error: error?.message || "health_check_failed",
      });
    }
  });

  fastify.get("/health/ready", async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      return reply.code(200).send({ ready: true });
    } catch (err: any) {
      fastify.log.error({ err }, "Database readiness check failed");
      return reply
        .code(503)
        .send({ ready: false, error: "Database unreachable" });
    }
  });

  fastify.get("/health/live", async (request, reply) => {
    return reply.code(200).send({ alive: true });
  });
};

export default healthRoutes;
