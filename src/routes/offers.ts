import { FastifyPluginAsync } from 'fastify';
import { verifyJWT, requireVerifiedEmailAndINE } from '../utils/guards.js';
import {
  createPropertyOfferSchema,
  respondPropertyOfferSchema,
  offerActionSchema,
  offerIdParamSchema,
  propertyIdParamSchema,
  offerThreadQuerySchema,
} from '../schemas/offers.js';
import { isZodError, createValidationErrorResponse, createServerErrorResponse } from '../utils/errorHandling.js';
import { createNotification } from '../services/notification.service.js';
import {
  sendOfferAcceptedEmail,
  sendOfferRejectedEmail,
  sendOfferCounteredEmail,
  sendOfferReceivedEmail,
} from '../services/email.service.js';

const offersRoutes: FastifyPluginAsync = async (fastify) => {
  const buildOfferThread = (events: any[]) => {
    const timeline = events.map((event) => ({
      id: event.id,
      parentEventId: event.parentEventId,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      amount: event.amount,
      message: event.message,
        proposedFurnishedStatus: event.proposedFurnishedStatus ?? null,
        createdAt: event.createdAt,
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

    const counterCount = timeline.filter((event) => event.action === 'counter').length;
    return {
      timeline,
      tree: roots,
      counterCount,
      latestEvent: timeline[timeline.length - 1] || null,
    };
  };

  const ensureRootEvent = async (offer: any) => {
    const existing = await fastify.prisma.propertyOfferEvent.findMany({
      where: { offerId: offer.id },
      orderBy: { createdAt: 'asc' },
    });

    if (existing.length > 0) {
      return existing;
    }

    await fastify.prisma.propertyOfferEvent.create({
      data: {
        offerId: offer.id,
        actorId: offer.buyerId,
        actorRole: 'buyer',
        action: 'offer',
        amount: offer.offerAmount,
        message: offer.message,
      },
    });

    return fastify.prisma.propertyOfferEvent.findMany({
      where: { offerId: offer.id },
      orderBy: { createdAt: 'asc' },
    });
  };

  const notifyCounterparty = async (params: {
    offer: any;
    actorRole: 'buyer' | 'seller';
    action: 'counter' | 'accept' | 'reject';
    amount?: number;
    message?: string;
  }) => {
    const { offer, actorRole, action, amount, message } = params;
    const isActorSeller = actorRole === 'seller';
    const counterpartyId = isActorSeller ? offer.buyerId : offer.property.sellerId;

    const titles: Record<string, string> = {
      counter: isActorSeller ? 'El vendedor hizo una contraoferta' : 'El comprador hizo una contraoferta',
      accept: isActorSeller ? '¡Tu oferta fue aceptada por el vendedor!' : '¡El comprador aceptó tu contraoferta!',
      reject: isActorSeller ? 'Tu oferta fue rechazada por el vendedor' : 'El comprador rechazó la negociación',
    };

    const messages: Record<string, string> = {
      counter: `${isActorSeller ? 'El vendedor' : 'El comprador'} propuso $${Number(amount ?? 0).toLocaleString('es-MX')} MXN para "${offer.property.title}".${message ? ' Nota: ' + message : ''}`,
      accept: `La negociación de "${offer.property.title}" fue aceptada en $${Number(amount ?? offer.latestAmount ?? offer.offerAmount).toLocaleString('es-MX')} MXN.`,
      reject: `La negociación de "${offer.property.title}" terminó en rechazo.${message ? ' Nota: ' + message : ''}`,
    };

    await createNotification(
      fastify.prisma,
      counterpartyId,
      `offer_${action}` as any,
      titles[action],
      messages[action],
      'offer',
      offer.id
    );

    if (isActorSeller) {
      const buyer = await fastify.prisma.user.findUnique({ where: { id: offer.buyerId }, select: { email: true, name: true } });
      if (buyer) {
        if (action === 'accept') {
          await sendOfferAcceptedEmail({
            buyerEmail: buyer.email,
            buyerName: buyer.name,
            propertyTitle: offer.property.title,
            offeredAmount: Number(amount ?? offer.latestAmount ?? offer.offerAmount),
          });
        } else if (action === 'reject') {
          await sendOfferRejectedEmail({
            buyerEmail: buyer.email,
            buyerName: buyer.name,
            propertyTitle: offer.property.title,
            offeredAmount: Number(offer.offerAmount),
          });
        } else if (action === 'counter') {
          await sendOfferCounteredEmail({
            buyerEmail: buyer.email,
            buyerName: buyer.name,
            propertyTitle: offer.property.title,
            counterAmount: Number(amount ?? 0),
            sellerNote: message,
          });
        }
      }
    }
  };


  /**
   * POST /properties/:propertyId/offers
   * Buyer submits an offer on a sale property.
   */
  fastify.post(
    '/properties/:propertyId/offers',
    { onRequest: [verifyJWT, requireVerifiedEmailAndINE] },
    async (request, reply) => {
      try {
        const { propertyId } = propertyIdParamSchema.parse(request.params);
        const input = createPropertyOfferSchema.parse(request.body);
        const buyerId = request.user.id;

        const property = await fastify.prisma.property.findUnique({
          where: { id: propertyId },
          select: { id: true, listingType: true, status: true, title: true, sellerId: true },
        });

        if (!property) {
          return reply.code(404).send({ success: false, error: 'Property not found' });
        }
        if (property.listingType !== 'for_sale') {
          return reply.code(400).send({ success: false, error: 'Offers can only be made on sale properties' });
        }
        if (property.status !== 'available') {
          return reply.code(400).send({ success: false, error: 'This property is no longer available' });
        }

        const offer = await fastify.prisma.$transaction(async (tx) => {
          const createdOffer = await tx.propertyOffer.create({
            data: {
              propertyId,
              buyerId,
              offerAmount: input.offerAmount,
              financing: input.financing,
              closingDate: input.closingDate ? new Date(input.closingDate) : null,
              message: input.message,
              enganche: input.enganche,
              plazoMeses: input.plazoMeses,
              cuotaMensual: input.cuotaMensual,
              buyerName: input.buyerName,
              buyerEmail: input.buyerEmail,
              buyerPhone: input.buyerPhone,
              latestAmount: input.offerAmount,
              lastActionByRole: 'buyer',
            },
          });

          await tx.propertyOfferEvent.create({
            data: {
              offerId: createdOffer.id,
              actorId: buyerId,
              actorRole: 'buyer',
              action: 'offer',
              amount: input.offerAmount,
              message: input.message,
              proposedFurnishedStatus: input.proposedFurnishedStatus,
            },
          });

          return createdOffer;
        });

        // Notify seller of the new offer
        const seller = await fastify.prisma.user.findUnique({ where: { id: property.sellerId! }, select: { email: true, name: true } });
        const buyer = await fastify.prisma.user.findUnique({ where: { id: buyerId }, select: { name: true } });
        if (seller) {
          await createNotification(fastify.prisma, property.sellerId!, 'offer_received', 'Nueva oferta recibida', `${buyer?.name ?? 'Un comprador'} hizo una oferta de $${Number(input.offerAmount).toLocaleString('es-MX')} MXN por "${property.title}".`, 'offer', offer.id);
          await sendOfferReceivedEmail({ sellerEmail: seller.email, sellerName: seller.name, propertyTitle: property.title, offeredAmount: Number(input.offerAmount), buyerName: buyer?.name ?? 'Un comprador' });
        }

        return reply.code(201).send({ success: true, data: offer });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply.code(500).send(createServerErrorResponse('Failed to submit offer'));
      }
    }
  );

  /**
   * GET /offers/:id/thread
   * Buyer or seller views the negotiation tree/timeline for one offer.
   */
  fastify.get(
    '/offers/:id/thread',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { id } = offerIdParamSchema.parse(request.params);
        const { includeTree } = offerThreadQuerySchema.parse(request.query);
        const userId = request.user.id;

        const offer = await fastify.prisma.propertyOffer.findUnique({
          where: { id },
          include: {
            property: { select: { id: true, title: true, sellerId: true } },
          },
        });

        if (!offer) {
          return reply.code(404).send({ success: false, error: 'Offer not found' });
        }

        if (offer.buyerId !== userId && offer.property.sellerId !== userId) {
          return reply.code(403).send({ success: false, error: 'Not authorized to view this negotiation' });
        }

        const events = await ensureRootEvent(offer);
        const thread = buildOfferThread(events);

        return reply.send({
          success: true,
          data: {
            offer,
            timeline: thread.timeline,
            ...(includeTree ? { tree: thread.tree } : {}),
            canReject: thread.counterCount >= 2,
            latestEvent: thread.latestEvent,
            isTerminal: ['accepted', 'rejected'].includes(offer.status),
          },
        });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply.code(500).send(createServerErrorResponse('Failed to fetch offer thread'));
      }
    }
  );

  /**
   * GET /properties/:propertyId/offers
   * Seller views all offers on their property.
   */
  fastify.get(
    '/properties/:propertyId/offers',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { propertyId } = propertyIdParamSchema.parse(request.params);
        const userId = request.user.id;

        const property = await fastify.prisma.property.findUnique({
          where: { id: propertyId },
          select: { sellerId: true },
        });

        if (!property) {
          return reply.code(404).send({ success: false, error: 'Property not found' });
        }
        if (property.sellerId !== userId) {
          return reply.code(403).send({ success: false, error: 'Only the property owner can view offers' });
        }

        const offers = await fastify.prisma.propertyOffer.findMany({
          where: { propertyId },
          orderBy: { createdAt: 'desc' },
        });

        return reply.send({ success: true, data: offers });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to fetch offers' });
      }
    }
  );

  /**
   * GET /offers/mine
   * Buyer views their own submitted offers.
   */
  fastify.get(
    '/offers/mine',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const buyerId = request.user.id;
        const offers = await fastify.prisma.propertyOffer.findMany({
          where: { buyerId },
          include: {
            property: { select: { id: true, title: true, price: true, imageUrls: true, colonia: true, estado: true } },
            events: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return reply.send({ success: true, data: offers });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to fetch offers' });
      }
    }
  );

  /**
   * GET /offers/seller
   * Seller views all offers across all their properties.
   */
  fastify.get(
    '/offers/seller',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const sellerId = request.user.id;
        const offers = await fastify.prisma.propertyOffer.findMany({
          where: { property: { sellerId } },
          include: {
            property: { select: { id: true, title: true, price: true, imageUrls: true, colonia: true, estado: true } },
            events: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        });

        return reply.send({ success: true, data: offers });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to fetch offers' });
      }
    }
  );

  /**
   * POST /offers/:id/respond
   * Buyer or seller responds with counter/accept/reject in a multi-turn thread.
   */
  fastify.post(
    '/offers/:id/respond',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { id } = offerIdParamSchema.parse(request.params);
        const input = offerActionSchema.parse(request.body);
        const userId = request.user.id;

        const offer = await fastify.prisma.propertyOffer.findUnique({
          where: { id },
          include: { property: { select: { sellerId: true, id: true, title: true } } },
        });

        if (!offer) {
          return reply.code(404).send({ success: false, error: 'Offer not found' });
        }
        const actorRole = offer.property.sellerId === userId ? 'seller' : offer.buyerId === userId ? 'buyer' : null;
        if (!actorRole) {
          return reply.code(403).send({ success: false, error: 'Not authorized to respond to this offer' });
        }

        if (offer.status === 'accepted' || offer.status === 'rejected') {
          return reply.code(400).send({ success: false, error: 'This negotiation is already closed' });
        }

        const events = await ensureRootEvent(offer);
        const thread = buildOfferThread(events);
        const latestEvent = thread.latestEvent;

        if (!latestEvent) {
          return reply.code(400).send({ success: false, error: 'Offer thread is corrupted (no events found)' });
        }

        if (latestEvent.actorRole === actorRole) {
          return reply.code(400).send({ success: false, error: 'Wait for the other party to respond before acting again' });
        }

        if (input.parentEventId && latestEvent.id !== input.parentEventId) {
          return reply.code(400).send({ success: false, error: 'Only the latest event can be responded to in active negotiations' });
        }

        if (input.action === 'counter' && !input.amount) {
          return reply.code(400).send({ success: false, error: 'amount is required when countering' });
        }

        if (input.action === 'reject' && thread.counterCount < 2) {
          return reply.code(400).send({
            success: false,
            error: 'Rejection is available only after multiple counter rounds. Continue negotiating first.',
          });
        }

        const actionToStatus: Record<string, string> = {
          counter: 'countered',
          accept: 'accepted',
          reject: 'rejected',
        };

        const nextAmount = input.action === 'counter' ? Number(input.amount) : Number(latestEvent.amount);

        const updated = await fastify.prisma.$transaction(async (tx) => {
          await tx.propertyOfferEvent.create({
            data: {
              offerId: offer.id,
              parentEventId: latestEvent.id,
              actorId: userId,
              actorRole,
              action: input.action,
              amount: nextAmount,
              message: input.message,
              proposedFurnishedStatus: input.proposedFurnishedStatus,
            },
          });

          const updatedOffer = await tx.propertyOffer.update({
            where: { id },
            data: {
              status: actionToStatus[input.action],
              sellerNote: actorRole === 'seller' ? input.message : offer.sellerNote,
              counterAmount: input.action === 'counter' ? nextAmount : offer.counterAmount,
              latestAmount: nextAmount,
              lastActionByRole: actorRole,
              ...(input.action === 'accept' && input.proposedFurnishedStatus ? { agreedFurnishedStatus: input.proposedFurnishedStatus } : {}),
            },
          });

          if (input.action === 'accept') {
            await tx.property.update({
              where: { id: offer.property.id },
              data: { status: 'sold' },
            });
            await tx.propertyOffer.updateMany({
              where: {
                propertyId: offer.property.id,
                id: { not: id },
                status: { in: ['pending', 'countered'] },
              },
              data: { status: 'rejected', sellerNote: 'Another offer was accepted for this property' },
            });
          }

          return updatedOffer;
        });

        await notifyCounterparty({
          offer,
          actorRole: actorRole as 'buyer' | 'seller',
          action: input.action,
          amount: nextAmount,
          message: input.message,
        });

        const updatedEvents = await fastify.prisma.propertyOfferEvent.findMany({
          where: { offerId: offer.id },
          orderBy: { createdAt: 'asc' },
        });
        const updatedThread = buildOfferThread(updatedEvents);

        return reply.send({
          success: true,
          data: {
            offer: updated,
            timeline: updatedThread.timeline,
            tree: updatedThread.tree,
            canReject: updatedThread.counterCount >= 2,
            latestEvent: updatedThread.latestEvent,
            isTerminal: ['accepted', 'rejected'].includes(updated.status),
          },
        });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply.code(500).send(createServerErrorResponse('Failed to update offer negotiation'));
      }
    }
  );

  /**
   * PATCH /offers/:id
   * Backward-compatible seller-only endpoint now mapped to the unified respond action.
   */
  fastify.patch(
    '/offers/:id',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { id } = offerIdParamSchema.parse(request.params);
        const input = respondPropertyOfferSchema.parse(request.body);

        const actionMap: Record<string, 'counter' | 'accept' | 'reject'> = {
          countered: 'counter',
          accepted: 'accept',
          rejected: 'reject',
        };

        const mappedAction = actionMap[input.status];
        const payload: any = {
          action: mappedAction,
          amount: input.counterAmount,
          message: input.sellerNote,
        };

        (request as any).body = payload;
        (request as any).params = { id };

        return (fastify as any).inject({
          method: 'POST',
          url: `/offers/${id}/respond`,
          payload,
          cookies: (request as any).cookies,
          headers: request.headers,
        }).then((response: any) => reply.code(response.statusCode).send(response.json()));
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply.code(500).send(createServerErrorResponse('Failed to process legacy offer response'));
      }
    }
  );
};

export default offersRoutes;
