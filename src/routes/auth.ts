import { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RegisterSchema, LoginSchema, RefreshSchema } from '../schemas/auth.js';
import { AuthService } from '../services/auth.service.js';
import { refreshTokenStoreService } from '../services/refreshTokenStore.service.js';
import { env } from '../config/env.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.prisma);
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
  const isLocalFrontend =
    env.FRONTEND_URL.includes('localhost') ||
    env.FRONTEND_URL.includes('127.0.0.1') ||
    env.FRONTEND_URL.includes('0.0.0.0');

  fastify.post<{ Body: Record<string, any> }>(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 50 : isLocalFrontend ? 500 : 5,
          timeWindow: '15 minutes'
        }
      }
    },
    async (request, reply) => {
      try {
        const input = RegisterSchema.parse(request.body);
        const user = await authService.register(input);

        return reply.code(201).send({
          success: true,
          user,
          message: 'User registered successfully',
        });
      } catch (error: any) {
        if (error instanceof Error && error.constructor.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
          details: (error as any).errors || error.message,
          });
        }

        if (error.code === 'P2002') {
          return reply.code(409).send({
            success: false,
            error: 'Email already exists',
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Registration failed',
        });
      }
    }
  );

  fastify.post<{ Body: Record<string, any> }>(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 100 : isLocalFrontend ? 1000 : 10,
          timeWindow: '15 minutes'
        }
      }
    },
    async (request, reply) => {
      try {
        const input = LoginSchema.parse(request.body);
        const user = await authService.login(input);

        // Generate JWT token
        const token = fastify.jwt.sign(
          {
            id: user.id,
            email: user.email,
            roles: user.roles
              .filter((r) => r.status === 'approved')
              .map((r) => r.roleName),
          },
          { expiresIn: '15m' }
        );

        // Generate refresh token
        const refreshToken = fastify.jwt.sign(
          {
            id: user.id,
            type: 'refresh',
            jti: randomUUID(),
          },
          { expiresIn: env.JWT_REFRESH_EXPIRY }
        );

        const decodedRefreshToken = fastify.jwt.decode(refreshToken) as any;
        if (decodedRefreshToken?.jti) {
          await refreshTokenStoreService.setActiveJtiForUser(user.id, decodedRefreshToken.jti);
        }

        reply
          .setCookie('accessToken', token, {
            ...cookieOptions,
            maxAge: 60 * 15,
          })
          .setCookie('refreshToken', refreshToken, {
            ...cookieOptions,
            maxAge: 60 * 60 * 24 * 7,
          });

        return reply.code(200).send({
          success: true,
          user,
          token,
          refreshToken,
        });
      } catch (error: any) {
        if (error.message === 'Invalid email or password') {
          return reply.code(401).send({
            success: false,
            error: 'Invalid email or password',
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Login failed',
        });
      }
    }
  );

  fastify.post<{ Body: Record<string, any> }>(
    '/auth/refresh',
    async (request, reply) => {
      try {
        const parsedBody = RefreshSchema.safeParse(request.body ?? {});
        const refreshToken = parsedBody.success
          ? parsedBody.data.refreshToken
          : (request as any).cookies?.refreshToken;

        if (!refreshToken) {
          return reply.code(400).send({
            success: false,
            error: 'Refresh token is required',
          });
        }

        // Verify refresh token
        try {
          const decoded = fastify.jwt.verify(refreshToken) as any;

          if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type');
          }

          if (!decoded.jti || await refreshTokenStoreService.isJtiRevoked(decoded.jti)) {
            throw new Error('Revoked refresh token');
          }

          const activeJti = await refreshTokenStoreService.getActiveJtiForUser(decoded.id);
          if (!activeJti || activeJti !== decoded.jti) {
            throw new Error('Stale refresh token');
          }

          const user = await authService.getUserById(decoded.id);

          if (!user) {
            return reply.code(401).send({
              success: false,
              error: 'User not found',
            });
          }

          // Generate new access token
          const newToken = fastify.jwt.sign(
            {
              id: user.id,
              email: user.email,
              roles: user.roles
                .filter((r) => r.role.name === 'admin' || r.status === 'approved')
                .map((r) => r.role.name),
            },
            { expiresIn: '15m' }
          );

          await refreshTokenStoreService.revokeJti(decoded.jti);

          const newRefreshToken = fastify.jwt.sign(
            {
              id: user.id,
              type: 'refresh',
              jti: randomUUID(),
            },
            { expiresIn: env.JWT_REFRESH_EXPIRY }
          );

          const decodedNewRefreshToken = fastify.jwt.decode(newRefreshToken) as any;
          if (decodedNewRefreshToken?.jti) {
            await refreshTokenStoreService.setActiveJtiForUser(user.id, decodedNewRefreshToken.jti);
          }

          reply
            .setCookie('accessToken', newToken, {
              ...cookieOptions,
              maxAge: 60 * 15,
            })
            .setCookie('refreshToken', newRefreshToken, {
              ...cookieOptions,
              maxAge: 60 * 60 * 24 * 7,
            });

          return reply.code(200).send({
            success: true,
            token: newToken,
            refreshToken: newRefreshToken,
          });
        } catch (verifyError) {
          return reply.code(401).send({
            success: false,
            error: 'Invalid refresh token',
          });
        }
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Refresh failed',
        });
      }
    }
  );

  fastify.post<{ Body: Record<string, any> }>('/auth/logout', async (request, reply) => {
    const maybeRefreshToken =
      request.body?.refreshToken ||
      (request as any).cookies?.refreshToken;

    if (typeof maybeRefreshToken === 'string' && maybeRefreshToken.length > 0) {
      try {
        const decoded = fastify.jwt.verify(maybeRefreshToken) as any;
        if (decoded?.id) {
          await refreshTokenStoreService.clearActiveJtiForUser(decoded.id);
        }
        if (decoded?.jti) {
          await refreshTokenStoreService.revokeJti(decoded.jti);
        }
      } catch {
      }
    }

    reply
      .clearCookie('accessToken', { path: '/' })
      .clearCookie('refreshToken', { path: '/' });

    return reply.code(200).send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  fastify.get('/auth/me', async (request, reply) => {
    try {
      const hasAuthorizationHeader = Boolean(request.headers?.authorization);
      const hasAccessCookie = Boolean((request as any).cookies?.accessToken);
      if (hasAccessCookie && !hasAuthorizationHeader) {
        await request.jwtVerify({ onlyCookie: true });
      } else {
        await request.jwtVerify();
      }

      const user = await authService.getUserById(request.user?.id || '');

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found',
        });
      }

      return reply.code(200).send({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles.map((ur) => ({
            roleId: ur.roleId,
            roleName: ur.role.name,
            status: ur.status,
          })),
        },
      });
    } catch (error: any) {
      if (error.message?.includes('No Authorization')) {
        return reply.code(401).send({
          success: false,
          error: 'Unauthorized',
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch user',
      });
    }
  });
};

export default authRoutes;


