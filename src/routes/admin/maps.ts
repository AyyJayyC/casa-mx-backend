import { FastifyPluginAsync } from 'fastify';
import { mapsService } from '../../services/maps.service.js';
import { verifyJWT, requireRole } from '../../utils/guards.js';

const adminMapsRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // GET /admin/maps/usage
  fastify.get('/admin/maps/usage', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const services = await mapsService.listLimits();
    // For each service, compute monthly usage
    const usagePromises = services.map(async (s) => ({
      serviceType: s.serviceType,
      limit: s.limitValue,
      status: s.status,
      alertThreshold: s.alertThreshold,
      currentUsage: s.currentUsage
    }));
    const results = await Promise.all(usagePromises);
    return reply.send({ services: results, daysRemainingInMonth: (() => {
      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth()+1, 1);
      return Math.ceil((+end - +now) / (1000*60*60*24));
    })() });
  });

  // GET /admin/maps/limits
  fastify.get('/admin/maps/limits', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const limits = await mapsService.listLimits();
    return reply.send(limits);
  });

  // PATCH /admin/maps/limits/:serviceType
  fastify.patch('/admin/maps/limits/:serviceType', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const { serviceType } = request.params as any;
    const body = request.body as any;
    const updated = await mapsService.updateLimit(serviceType, body);
    return reply.send(updated);
  });

  // PATCH /admin/maps/service/:serviceType/enable
  fastify.patch('/admin/maps/service/:serviceType/enable', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const { serviceType } = request.params as any;
    const updated = await mapsService.resumeService(serviceType);
    return reply.send({ status: 'enabled', limit: updated });
  });

  // PATCH /admin/maps/service/:serviceType/disable
  fastify.patch('/admin/maps/service/:serviceType/disable', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const { serviceType } = request.params as any;
    const updated = await mapsService.pauseService(serviceType);
    return reply.send({ status: 'paused', limit: updated });
  });

  // GET /admin/maps/usage/history?service=...&period=daily|monthly
  fastify.get('/admin/maps/usage/history', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const { service, period } = request.query as any;
    const p = period === 'daily' ? 'daily' : 'monthly';
    const usage = await mapsService.getUsage(service, p);
    return reply.send(usage);
  });
};

export default adminMapsRoutes;
