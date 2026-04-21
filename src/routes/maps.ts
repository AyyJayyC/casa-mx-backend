import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mapsService } from '../services/maps.service.js';

const geocodeBodySchema = z.object({
  address: z.string().trim().min(3).max(300),
});

const autocompleteQuerySchema = z.object({
  input: z.string().trim().min(3).max(120),
  sessionToken: z.string().max(128).optional(),
});

// Simple in-memory sliding-window IP rate limiter
function makeIpRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, number[]>();
  return function check(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (buckets.get(ip) || []).filter(t => t > cutoff);
    if (timestamps.length >= maxRequests) return false;
    timestamps.push(now);
    buckets.set(ip, timestamps);
    return true;
  };
}

const autocompleteRateLimit = makeIpRateLimiter(30, 60_000); // 30/min per IP
const geocodeRateLimit = makeIpRateLimiter(10, 60_000);      // 10/min per IP

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

    if (message.includes('API key is invalid')) {
      return {
        statusCode: 503,
        payload: {
          error: 'maps_provider_invalid_key',
          message: 'Google Maps rejected the configured API key. Replace MAPS_API_KEY with a valid server-side key.',
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
    const ip = request.ip || (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 'unknown';
    if (!geocodeRateLimit(ip)) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Please wait a moment.' });
    }
    const parsedBody = geocodeBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'address must be a non-empty string between 3 and 300 characters.',
        details: parsedBody.error.issues,
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
    const ip = request.ip || (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 'unknown';
    if (!autocompleteRateLimit(ip)) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Please wait a moment.' });
    }

    const parsedQuery = autocompleteQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'input must be a non-empty string between 3 and 120 characters.',
        details: parsedQuery.error.issues,
      });
    }

    try {
      const preds = await mapsService.autocomplete(parsedQuery.data.input, { userId: (request as any).user?.id, sessionToken: parsedQuery.data.sessionToken });
      return reply.send({ predictions: preds });
    } catch (err: any) {
      const mapped = mapServiceError(err);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
  });
};

export default mapsRoutes;
