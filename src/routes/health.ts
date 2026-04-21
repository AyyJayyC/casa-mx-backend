import { FastifyPluginAsync } from 'fastify';
import { cacheService } from '../services/cache.service.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;

      const cacheConfigured = Boolean(process.env.REDIS_URL);
      const cacheHealthy = cacheConfigured ? cacheService.isAvailable() : true;
      const overallHealthy = cacheHealthy;

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
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });

  fastify.get('/health/live', async (request, reply) => {
    return reply.code(200).send({ alive: true });
  });
};

export default healthRoutes;
