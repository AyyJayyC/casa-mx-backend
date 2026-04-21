import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import {
  createPropertyOfferSchema,
  respondPropertyOfferSchema,
  offerIdParamSchema,
  propertyIdParamSchema,
} from '../schemas/offers.js';
import { createNotification } from '../services/notification.service.js';
import {
  sendOfferAcceptedEmail,
  sendOfferRejectedEmail,
  sendOfferCounteredEmail,
  sendOfferReceivedEmail,
} from '../services/email.service.js';

const offersRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /properties/:propertyId/offers
   * Buyer submits an offer on a sale property.
   */
  fastify.post(
    '/properties/:propertyId/offers',
    { onRequest: [verifyJWT] },
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

        const offer = await fastify.prisma.propertyOffer.create({
          data: {
            propertyId,
            buyerId,
            offerAmount: input.offerAmount,
            financing: input.financing,
            closingDate: input.closingDate ? new Date(input.closingDate) : null,
            message: input.message,
            enganche:     input.enganche,
            plazoMeses:   input.plazoMeses,
            cuotaMensual: input.cuotaMensual,
            buyerName: input.buyerName,
            buyerEmail: input.buyerEmail,
            buyerPhone: input.buyerPhone,
          },
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
        if (error.constructor?.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to submit offer' });
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
   * PATCH /offers/:id
   * Seller responds to an offer: accept, reject, or counter.
   */
  fastify.patch(
    '/offers/:id',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { id } = offerIdParamSchema.parse(request.params);
        const input = respondPropertyOfferSchema.parse(request.body);
        const userId = request.user.id;

        const offer = await fastify.prisma.propertyOffer.findUnique({
          where: { id },
          include: { property: { select: { sellerId: true, id: true, title: true } } },
        });

        if (!offer) {
          return reply.code(404).send({ success: false, error: 'Offer not found' });
        }
        if (offer.property.sellerId !== userId) {
          return reply.code(403).send({ success: false, error: 'Only the property owner can respond to offers' });
        }
        if (offer.status !== 'pending') {
          return reply.code(400).send({ success: false, error: 'This offer has already been responded to' });
        }
        if (input.status === 'countered' && !input.counterAmount) {
          return reply.code(400).send({ success: false, error: 'counterAmount is required when countering' });
        }

        const updated = await fastify.prisma.propertyOffer.update({
          where: { id },
          data: {
            status: input.status,
            sellerNote: input.sellerNote,
            counterAmount: input.counterAmount,
          },
        });

        // If accepted: mark property sold and reject all other pending offers
        if (input.status === 'accepted') {
          await fastify.prisma.property.update({
            where: { id: offer.property.id },
            data: { status: 'sold' },
          });
          await fastify.prisma.propertyOffer.updateMany({
            where: {
              propertyId: offer.property.id,
              id: { not: id },
              status: 'pending',
            },
            data: { status: 'rejected', sellerNote: 'Another offer was accepted for this property' },
          });
        }

        // Notify buyer of the outcome
        const notifTitles: Record<string, string> = {
          accepted: '¡Tu oferta fue aceptada!',
          rejected: 'Tu oferta fue rechazada',
          countered: 'El vendedor hizo una contraoferta',
        };
        const notifMessages: Record<string, string> = {
          accepted: `Tu oferta para "${offer.property.title}" ha sido aceptada. El vendedor se pondrá en contacto contigo.`,
          rejected: `Tu oferta para "${offer.property.title}" fue rechazada.${input.sellerNote ? ' Nota: ' + input.sellerNote : ''}`,
          countered: `El vendedor de "${offer.property.title}" realizó una contraoferta de $${(input.counterAmount ?? 0).toLocaleString('es-MX')} MXN.`,
        };
        await createNotification(
          fastify.prisma,
          offer.buyerId,
          `offer_${input.status}` as any,
          notifTitles[input.status],
          notifMessages[input.status],
          'offer',
          id
        );

        // Send email notification
        const buyer = await fastify.prisma.user.findUnique({ where: { id: offer.buyerId }, select: { email: true, name: true } });
        if (buyer) {
          const emailOpts = { buyerEmail: buyer.email, buyerName: buyer.name, propertyTitle: offer.property.title, offeredAmount: Number(offer.offerAmount) };
          if (input.status === 'accepted') await sendOfferAcceptedEmail(emailOpts);
          else if (input.status === 'rejected') await sendOfferRejectedEmail(emailOpts);
          else if (input.status === 'countered') await sendOfferCounteredEmail({ buyerEmail: buyer.email, buyerName: buyer.name, propertyTitle: offer.property.title, counterAmount: Number(input.counterAmount), sellerNote: input.sellerNote });
        }

        return reply.send({ success: true, data: updated });
      } catch (error: any) {
        if (error.constructor?.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to update offer' });
      }
    }
  );
};

export default offersRoutes;
