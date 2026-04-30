import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT } from '../utils/guards.js';
import { updateMeSchema, userIdParamSchema } from '../schemas/users.js';
import { computeBadgeFlags } from '../utils/badges.js';
import { uploadToS3, deleteFromS3, getPresignedUrl, isS3Configured } from '../services/s3.service.js';

const AVATAR_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX_SIZE = 5 * 1024 * 1024;

async function resolveAvatarUrl(rawAvatarUrl: string | null | undefined): Promise<string | null> {
  if (!rawAvatarUrl) return null;
  if (rawAvatarUrl.startsWith('http://') || rawAvatarUrl.startsWith('https://') || rawAvatarUrl.startsWith('data:')) {
    return rawAvatarUrl;
  }

  if (isS3Configured() && !rawAvatarUrl.startsWith('local/')) {
    try {
      return await getPresignedUrl(rawAvatarUrl);
    } catch {
      return null;
    }
  }

  return rawAvatarUrl;
}

function hasAdminRole(roles: any[]): boolean {
  return roles.includes('admin') || roles.some((r: any) => r?.name === 'admin');
}

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/users/me/avatar', { onRequest: [verifyJWT] }, async (request, reply) => {
    const userId = request.user.id;
    if (!userId) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMimeType = '';

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileMimeType = part.mimetype;
        fileName = part.filename || 'avatar';
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ success: false, error: 'No avatar file uploaded' });
    }

    if (!AVATAR_ALLOWED_TYPES.has(fileMimeType)) {
      return reply.code(400).send({ success: false, error: 'Avatar file type not allowed. Use JPEG, PNG, or WebP.' });
    }

    if (fileBuffer.length > AVATAR_MAX_SIZE) {
      return reply.code(400).send({ success: false, error: 'Avatar file too large. Maximum 5MB.' });
    }

    const currentUser = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    if (!currentUser) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    let avatarKey = `local/avatars/${userId}/${Date.now()}-${fileName}`;
    if (isS3Configured()) {
      try {
        const uploaded = await uploadToS3(fileBuffer, fileName, fileMimeType, `avatars/${userId}`);
        avatarKey = uploaded.key;
      } catch (err) {
        fastify.log.error({ err }, 'S3 avatar upload failed');
        return reply.code(500).send({ success: false, error: 'Avatar upload failed. Please try again.' });
      }
    }

    if (
      currentUser.avatarUrl &&
      isS3Configured() &&
      !currentUser.avatarUrl.startsWith('http://') &&
      !currentUser.avatarUrl.startsWith('https://') &&
      !currentUser.avatarUrl.startsWith('local/')
    ) {
      try {
        await deleteFromS3(currentUser.avatarUrl);
      } catch (err) {
        fastify.log.warn({ err }, 'Old avatar deletion failed');
      }
    }

    const updated = await fastify.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarKey },
      select: { avatarUrl: true },
    });

    return reply.send({
      success: true,
      data: {
        avatarUrl: await resolveAvatarUrl(updated.avatarUrl),
      },
    });
  });

  fastify.get('/users/me', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: { include: { role: true } },
          userDocuments: {
            where: { documentType: 'official_id' },
            select: { documentType: true, isVerified: true },
          },
          subscription: {
            select: { status: true, currentPeriodEnd: true },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found',
        });
      }

      const badges = computeBadgeFlags(user as any);
      const avatarUrl = await resolveAvatarUrl(user.avatarUrl);

      return reply.send({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl,
          phone: user.phone,
          whatsapp: user.whatsapp,
          roles: user.roles.map((ur) => ({
            roleId: ur.roleId,
            roleName: ur.role.name,
            status: ur.status,
          })),
          emailVerified: user.emailVerified,
          officialIdUploaded: badges.officialIdUploaded,
          officialIdVerified: badges.officialIdVerified,
          paidSubscriber: badges.paidSubscriber,
          subscriptionStatus: badges.subscriptionStatus,
          subscriptionCurrentPeriodEnd: badges.subscriptionCurrentPeriodEnd,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
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
          ...(input.whatsapp !== undefined ? { whatsapp: input.whatsapp } : {}),
          ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
        },
        include: {
          roles: { include: { role: true } },
          userDocuments: {
            where: { documentType: 'official_id' },
            select: { documentType: true, isVerified: true },
          },
          subscription: {
            select: { status: true, currentPeriodEnd: true },
          },
        },
      });

      const badges = computeBadgeFlags(updated as any);
      const avatarUrl = await resolveAvatarUrl(updated.avatarUrl);

      return reply.send({
        success: true,
        data: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          avatarUrl,
          phone: updated.phone,
          whatsapp: updated.whatsapp,
          roles: updated.roles.map((ur) => ({
            roleId: ur.roleId,
            roleName: ur.role.name,
            status: ur.status,
          })),
          emailVerified: updated.emailVerified,
          officialIdUploaded: badges.officialIdUploaded,
          officialIdVerified: badges.officialIdVerified,
          paidSubscriber: badges.paidSubscriber,
          subscriptionStatus: badges.subscriptionStatus,
          subscriptionCurrentPeriodEnd: badges.subscriptionCurrentPeriodEnd,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
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
          error: 'Email already exists',
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to update current user',
      });
    }
  });

  fastify.get('/users/:id', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const params = userIdParamSchema.parse(request.params);
      const requesterId = request.user.id;
      const admin = hasAdminRole(request.user?.roles || []);

      if (!admin && requesterId !== params.id) {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden - You can only view your own profile',
        });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: params.id },
        include: {
          roles: { include: { role: true } },
          userDocuments: {
            where: { documentType: 'official_id' },
            select: { documentType: true, isVerified: true },
          },
          subscription: {
            select: { status: true, currentPeriodEnd: true },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found',
        });
      }

      const badges = computeBadgeFlags(user as any);
      const avatarUrl = await resolveAvatarUrl(user.avatarUrl);

      return reply.send({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl,
          roles: user.roles.map((ur) => ({
            roleId: ur.roleId,
            roleName: ur.role.name,
            status: ur.status,
          })),
          emailVerified: user.emailVerified,
          officialIdUploaded: badges.officialIdUploaded,
          officialIdVerified: badges.officialIdVerified,
          paidSubscriber: badges.paidSubscriber,
          subscriptionStatus: badges.subscriptionStatus,
          subscriptionCurrentPeriodEnd: badges.subscriptionCurrentPeriodEnd,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
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
