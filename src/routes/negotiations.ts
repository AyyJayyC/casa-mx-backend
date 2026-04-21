import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import {
  StartNegotiationSchema,
  CounterOfferSchema,
  RespondOfferSchema,
} from '../schemas/negotiations.js';

const negotiationsRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /negotiations
   * Tenant starts a negotiation on one of their rental applications.
   */
  fastify.post('/negotiations', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const input = StartNegotiationSchema.parse(request.body);
      const userId = request.user.id;

      // Verify the application belongs to the requesting user
      const application = await fastify.prisma.rentalApplication.findUnique({
        where: { id: input.rentalApplicationId },
        include: { property: { select: { sellerId: true, monthlyRent: true, title: true } } },
      });

      if (!application) {
        return reply.code(404).send({ success: false, error: 'Application not found' });
      }

      if (application.applicantId !== userId) {
        return reply.code(403).send({ success: false, error: 'Only the applicant can start a negotiation' });
      }

      if (!application.property.monthlyRent) {
        return reply.code(400).send({ success: false, error: 'Property has no rent set' });
      }

      // Check no active negotiation exists
      const existing = await fastify.prisma.negotiation.findUnique({
        where: { rentalApplicationId: input.rentalApplicationId },
      });

      if (existing && existing.status === 'open') {
        return reply.code(409).send({ success: false, error: 'A negotiation is already open for this application' });
      }

      const negotiation = await fastify.prisma.negotiation.create({
        data: {
          rentalApplicationId: input.rentalApplicationId,
          propertyId: application.propertyId,
          applicantId: userId,
          landlordId: application.property.sellerId,
          originalRent: application.property.monthlyRent,
          offers: {
            create: {
              authorId: userId,
              authorRole: 'tenant',
              proposedRent: input.proposedRent,
              message: input.message,
              status: 'pending',
            },
          },
        },
        include: { offers: true },
      });

      return reply.code(201).send({ success: true, negotiation });
    } catch (error: any) {
      if (error.constructor?.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to start negotiation' });
    }
  });

  /**
   * GET /negotiations/:id
   * Get negotiation details (accessible by applicant or landlord).
   */
  fastify.get<{ Params: { id: string } }>(
    '/negotiations/:id',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const negotiation = await fastify.prisma.negotiation.findUnique({
        where: { id: request.params.id },
        include: { offers: { orderBy: { createdAt: 'asc' } } },
      });

      if (!negotiation) return reply.code(404).send({ success: false, error: 'Not found' });

      const userId = request.user.id;
      if (negotiation.applicantId !== userId && negotiation.landlordId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      return reply.send({ success: true, negotiation });
    }
  );

  /**
   * GET /negotiations/by-application/:applicationId
   * Get negotiation for a specific rental application.
   */
  fastify.get<{ Params: { applicationId: string } }>(
    '/negotiations/by-application/:applicationId',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const negotiation = await fastify.prisma.negotiation.findUnique({
        where: { rentalApplicationId: request.params.applicationId },
        include: { offers: { orderBy: { createdAt: 'asc' } } },
      });

      if (!negotiation) return reply.send({ success: true, negotiation: null });

      const userId = request.user.id;
      if (negotiation.applicantId !== userId && negotiation.landlordId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      return reply.send({ success: true, negotiation });
    }
  );

  /**
   * POST /negotiations/:id/counter
   * Submit a counter-offer (tenant or landlord).
   */
  fastify.post<{ Params: { id: string } }>(
    '/negotiations/:id/counter',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const input = CounterOfferSchema.parse(request.body);
        const userId = request.user.id;

        const negotiation = await fastify.prisma.negotiation.findUnique({
          where: { id: request.params.id },
          include: { offers: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });

        if (!negotiation) return reply.code(404).send({ success: false, error: 'Negotiation not found' });
        if (negotiation.status !== 'open') {
          return reply.code(409).send({ success: false, error: 'Negotiation is no longer open' });
        }

        const isApplicant = negotiation.applicantId === userId;
        const isLandlord = negotiation.landlordId === userId;

        if (!isApplicant && !isLandlord) {
          return reply.code(403).send({ success: false, error: 'Access denied' });
        }

        const authorRole = isApplicant ? 'tenant' : 'landlord';
        const lastOffer = negotiation.offers[0];

        // Prevent the same party from countering twice in a row
        if (lastOffer && lastOffer.authorRole === authorRole && lastOffer.status === 'pending') {
          return reply.code(409).send({ success: false, error: 'Aguarda la respuesta del otro lado antes de contraofertar' });
        }

        // Mark previous offer as countered
        if (lastOffer && lastOffer.status === 'pending') {
          await fastify.prisma.negotiationOffer.update({
            where: { id: lastOffer.id },
            data: { status: 'countered' },
          });
        }

        const offer = await fastify.prisma.negotiationOffer.create({
          data: {
            negotiationId: negotiation.id,
            authorId: userId,
            authorRole,
            proposedRent: input.proposedRent,
            message: input.message,
            status: 'pending',
          },
        });

        return reply.code(201).send({ success: true, offer });
      } catch (error: any) {
        if (error.constructor?.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to submit counter-offer' });
      }
    }
  );

  /**
   * POST /negotiations/:id/respond
   * Accept or reject the latest offer (the party that did NOT submit it).
   */
  fastify.post<{ Params: { id: string } }>(
    '/negotiations/:id/respond',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { action } = RespondOfferSchema.parse(request.body);
        const userId = request.user.id;

        const negotiation = await fastify.prisma.negotiation.findUnique({
          where: { id: request.params.id },
          include: { offers: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });

        if (!negotiation) return reply.code(404).send({ success: false, error: 'Negotiation not found' });
        if (negotiation.status !== 'open') {
          return reply.code(409).send({ success: false, error: 'Negotiation already closed' });
        }

        const isApplicant = negotiation.applicantId === userId;
        const isLandlord = negotiation.landlordId === userId;

        if (!isApplicant && !isLandlord) {
          return reply.code(403).send({ success: false, error: 'Access denied' });
        }

        const latestOffer = negotiation.offers[0];
        if (!latestOffer || latestOffer.status !== 'pending') {
          return reply.code(400).send({ success: false, error: 'No pending offer to respond to' });
        }

        // Can't respond to your own offer
        if (latestOffer.authorId === userId) {
          return reply.code(409).send({ success: false, error: 'No puedes responder a tu propia oferta' });
        }

        const offerStatus = action === 'accept' ? 'accepted' : 'rejected';
        const negotiationStatus = action === 'accept' ? 'accepted' : 'rejected';

        await fastify.prisma.$transaction([
          fastify.prisma.negotiationOffer.update({
            where: { id: latestOffer.id },
            data: { status: offerStatus },
          }),
          fastify.prisma.negotiation.update({
            where: { id: negotiation.id },
            data: {
              status: negotiationStatus,
              finalRent: action === 'accept' ? latestOffer.proposedRent : undefined,
            },
          }),
        ]);

        return reply.send({ success: true, status: negotiationStatus, finalRent: action === 'accept' ? latestOffer.proposedRent : undefined });
      } catch (error: any) {
        if (error.constructor?.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to respond to offer' });
      }
    }
  );
};

export default negotiationsRoutes;
