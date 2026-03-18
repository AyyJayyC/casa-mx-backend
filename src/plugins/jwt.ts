import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(import('@fastify/jwt'), {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    },
    cookie: {
      cookieName: 'accessToken',
      signed: false,
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
