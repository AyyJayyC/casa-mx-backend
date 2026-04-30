import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import {
  StartNegotiationSchema,
  CounterOfferSchema,
  RespondOfferSchema,
} from '../schemas/negotiations.js';

const negotiationsRoutes: FastifyPluginAsync = async (fastify) => {
  const buildNegotiationThread = (offers: any[]) => {
    const timeline = offers.map((offer: any, index: number) => ({
      id: offer.id,
      parentEventId: index > 0 ? offers[index - 1]?.id ?? null : null,
      actorId: offer.authorId,
      actorRole: offer.authorRole,
      action: index === 0 ? 'offer' : 'counter',
      amount: offer.proposedRent,
      message: offer.message,
      status: offer.status,
      createdAt: offer.createdAt,
    }));

    const nodeMap = new Map<string, any>();
    for (const event of timeline) {
      nodeMap.set(event.id, { ...event, children: [] as any[] });
    }

    const roots: any[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentEventId && nodeMap.has(node.parentEventId)) {
        nodeMap.get(node.parentEventId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    const counterCount = Math.max(0, timeline.length - 1);
    return {
      timeline,
      tree: roots,
      counterCount,
      latestEvent: timeline[timeline.length - 1] || null,
    };
  };

  /**
   * POST /negotiations
   * Tenant starts a negotiation on one of their rental applications.
   */
  fastify.post('/negotiations', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const input = StartNegotiationSchema.parse(request.body);
      const userId = request.user.id;

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
        include: { offers: { orderBy: { createdAt: 'asc' } } },
      });

      const thread = buildNegotiationThread(negotiation.offers);

      return reply.code(201).send({
        success: true,
        negotiation,
        data: {
          negotiation,
          timeline: thread.timeline,
          tree: thread.tree,
          canReject: thread.counterCount >= 2,
          latestEvent: thread.latestEvent,
          isTerminal: negotiation.status !== 'open',
        },
      });
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

      const thread = buildNegotiationThread(negotiation.offers);
      return reply.send({
        success: true,
        negotiation,
        data: {
          negotiation,
          timeline: thread.timeline,
          tree: thread.tree,
          canReject: thread.counterCount >= 2,
          latestEvent: thread.latestEvent,
          isTerminal: negotiation.status !== 'open',
        },
      });
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

      if (!negotiation) return reply.send({ success: true, negotiation: null, data: { negotiation: null } });

      const userId = request.user.id;
      if (negotiation.applicantId !== userId && negotiation.landlordId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const thread = buildNegotiationThread(negotiation.offers);
      return reply.send({
        success: true,
        negotiation,
        data: {
          negotiation,
          timeline: thread.timeline,
          tree: thread.tree,
          canReject: thread.counterCount >= 2,
          latestEvent: thread.latestEvent,
          isTerminal: negotiation.status !== 'open',
        },
      });
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

        if (lastOffer && lastOffer.authorRole === authorRole && lastOffer.status === 'pending') {
          return reply.code(409).send({ success: false, error: 'Aguarda la respuesta del otro lado antes de contraofertar' });
        }

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

        const refreshed = await fastify.prisma.negotiation.findUnique({
          where: { id: request.params.id },
          include: { offers: { orderBy: { createdAt: 'asc' } } },
        });

        if (!refreshed) return reply.code(404).send({ success: false, error: 'Negotiation not found' });
        const thread = buildNegotiationThread(refreshed.offers);

        return reply.code(201).send({
          success: true,
          offer,
          data: {
            negotiation: refreshed,
            timeline: thread.timeline,
            tree: thread.tree,
            canReject: thread.counterCount >= 2,
            latestEvent: thread.latestEvent,
            isTerminal: refreshed.status !== 'open',
          },
        });
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
          include: { offers: { orderBy: { createdAt: 'asc' } } },
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

        const latestOffer = negotiation.offers[negotiation.offers.length - 1];
        if (!latestOffer || latestOffer.status !== 'pending') {
          return reply.code(400).send({ success: false, error: 'No pending offer to respond to' });
        }

        const thread = buildNegotiationThread(negotiation.offers);
        if (action === 'reject' && thread.counterCount < 2) {
          return reply.code(400).send({ success: false, error: 'Rejection is available only after multiple counter rounds. Continue negotiating first.' });
        }

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

        const updatedNegotiation = await fastify.prisma.negotiation.findUnique({
          where: { id: request.params.id },
          include: { offers: { orderBy: { createdAt: 'asc' } } },
        });

        if (!updatedNegotiation) return reply.code(404).send({ success: false, error: 'Negotiation not found' });
        const updatedThread = buildNegotiationThread(updatedNegotiation.offers);

        return reply.send({
          success: true,
          status: negotiationStatus,
          finalRent: action === 'accept' ? latestOffer.proposedRent : undefined,
          data: {
            negotiation: updatedNegotiation,
            timeline: updatedThread.timeline,
            tree: updatedThread.tree,
            canReject: updatedThread.counterCount >= 2,
            latestEvent: updatedThread.latestEvent,
            isTerminal: updatedNegotiation.status !== 'open',
          },
        });
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
