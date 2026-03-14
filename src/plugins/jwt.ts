import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(import('@fastify/jwt'), {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    sign: {
      expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
    },
  });
};

export default fp(jwtPlugin);

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      email: string;
      roles: Array<{ name: string }>;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate?: any;
  }
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      roles: Array<{ name: string }>;
    };
    sessionId?: string;
    startTime?: number;
  }
}
