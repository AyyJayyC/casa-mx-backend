import { FastifyPluginAsync } from 'fastify';
import { RegisterSchema, LoginSchema } from '../schemas/auth.js';
import { AuthService } from '../services/auth.service.js';
import { env } from '../config/env.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.prisma);

  fastify.post<{ Body: Record<string, any> }>(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 50 : 5,
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
          max: env.NODE_ENV === 'test' ? 100 : 10,
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
          },
          { expiresIn: '7d' }
        );

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
        const { refreshToken } = request.body;

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

          return reply.code(200).send({
            success: true,
            token: newToken,
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

  fastify.post('/auth/logout', async (request, reply) => {
    // For now, JWT logout is handled client-side (token deletion)
    // In production, implement token blacklist/revocation
    return reply.code(200).send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  fastify.get('/auth/me', async (request, reply) => {
    try {
      await request.jwtVerify();

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


