import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS_TOKEN_COOKIE_NAME = 'accessToken';

type JwtUser = JwtPayload & {
  id: string;
  email?: string;
  roles?: string[];
  type?: string;
  jti?: string;
};

type JwtSignInput = string | Buffer | object;
type JwtSignConfig = {
  expiresIn?: string | number;
};

type JwtVerifyConfig = {
  onlyCookie?: boolean;
};

function extractTokenFromRequest(request: { headers: Record<string, unknown>; cookies?: Record<string, unknown> }, options?: JwtVerifyConfig): string {
  if (options?.onlyCookie) {
    const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }

    throw new Error('No Authorization was found in request');
  }

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const bearerToken = authorization.slice('Bearer '.length).trim();
    if (bearerToken.length > 0) {
      return bearerToken;
    }
  }

  const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  throw new Error('No Authorization was found in request');
}

const jwtPlugin: FastifyPluginAsync = async (fastify) => {
  const jwtTools = {
    sign(payload: JwtSignInput, options?: JwtSignConfig) {
      const expiresIn = (options?.expiresIn ?? env.JWT_ACCESS_EXPIRY) as SignOptions['expiresIn'];

      return jwt.sign(payload, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn,
      });
    },
    verify(token: string) {
      return jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JwtUser | string;
    },
    decode(token: string) {
      return jwt.decode(token) as JwtPayload | string | null;
    },
  };

  fastify.decorate('jwt', jwtTools);
  fastify.decorateRequest('jwtVerify', async function jwtVerify(options?: JwtVerifyConfig) {
    const token = extractTokenFromRequest(this, options);
    const decoded = jwtTools.verify(token);

    if (typeof decoded === 'string' || !decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token payload');
    }

    this.user = {
      id: decoded.id,
      email: decoded.email ?? '',
      roles: Array.isArray(decoded.roles) ? decoded.roles : [],
    };

    return this.user;
  });
};

export default fp(jwtPlugin);

declare module 'fastify' {
  interface FastifyJWTTools {
    sign(payload: JwtSignInput, options?: JwtSignConfig): string;
    verify(token: string): JwtUser | string;
    decode(token: string): JwtPayload | string | null;
  }

  interface FastifyInstance {
    jwt: FastifyJWTTools;
    authenticate?: any;
  }

  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      roles: string[];
    };
    jwtVerify(options?: JwtVerifyConfig): Promise<FastifyRequest['user']>;
    sessionId?: string;
    startTime?: number;
  }
}
