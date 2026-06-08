import { FastifyPluginAsync } from "fastify";
import { AnalyticsEventSchema } from "../schemas/analytics.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { requireAdmin, verifyJWT } from "../utils/guards.js";
import {
  isZodError,
  createValidationErrorResponse,
  createServerErrorResponse,
} from "../utils/errorHandling.js";

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const analyticsService = new AnalyticsService(fastify.prisma);

  // POST /analytics/events — track an event (authenticated users)
  fastify.post<{ Body: Record<string, any> }>(
    "/analytics/events",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const input = AnalyticsEventSchema.parse(request.body);
        const userId = (request.user as any).id;
        const event = await analyticsService.trackEvent(userId, input);
        return reply.code(201).send({ success: true, data: event });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply
            .code(400)
            .send(createValidationErrorResponse(error, true));
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send(createServerErrorResponse("Failed to track event"));
      }
    },
  );

  // GET /admin/analytics/summary — basic event summary (admin, backward compat)
  fastify.get(
    "/admin/analytics/summary",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const summary = await analyticsService.getEventsSummary();
        return reply.code(200).send({ success: true, data: summary });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch analytics summary" });
      }
    },
  );

  // GET /admin/analytics/dashboard — aggregated KPIs (admin)
  fastify.get(
    "/admin/analytics/dashboard",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getDashboard();
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch dashboard" });
      }
    },
  );

  // GET /admin/analytics/timeline — daily data for charts (admin)
  fastify.get<{ Querystring: { days?: string } }>(
    "/admin/analytics/timeline",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const days = request.query.days ? parseInt(request.query.days, 10) : 30;
        const data = await analyticsService.getTimeline(days);
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch timeline" });
      }
    },
  );

  // GET /admin/analytics/top-properties — most engaged properties (admin)
  fastify.get<{ Querystring: { limit?: string } }>(
    "/admin/analytics/top-properties",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 10;
        const data = await analyticsService.getTopProperties(limit);
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch top properties" });
      }
    },
  );

  // GET /admin/analytics/referral-summary — referral stats (admin)
  fastify.get(
    "/admin/analytics/referral-summary",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getReferralSummary();
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch referral summary" });
      }
    },
  );

  // GET /admin/analytics/events — all events list (admin)
  fastify.get<{ Querystring: { limit?: string } }>(
    "/admin/analytics/events",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 100;
        const events = await analyticsService.getAllEvents(limit);
        return reply.send({ success: true, data: events });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch events" });
      }
    },
  );

  // GET /admin/analytics/events-by-name — filter events by name (admin)
  fastify.get<{ Querystring: { eventName: string; limit?: string } }>(
    "/admin/analytics/events-by-name",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { eventName } = request.query;
        if (!eventName) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "eventName query parameter is required",
            });
        }
        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 50;
        const events = await analyticsService.getEventsByName(eventName, limit);
        return reply.send({ success: true, data: events });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch events by name" });
      }
    },
  );

  // ─── Market Analytics (Phase 6) ────────────────────────────────────

  // GET /admin/analytics/market-summary — global market KPIs
  fastify.get<{ Querystring: { listingType?: string } }>(
    "/admin/analytics/market-summary",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getMarketSummary(
          request.query.listingType,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch market summary" });
      }
    },
  );

  // GET /admin/analytics/market-by-city — per-city breakdown
  fastify.get<{ Querystring: { estado?: string; listingType?: string } }>(
    "/admin/analytics/market-by-city",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getMarketByCity(
          request.query.estado,
          request.query.listingType,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch market by city" });
      }
    },
  );

  // GET /admin/analytics/market-by-colonia — per-colonia drilldown
  fastify.get<{
    Querystring: { estado?: string; ciudad?: string; listingType?: string };
  }>(
    "/admin/analytics/market-by-colonia",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        if (!request.query.estado || !request.query.ciudad) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "estado and ciudad query parameters are required",
            });
        }
        const data = await analyticsService.getMarketByColonia(
          request.query.estado,
          request.query.ciudad,
          request.query.listingType,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch market by colonia" });
      }
    },
  );

  // GET /admin/analytics/offer-trends — monthly offer value trend
  fastify.get<{
    Querystring: {
      estado?: string;
      ciudad?: string;
      colonia?: string;
      listingType?: string;
      months?: string;
    };
  }>(
    "/admin/analytics/offer-trends",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const months = request.query.months
          ? parseInt(request.query.months, 10)
          : 12;
        const data = await analyticsService.getOfferTrends(
          request.query.estado,
          request.query.ciudad,
          request.query.colonia,
          request.query.listingType,
          months,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch offer trends" });
      }
    },
  );

  // GET /admin/analytics/offer-analysis — offer behavior stats
  fastify.get<{ Querystring: { estado?: string; ciudad?: string } }>(
    "/admin/analytics/offer-analysis",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getOfferAnalysis(
          request.query.estado,
          request.query.ciudad,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch offer analysis" });
      }
    },
  );

  // GET /admin/analytics/opportunities — actionable alerts
  fastify.get<{ Querystring: { listingType?: string } }>(
    "/admin/analytics/opportunities",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const data = await analyticsService.getOpportunities(
          request.query.listingType,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch opportunities" });
      }
    },
  );

  // GET /admin/analytics/comps — recent comparable offers
  fastify.get<{
    Querystring: {
      estado?: string;
      ciudad?: string;
      colonia?: string;
      listingType?: string;
      limit?: string;
    };
  }>(
    "/admin/analytics/comps",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const limit = request.query.limit
          ? parseInt(request.query.limit, 10)
          : 20;
        const data = await analyticsService.getComps(
          request.query.estado,
          request.query.ciudad,
          request.query.colonia,
          request.query.listingType,
          limit,
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch comps" });
      }
    },
  );
};

export default analyticsRoutes;
