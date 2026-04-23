import { FastifyPluginAsync } from 'fastify';
import { AnalyticsEventSchema } from '../schemas/analytics.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { requireAdmin, verifyJWT } from '../utils/guards.js';
import { isZodError, createValidationErrorResponse, createServerErrorResponse } from '../utils/errorHandling.js';

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const analyticsService = new AnalyticsService(fastify.prisma);

  // Track event (authenticated users only)
  fastify.post<{ Body: Record<string, any> }>(
    '/analytics/events',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const input = AnalyticsEventSchema.parse(request.body);
        const userId = (request.user as any).id;

        const event = await analyticsService.trackEvent(userId, input);

        return reply.code(201).send({
          success: true,
          data: event,
        });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }

        fastify.log.error(error);
        return reply.code(500).send(createServerErrorResponse('Failed to track event'));
      }
    }
  );

  // Get analytics summary (admin only)
  fastify.get(
    '/admin/analytics/summary',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const summary = await analyticsService.getEventsSummary();

        return reply.code(200).send({
          success: true,
          data: summary,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch analytics summary',
        });
      }
    }
  );

  // Get all analytics events (admin only)
  fastify.get<{ Querystring: { limit?: string } }>(
    '/admin/analytics/events',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
        const events = await analyticsService.getAllEvents(limit);

        return reply.code(200).send({
          success: true,
          data: events,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch analytics events',
        });
      }
    }
  );

  // Get events by name (admin only)
  fastify.get<{ Querystring: { eventName: string; limit?: string } }>(
    '/admin/analytics/events-by-name',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { eventName } = request.query;

        if (!eventName) {
          return reply.code(400).send({
            success: false,
            error: 'eventName query parameter is required',
          });
        }

        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        const events = await analyticsService.getEventsByName(eventName, limit);

        return reply.code(200).send({
          success: true,
          data: events,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch events by name',
        });
      }
    }
  );
};

export default analyticsRoutes;
