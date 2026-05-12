import { FastifyPluginAsync } from 'fastify';
import { verifyJWT, requireAdmin } from '../utils/guards.js';
import { z } from 'zod';
import crypto from 'node:crypto';

const agencyCreateSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(300).optional(),
  rfc: z.string().max(20).optional(),
  ownerId: z.string().uuid(),
  referredById: z.string().uuid().optional(),
});

const agenciesRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /agencies — create agency (admin only)
  fastify.post<{ Body: Record<string, any> }>(
    '/agencies',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const input = agencyCreateSchema.parse(request.body);

        // Check owner exists
        const owner = await fastify.prisma.user.findUnique({ where: { id: input.ownerId } });
        if (!owner) {
          return reply.code(400).send({ success: false, error: 'Owner user not found' });
        }

        // Check owner doesn't already own an agency
        const existingAgency = await fastify.prisma.agency.findUnique({
          where: { ownerId: input.ownerId },
        });
        if (existingAgency) {
          return reply.code(409).send({ success: false, error: 'User already owns an agency' });
        }

        // Generate unique referral code
        const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();

        const agency = await fastify.prisma.agency.create({
          data: {
            name: input.name,
            legalName: input.legalName || null,
            rfc: input.rfc || null,
            ownerId: input.ownerId,
            referredById: input.referredById || null,
            referralCode,
          },
          include: {
            owner: { select: { id: true, name: true, email: true } },
          },
        });

        return reply.code(201).send({ success: true, data: agency });
      } catch (error: any) {
        if (error.constructor?.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to create agency' });
      }
    }
  );

  // GET /agencies/me — get current user's owned agency
  fastify.get('/agencies/me', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const agency = await fastify.prisma.agency.findUnique({
        where: { ownerId: userId },
        include: {
          owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
          _count: { select: { members: true } },
        },
      });

      if (!agency) {
        return reply.code(404).send({ success: false, error: 'No agency found for this user' });
      }

      return reply.send({ success: true, data: agency });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to get agency' });
    }
  });

  // GET /agencies/me/agents — list agents under current user's agency
  fastify.get('/agencies/me/agents', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const agency = await fastify.prisma.agency.findUnique({
        where: { ownerId: userId },
        select: { id: true },
      });

      if (!agency) {
        return reply.code(404).send({ success: false, error: 'No agency found' });
      }

      const agents = await fastify.prisma.user.findMany({
        where: { agencyId: agency.id },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          createdAt: true,
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formatted = agents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        avatarUrl: a.avatarUrl,
        createdAt: a.createdAt,
        roles: a.roles.map((r) => r.role.name),
      }));

      return reply.send({ success: true, data: formatted });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to get agents' });
    }
  });
};

export default agenciesRoutes;
