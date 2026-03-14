import { FastifyPluginAsync } from 'fastify';
import { mapsService } from '../services/maps.service.js';

const mapsRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Public endpoint: POST /maps/geocode
  fastify.post('/maps/geocode', async (request, reply) => {
    const body = request.body as any;
    if (!body || !body.address) return reply.code(400).send({ error: 'address required' });
    try {
      const result = await mapsService.geocodeAddress(body.address, { userId: (request as any).user?.id });
      return reply.send({ result });
    } catch (err: any) {
      console.error('Geocode error:', err);
      return reply.code(500).send({ error: err.message || 'geocode_failed' });
    }
  });

  // Public endpoint: GET /maps/autocomplete?input=...
  fastify.get('/maps/autocomplete', async (request, reply) => {
    const q = (request.query as any)?.input;
    if (!q) return reply.code(400).send({ error: 'input required' });
    try {
      const preds = await mapsService.autocomplete(q, { userId: (request as any).user?.id });
      return reply.send({ predictions: preds });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'autocomplete_failed' });
    }
  });
};

export default mapsRoutes;
