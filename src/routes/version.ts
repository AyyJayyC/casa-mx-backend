import { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

const versionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/version', async (request, reply) => {
    return reply.code(200).send({
      app: 'casa-mx-backend',
      version: packageJson.version,
      buildDate: process.env.BUILD_DATE || new Date().toISOString(),
      buildCommit: process.env.BUILD_COMMIT || 'unknown',
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
    });
  });
};

export default versionRoutes;
