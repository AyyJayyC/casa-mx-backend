import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import { z } from 'zod';
import {
  generateRentalContract,
  generateSaleContract,
  generatePromesaContract,
} from '../services/contract.service.js';

const contractsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /contracts/rental/:applicationId
   * Returns a PDF rental contract. Accessible by landlord (property owner) or the applicant.
   */
  fastify.get('/contracts/rental/:applicationId', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { applicationId } = z.object({ applicationId: z.string().uuid() }).parse(request.params);
      const userId = request.user.id;

      const application = await fastify.prisma.rentalApplication.findUnique({
        where: { id: applicationId },
        include: { property: { select: { sellerId: true } } },
      });

      if (!application) {
        return reply.code(404).send({ success: false, error: 'Application not found' });
      }

      // Only landlord or the applicant can access
      if (application.applicantId !== userId && application.property.sellerId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const pdfBuffer = await generateRentalContract(fastify.prisma, applicationId);

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="contrato-arrendamiento-${applicationId.substring(0, 8)}.pdf"`)
        .send(pdfBuffer);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to generate contract' });
    }
  });

  /**
   * GET /contracts/sale/:offerId
   * Returns a PDF sale contract (or promesa if financing = paymentPlan).
   * Accessible by seller or the buyer.
   */
  fastify.get('/contracts/sale/:offerId', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { offerId } = z.object({ offerId: z.string().uuid() }).parse(request.params);
      const userId = request.user.id;

      const offer = await fastify.prisma.propertyOffer.findUnique({
        where: { id: offerId },
        include: { property: { select: { sellerId: true } } },
      });

      if (!offer) {
        return reply.code(404).send({ success: false, error: 'Offer not found' });
      }

      // Only seller or buyer can access
      if (offer.buyerId !== userId && offer.property.sellerId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const isPaymentPlan = offer.financing === 'paymentPlan';
      const pdfBuffer = isPaymentPlan
        ? await generatePromesaContract(fastify.prisma, offerId)
        : await generateSaleContract(fastify.prisma, offerId);

      const filename = isPaymentPlan
        ? `promesa-compraventa-${offerId.substring(0, 8)}.pdf`
        : `contrato-compraventa-${offerId.substring(0, 8)}.pdf`;

      reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to generate contract' });
    }
  });
};

export default contractsRoutes;
