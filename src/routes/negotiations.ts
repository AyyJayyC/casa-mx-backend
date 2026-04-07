import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT } from '../utils/guards.js';
import { NegotiationsService } from '../services/negotiations.service.js';

const applicationIdParamSchema = z.object({
  applicationId: z.string().uuid('Invalid application ID'),
});

const offerIdParamSchema = z.object({
  offerId: z.string().uuid('Invalid offer ID'),
});

const submitOfferSchema = z.object({
  proposedRent: z.number().positive('Proposed rent must be positive'),
  proposedDeposit: z.number().nonnegative('Proposed deposit must be non-negative'),
  proposedServices: z.array(z.string()).default([]),
  proposedLeaseTerm: z.number().int().positive().optional(),
  message: z.string().optional(),
});

const negotiationsRoutes: FastifyPluginAsync = async (fastify) => {
  const negotiationsService = new NegotiationsService(fastify.prisma);

  /**
   * Helper: determine the caller's role relative to an application.
   * Returns 'landlord' if they own the property, 'tenant' if they are the applicant.
   */
  async function resolveRole(
    userId: string,
    applicationId: string,
  ): Promise<'landlord' | 'tenant' | null> {
    const app = await fastify.prisma.rentalApplication.findUnique({
      where: { id: applicationId },
      include: { property: { select: { sellerId: true } } },
    });
    if (!app) return null;
    if (app.property.sellerId === userId) return 'landlord';
    if (app.applicantId === userId) return 'tenant';
    return null;
  }

  // GET /negotiations/:applicationId - List all negotiation offers for an application
  fastify.get(
    '/negotiations/:applicationId',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { applicationId } = applicationIdParamSchema.parse(request.params);
        const role = await resolveRole(request.user.id, applicationId);

        if (!role) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied or application not found',
          });
        }

        const offers = await negotiationsService.getOffers(applicationId);
        return reply.send({ success: true, data: offers });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Invalid application ID' });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to fetch negotiations' });
      }
    },
  );

  // POST /negotiations/:applicationId/offer - Submit a new offer / counter-offer
  fastify.post(
    '/negotiations/:applicationId/offer',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { applicationId } = applicationIdParamSchema.parse(request.params);
        const input = submitOfferSchema.parse(request.body);
        const role = await resolveRole(request.user.id, applicationId);

        if (!role) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied or application not found',
          });
        }

        const offer = await negotiationsService.submitOffer(
          applicationId,
          request.user.id,
          role,
          input.proposedRent,
          input.proposedDeposit,
          input.proposedServices,
          input.proposedLeaseTerm,
          input.message,
        );

        return reply.code(201).send({
          success: true,
          data: offer,
          message: 'Offer submitted successfully',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        if (error.message === 'Application not found') {
          return reply.code(404).send({ success: false, error: 'Application not found' });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to submit offer' });
      }
    },
  );

  // POST /negotiations/offers/:offerId/accept - Accept a pending offer
  fastify.post(
    '/negotiations/offers/:offerId/accept',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { offerId } = offerIdParamSchema.parse(request.params);

        const offer = await fastify.prisma.negotiationOffer.findUnique({
          where: { id: offerId },
          select: { applicationId: true },
        });

        if (!offer) {
          return reply.code(404).send({ success: false, error: 'Offer not found' });
        }

        const role = await resolveRole(request.user.id, offer.applicationId);

        if (!role) {
          return reply.code(403).send({ success: false, error: 'Access denied' });
        }

        const result = await negotiationsService.acceptOffer(offerId, request.user.id, role);

        return reply.send({
          success: true,
          data: result,
          message: 'Offer accepted. Application approved.',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Invalid offer ID' });
        }
        if (
          error.message === 'Offer not found' ||
          error.message === 'Offer is no longer pending' ||
          error.message === 'Cannot accept your own offer'
        ) {
          return reply.code(400).send({ success: false, error: error.message });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to accept offer' });
      }
    },
  );

  // POST /negotiations/offers/:offerId/reject - Reject a pending offer
  fastify.post(
    '/negotiations/offers/:offerId/reject',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { offerId } = offerIdParamSchema.parse(request.params);

        const offer = await fastify.prisma.negotiationOffer.findUnique({
          where: { id: offerId },
          select: { applicationId: true },
        });

        if (!offer) {
          return reply.code(404).send({ success: false, error: 'Offer not found' });
        }

        const role = await resolveRole(request.user.id, offer.applicationId);

        if (!role) {
          return reply.code(403).send({ success: false, error: 'Access denied' });
        }

        await negotiationsService.rejectOffer(offerId, request.user.id, role);

        return reply.send({
          success: true,
          message: 'Offer rejected',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Invalid offer ID' });
        }
        if (
          error.message === 'Offer not found' ||
          error.message === 'Offer is no longer pending' ||
          error.message === 'Cannot reject your own offer'
        ) {
          return reply.code(400).send({ success: false, error: error.message });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to reject offer' });
      }
    },
  );
};

export default negotiationsRoutes;
