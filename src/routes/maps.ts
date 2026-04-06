import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mapsService } from '../services/maps.service.js';

const geocodeBodySchema = z.object({
  address: z.string().trim().min(3).max(300),
});

const autocompleteQuerySchema = z.object({
  input: z.string().trim().min(3).max(120),
});

const mapsRoutes: FastifyPluginAsync = async (fastify, opts) => {
  const mapServiceError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || 'maps_failed');

    if (message.includes('Google Maps provider unavailable')) {
      return {
        statusCode: 503,
        payload: {
          error: 'maps_provider_unavailable',
          message: 'Google Maps is not configured. Set MAPS_API_KEY and ENABLE_BILLABLE_MAPS=true.',
        },
      };
    }

    if (message.includes('no Mexico results')) {
      return {
        statusCode: 404,
        payload: {
          error: 'address_not_found',
          message: 'No se encontró una dirección válida en México para la búsqueda proporcionada.',
        },
      };
    }

    return {
      statusCode: 502,
      payload: {
        error: 'maps_upstream_failed',
        message,
      },
    };
  };

  // Public endpoint: POST /maps/geocode
  fastify.post('/maps/geocode', async (request, reply) => {
    const parsedBody = geocodeBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'address must be a non-empty string between 3 and 300 characters.',
        details: parsedBody.error.issues,
      });
    }

    if (!mapsService.canUseGoogleMapsProvider()) {
      return reply.code(503).send({
        error: 'maps_provider_unavailable',
        message: 'Google Maps is not configured. Set MAPS_API_KEY and ENABLE_BILLABLE_MAPS=true.',
      });
    }

    try {
      const result = await mapsService.geocodeAddress(parsedBody.data.address, { userId: (request as any).user?.id });
      return reply.send({ result });
    } catch (err: any) {
      console.error('Geocode error:', err);
      const mapped = mapServiceError(err);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
  });

  // Public endpoint: GET /maps/autocomplete?input=...
  fastify.get('/maps/autocomplete', async (request, reply) => {
    const parsedQuery = autocompleteQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'input must be a non-empty string between 3 and 120 characters.',
        details: parsedQuery.error.issues,
      });
    }

    if (!mapsService.canUseGoogleMapsProvider()) {
      return reply.code(503).send({
        error: 'maps_provider_unavailable',
        message: 'Google Maps is not configured. Set MAPS_API_KEY and ENABLE_BILLABLE_MAPS=true.',
      });
    }

    try {
      const preds = await mapsService.autocomplete(parsedQuery.data.input, { userId: (request as any).user?.id });
      return reply.send({ predictions: preds });
    } catch (err: any) {
      const mapped = mapServiceError(err);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
  });
};

export default mapsRoutes;
