import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireRole } from '../utils/guards.js';
import { CreditsService } from '../services/credits.service.js';

// Credit packages available for purchase
const CREDIT_PACKAGES = {
  basic: { credits: 5, price: 99, currency: 'MXN', label: 'Básico - 5 contactos WhatsApp' },
  standard: { credits: 15, price: 249, currency: 'MXN', label: 'Estándar - 15 contactos WhatsApp' },
  premium: { credits: 40, price: 599, currency: 'MXN', label: 'Premium - 40 contactos WhatsApp' },
} as const;

type PackageType = keyof typeof CREDIT_PACKAGES;

const purchaseSchema = z.object({
  packageType: z.enum(['basic', 'standard', 'premium']),
});

const transactionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const creditsRoutes: FastifyPluginAsync = async (fastify) => {
  const creditsService = new CreditsService(fastify.prisma);

  // GET /credits/balance - Get landlord's current credit balance
  fastify.get(
    '/credits/balance',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const userId = request.user.id;
        const balance = await creditsService.getBalance(userId);

        return reply.send({
          success: true,
          data: {
            balance,
            packages: CREDIT_PACKAGES,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch credit balance',
        });
      }
    }
  );

  // GET /credits/packages - List available credit packages
  fastify.get(
    '/credits/packages',
    { onRequest: [verifyJWT] },
    async (_request, reply) => {
      return reply.send({
        success: true,
        data: CREDIT_PACKAGES,
      });
    }
  );

  // POST /credits/purchase - Initiate a credit purchase via Stripe
  fastify.post(
    '/credits/purchase',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const input = purchaseSchema.parse(request.body);
        const pkg = CREDIT_PACKAGES[input.packageType as PackageType];

        // TODO: Integrate with Stripe to create a checkout session.
        // The Stripe checkout session should call back to POST /credits/purchase/confirm
        // with the Stripe payment intent ID once payment completes.
        //
        // Example Stripe integration (requires STRIPE_SECRET_KEY env var):
        // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
        // const session = await stripe.checkout.sessions.create({
        //   payment_method_types: ['card'],
        //   line_items: [{
        //     price_data: {
        //       currency: 'mxn',
        //       product_data: { name: pkg.label },
        //       unit_amount: pkg.price * 100,
        //     },
        //     quantity: 1,
        //   }],
        //   mode: 'payment',
        //   success_url: `${process.env.FRONTEND_URL}/credits/success?session_id={CHECKOUT_SESSION_ID}`,
        //   cancel_url: `${process.env.FRONTEND_URL}/credits/cancel`,
        //   metadata: { userId: request.user.id, packageType: input.packageType, credits: pkg.credits },
        // });
        // return reply.send({ success: true, data: { checkoutUrl: session.url } });

        return reply.send({
          success: true,
          data: {
            message: 'Stripe integration pending. Use /credits/purchase/confirm to add credits manually for testing.',
            package: pkg,
            packageType: input.packageType,
          },
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
          error: 'Failed to initiate credit purchase',
        });
      }
    }
  );

  // POST /credits/purchase/confirm - Confirm credit purchase (called after Stripe payment)
  // In production this will be triggered by a Stripe webhook or redirect callback.
  fastify.post(
    '/credits/purchase/confirm',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const input = purchaseSchema.parse(request.body);
        const pkg = CREDIT_PACKAGES[input.packageType as PackageType];
        const userId = request.user.id;

        // TODO: In production, verify the Stripe payment intent/session before granting credits.
        // Only add credits once the payment is confirmed as succeeded.

        const newBalance = await creditsService.addCredits(
          userId,
          pkg.credits,
          `Purchased ${input.packageType} package: ${pkg.label}`,
        );

        return reply.code(201).send({
          success: true,
          data: {
            creditsAdded: pkg.credits,
            newBalance,
            package: pkg,
          },
          message: `${pkg.credits} WhatsApp credits added to your account`,
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
          error: 'Failed to confirm credit purchase',
        });
      }
    }
  );

  // GET /credits/transactions - Get credit transaction history
  fastify.get(
    '/credits/transactions',
    { onRequest: [verifyJWT, requireRole('landlord')] },
    async (request, reply) => {
      try {
        const query = transactionQuerySchema.parse(request.query);
        const userId = request.user.id;

        const transactions = await creditsService.getTransactions(
          userId,
          query.limit ?? 20,
          query.offset ?? 0,
        );

        return reply.send({
          success: true,
          data: transactions,
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
          error: 'Failed to fetch transaction history',
        });
      }
    }
  );
};

export default creditsRoutes;
