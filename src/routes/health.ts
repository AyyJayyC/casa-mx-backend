import { FastifyPluginAsync } from 'fastify';
import { cacheService } from '../services/cache.service.js';
import { verifyConnection, isConfigured } from '../services/email.service.js';
import { env } from '../config/env.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;

      const cacheConfigured = Boolean(process.env.REDIS_URL);
      let cacheStatus: 'ok' | 'down' | 'not_configured' = 'not_configured';
      if (cacheConfigured) {
        try {
          const healthy = cacheService.isAvailable();
          cacheStatus = healthy ? 'ok' : 'down';
        } catch {
          fastify.log.warn('Redis configured but unreachable for health check');
          cacheStatus = 'down';
        }
      }

      // Email service check
      let emailStatus: 'ok' | 'degraded' | 'not_configured' = 'not_configured';
      if (isConfigured()) {
        const emailResult = await verifyConnection();
        emailStatus = emailResult.ok ? 'ok' : 'degraded';
      }

      // Stripe check
      const stripeStatus = env.STRIPE_SECRET_KEY ? 'ok' : 'not_configured';

      const checks: Record<string, string> = {
        database: 'ok',
        cache: cacheStatus,
        email: emailStatus,
        stripe: stripeStatus,
      };

      const hasDegradation = Object.values(checks).some(s => s === 'down' || s === 'degraded');

      return reply.code(hasDegradation ? 503 : 200).send({
        status: hasDegradation ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
      });
    } catch (error: any) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: error?.message || 'health_check_failed',
      });
    }
  });

  fastify.get('/health/ready', async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      return reply.code(200).send({ ready: true });
    } catch (err: any) {
      fastify.log.error({ err }, 'Database readiness check failed');
      return reply.code(503).send({ ready: false, error: 'Database unreachable' });
    }
  });

  fastify.get('/health/live', async (request, reply) => {
    return reply.code(200).send({ alive: true });
  });
};

export default healthRoutes;
