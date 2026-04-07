import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT } from '../utils/guards.js';
import { updateMeSchema, updateProfilePictureSchema, userIdParamSchema } from '../schemas/users.js';

function hasAdminRole(request: any) {
  const roles = request.user?.roles || [];
  return roles.includes('admin') || roles.some((r: any) => r?.name === 'admin');
}

function formatUser(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  bio: string | null;
  profilePictureUrl: string | null;
  isEmailVerified: boolean;
  emailVerifiedAt: Date | null;
  roles: Array<{ roleId: string; role: { name: string }; status: string }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    bio: user.bio,
    profilePictureUrl: user.profilePictureUrl,
    isEmailVerified: user.isEmailVerified,
    emailVerifiedAt: user.emailVerifiedAt,
    roles: user.roles.map((ur) => ({
      roleId: ur.roleId,
      roleName: ur.role.name,
      status: ur.status,
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users/me', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found',
        });
      }

      return reply.send({
        success: true,
        data: formatUser(user),
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch current user',
      });
    }
  });

  fastify.patch('/users/me', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const input = updateMeSchema.parse(request.body);
      const userId = request.user.id;

      const updated = await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
        },
        include: { roles: { include: { role: true } } },
      });

      return reply.send({
        success: true,
        data: formatUser(updated),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error?.code === 'P2002') {
        return reply.code(409).send({
          success: false,
          error: 'Email or phone already exists',
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to update current user',
      });
    }
  });

  /**
   * PATCH /users/me/picture
   * Update the authenticated user's profile picture URL.
   */
  fastify.patch('/users/me/picture', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const input = updateProfilePictureSchema.parse(request.body);
      const userId = request.user.id;

      const updated = await fastify.prisma.user.update({
        where: { id: userId },
        data: { profilePictureUrl: input.profilePictureUrl },
        include: { roles: { include: { role: true } } },
      });

      return reply.send({
        success: true,
        data: formatUser(updated),
        message: 'Profile picture updated successfully',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to update profile picture',
      });
    }
  });

  fastify.get('/users/:id', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const params = userIdParamSchema.parse(request.params);
      const requesterId = request.user.id;
      const admin = hasAdminRole(request);

      if (!admin && requesterId !== params.id) {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden - You can only view your own profile',
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: params.id },
        include: { roles: { include: { role: true } } },
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found',
        });
      }

      return reply.send({
        success: true,
        data: formatUser(user),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
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

export default usersRoutes;
