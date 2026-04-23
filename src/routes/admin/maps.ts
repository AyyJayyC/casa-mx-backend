import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mapsService } from '../../services/maps.service.js';
import { verifyJWT, requireRole } from '../../utils/guards.js';
import { getDaysRemainingInMonth } from '../../utils/errorClassification.js';

const serviceTypeSchema = z.enum([
  'geocoding',
  'places_autocomplete',
  'place_details',
  'tile_requests',
  'directions',
]);

const serviceTypeParamsSchema = z.object({
  serviceType: serviceTypeSchema,
});

const updateLimitBodySchema = z
  .object({
    limitValue: z.number().int().min(1).max(1000000).optional(),
    alertThreshold: z.number().int().min(1).max(100).optional(),
    hardStop: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one of limitValue, alertThreshold, or hardStop is required.',
  });

const usageHistoryQuerySchema = z.object({
  service: serviceTypeSchema.optional(),
  period: z.enum(['daily', 'monthly']).optional(),
});

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
    return reply.send({ services: results, daysRemainingInMonth: getDaysRemainingInMonth() });
  });

  // GET /admin/maps/limits
  fastify.get('/admin/maps/limits', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const limits = await mapsService.listLimits();
    return reply.send(limits);
  });

  // PATCH /admin/maps/limits/:serviceType
  fastify.patch('/admin/maps/limits/:serviceType', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const parsedParams = serviceTypeParamsSchema.safeParse(request.params);
    const parsedBody = updateLimitBodySchema.safeParse(request.body);

    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: [
          ...(parsedParams.success ? [] : parsedParams.error.issues),
          ...(parsedBody.success ? [] : parsedBody.error.issues),
        ],
      });
    }

    const updated = await mapsService.updateLimit(parsedParams.data.serviceType, parsedBody.data);
    return reply.send(updated);
  });

  // PATCH /admin/maps/service/:serviceType/enable
  fastify.patch('/admin/maps/service/:serviceType/enable', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const parsedParams = serviceTypeParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsedParams.error.issues });
    }

    const updated = await mapsService.resumeService(parsedParams.data.serviceType);
    return reply.send({ status: 'enabled', limit: updated });
  });

  // PATCH /admin/maps/service/:serviceType/disable
  fastify.patch('/admin/maps/service/:serviceType/disable', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const parsedParams = serviceTypeParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsedParams.error.issues });
    }

    const updated = await mapsService.pauseService(parsedParams.data.serviceType);
    return reply.send({ status: 'paused', limit: updated });
  });

  // GET /admin/maps/usage/history?service=...&period=daily|monthly
  fastify.get('/admin/maps/usage/history', { onRequest: [verifyJWT, requireRole('admin')] }, async (request, reply) => {
    const parsedQuery = usageHistoryQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsedQuery.error.issues });
    }

    const usage = await mapsService.getUsage(parsedQuery.data.service, parsedQuery.data.period || 'monthly');
    return reply.send(usage);
  });
};

export default adminMapsRoutes;
