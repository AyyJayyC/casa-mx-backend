import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireRole } from '../utils/guards.js';
import { CreditsService } from '../services/credits.service.js';

const applicationIdParamSchema = z.object({
  id: z.string().uuid('Invalid application ID'),
});

const whatsAppRoutes: FastifyPluginAsync = async (fastify) => {
  const creditsService = new CreditsService(fastify.prisma);

  /**
   * POST /applications/:id/whatsapp
   *
   * Spend 1 WhatsApp credit to unlock the applicant's phone number and get a
   * WhatsApp contact link for the specified rental application.
   *
   * - If already unlocked for this landlord+application pair, returns the link
   *   without charging credits again.
   * - If not yet unlocked and landlord has credits, deducts 1 credit, records
   *   the unlock, and returns the WhatsApp link.
   * - If not yet unlocked and landlord has no credits, returns 402 Payment Required.
   */
  fastify.post(
    '/applications/:id/whatsapp',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const params = applicationIdParamSchema.parse(request.params);
        const landlordId = request.user.id;

        // Fetch application and verify landlord owns the property
        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: params.id },
          include: {
            property: {
              select: { sellerId: true },
            },
          },
        });

        if (!application) {
          return reply.code(404).send({
            success: false,
            error: 'Application not found',
          });
        }

        if (application.property.sellerId !== landlordId) {
          return reply.code(403).send({
            success: false,
            error: 'You can only access WhatsApp for applications on your own properties',
          });
        }

        // Check if already unlocked for this landlord+application
        const alreadyUnlocked = await creditsService.isWhatsAppUnlocked(landlordId, params.id);

        if (!alreadyUnlocked) {
          // Attempt to spend 1 credit
          const success = await creditsService.spendWhatsAppCredit(landlordId, params.id);

          if (!success) {
            return reply.code(402).send({
              success: false,
              error: 'Insufficient WhatsApp credits. Please purchase credits to contact applicants via WhatsApp.',
              data: {
                currentBalance: 0,
                requiredCredits: 1,
              },
            });
          }
        }

        // Build WhatsApp link
        const rawPhone = application.phone.replace(/\D/g, '');
        const whatsAppUrl = `https://wa.me/${rawPhone}`;

        const newBalance = await creditsService.getBalance(landlordId);

        return reply.send({
          success: true,
          data: {
            phone: application.phone,
            whatsAppUrl,
            applicantName: application.fullName,
            creditsUsed: alreadyUnlocked ? 0 : 1,
            remainingBalance: newBalance,
          },
          message: alreadyUnlocked
            ? 'WhatsApp link retrieved (previously unlocked)'
            : 'WhatsApp link unlocked successfully',
        });
      } catch (error: any) {
        if (error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to process WhatsApp unlock',
        });
      }
    }
  );
};

export default whatsAppRoutes;
