import { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const locationsCatalogPath = join(__dirname, '..', 'data', 'mexican-locations.json');
const locationsCatalog = JSON.parse(readFileSync(locationsCatalogPath, 'utf8'));

const locationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/locations', async (_request, reply) => {
    return reply.code(200).send({
      success: true,
      data: locationsCatalog,
    });
  });
};

export default locationsRoutes;
