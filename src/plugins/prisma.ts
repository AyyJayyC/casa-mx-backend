import { PrismaClient } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const prismaPlugin: FastifyPluginAsync = async (fastify) => {
  const prisma = new PrismaClient({
    log: fastify.log.level === 'debug' ? ['query', 'error', 'warn'] : ['error'],
  });

  await prisma.$connect();
  
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (fastify) => {
    await fastify.prisma.$disconnect();
  });
};

export default fp(prismaPlugin);

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
