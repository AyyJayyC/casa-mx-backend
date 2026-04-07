import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireRole } from '../utils/guards.js';
import { CreditsService } from '../services/credits.service.js';

const applicationIdParamSchema = z.object({
  applicationId: z.string().uuid('Invalid application ID'),
});

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  const creditsService = new CreditsService(fastify.prisma);

  /**
   * POST /whatsapp/unlock/:applicationId
   * Landlord spends credits to unlock the applicant's WhatsApp contact.
   * Returns the WhatsApp link if successful.
   */
  fastify.post(
    '/whatsapp/unlock/:applicationId',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const { applicationId } = applicationIdParamSchema.parse(request.params);
        const landlordId = request.user.id;

        // Verify the application belongs to a property owned by this landlord
        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: applicationId },
          include: {
            property: { select: { sellerId: true } },
          },
        });

        if (!application) {
          return reply.code(404).send({ success: false, error: 'Application not found' });
        }

        if (application.property.sellerId !== landlordId) {
          return reply.code(403).send({
            success: false,
            error: 'You can only unlock contacts for your own properties',
          });
        }

        if (application.status !== 'approved') {
          return reply.code(400).send({
            success: false,
            error: 'WhatsApp contact can only be unlocked after the application is approved',
          });
        }

        // Already unlocked – return link without charging credits again
        if (application.whatsappUnlocked) {
          const link = buildWhatsAppLink(application.phone);
          return reply.send({
            success: true,
            data: { whatsappLink: link, phone: application.phone },
            message: 'Contact already unlocked',
          });
        }

        // Spend credits
        const spend = await creditsService.spendCredits(
          landlordId,
          'WHATSAPP_UNLOCK',
          applicationId,
          'rental_application',
        );

        if (!spend.success) {
          return reply.code(402).send({
            success: false,
            error: spend.error ?? 'Insufficient credits to unlock WhatsApp contact',
          });
        }

        // Mark application as unlocked
        await fastify.prisma.rentalApplication.update({
          where: { id: applicationId },
          data: { whatsappUnlocked: true },
        });

        const link = buildWhatsAppLink(application.phone);
        return reply.send({
          success: true,
          data: {
            whatsappLink: link,
            phone: application.phone,
            creditsRemaining: spend.balanceAfter,
          },
          message: 'WhatsApp contact unlocked successfully',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Invalid application ID' });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to unlock WhatsApp contact' });
      }
    },
  );

  /**
   * GET /whatsapp/contact/:applicationId
   * Landlord retrieves an already-unlocked WhatsApp link (no credit charge).
   */
  fastify.get(
    '/whatsapp/contact/:applicationId',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const { applicationId } = applicationIdParamSchema.parse(request.params);
        const landlordId = request.user.id;

        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: applicationId },
          include: { property: { select: { sellerId: true } } },
        });

        if (!application) {
          return reply.code(404).send({ success: false, error: 'Application not found' });
        }

        if (application.property.sellerId !== landlordId) {
          return reply.code(403).send({ success: false, error: 'Access denied' });
        }

        if (!application.whatsappUnlocked) {
          return reply.code(402).send({
            success: false,
            error: 'WhatsApp contact has not been unlocked yet. Use POST /whatsapp/unlock/:applicationId.',
          });
        }

        const link = buildWhatsAppLink(application.phone);
        return reply.send({
          success: true,
          data: { whatsappLink: link, phone: application.phone },
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({ success: false, error: 'Invalid application ID' });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to retrieve WhatsApp contact' });
      }
    },
  );
};

/**
 * Build a WhatsApp click-to-chat link.
 * Normalises Mexican phone numbers to international format (+52).
 */
function buildWhatsAppLink(phone: string): string {
  // Strip non-digit characters
  let digits = phone.replace(/\D/g, '');

  // If it starts with 52 and is 12 digits, it's already international
  if (digits.startsWith('52') && digits.length === 12) {
    return `https://wa.me/${digits}`;
  }

  // If it's a 10-digit Mexican number, prepend country code
  if (digits.length === 10) {
    return `https://wa.me/52${digits}`;
  }

  // Fallback: use as-is
  return `https://wa.me/${digits}`;
}

export default whatsappRoutes;
