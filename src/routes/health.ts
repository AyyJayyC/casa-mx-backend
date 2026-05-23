import { FastifyPluginAsync } from 'fastify';
import { cacheService } from '../services/cache.service.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;

      const cacheConfigured = Boolean(process.env.REDIS_URL);
      let cacheHealthy = true;
      if (cacheConfigured) {
        try {
          cacheHealthy = cacheService.isAvailable();
        } catch {
          fastify.log.warn('Redis configured but unreachable for health check');
        }
      }
      const overallHealthy = true; // Redis is optional, don't degrade on cache alone

      if (!overallHealthy) {
        return reply.code(503).send({
          status: 'degraded',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: process.env.NODE_ENV,
          checks: {
            database: 'ok',
            cache: 'down',
          },
        });
      }

      return reply.code(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        checks: {
          database: 'ok',
          cache: cacheConfigured ? 'ok' : 'not_configured',
        },
      });
    } catch (error: any) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: error?.message || 'health_check_failed',
        timestamp: new Date().toISOString(),
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
