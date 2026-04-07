import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireAdmin } from '../utils/guards.js';
import { CreditsService } from '../services/credits.service.js';
import { env } from '../config/env.js';

const purchaseSessionSchema = z.object({
  packageId: z.string().uuid('Invalid package ID'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const addCreditsSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  description: z.string().min(1),
});

const historyQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).optional(),
  offset: z.string().transform(Number).pipe(z.number().int().nonnegative()).optional(),
});

const creditsRoutes: FastifyPluginAsync = async (fastify) => {
  const creditsService = new CreditsService(fastify.prisma);

  // GET /credits/balance - Get current user's credit balance
  fastify.get('/credits/balance', { onRequest: [verifyJWT] }, async (request, reply) => {
    const balance = await creditsService.getBalance(request.user.id);
    return reply.send({ success: true, data: { balance } });
  });

  // GET /credits/packages - List available credit packages
  fastify.get('/credits/packages', async (_request, reply) => {
    const packages = await creditsService.getPackages();
    return reply.send({ success: true, data: packages });
  });

  // GET /credits/history - Get transaction history for current user
  fastify.get('/credits/history', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const query = historyQuerySchema.parse(request.query);
      const transactions = await creditsService.getTransactionHistory(
        request.user.id,
        query.limit ?? 20,
        query.offset ?? 0,
      );
      return reply.send({ success: true, data: transactions });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to fetch transaction history' });
    }
  });

  // POST /credits/checkout - Create Stripe checkout session
  fastify.post('/credits/checkout', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      if (!env.STRIPE_SECRET_KEY) {
        return reply.code(503).send({
          success: false,
          error: 'Payment system is not configured yet',
        });
      }

      const input = purchaseSessionSchema.parse(request.body);
      const session = await creditsService.createCheckoutSession(
        request.user.id,
        input.packageId,
        input.successUrl ?? `${env.FRONTEND_URL}/credits/success`,
        input.cancelUrl ?? `${env.FRONTEND_URL}/credits`,
      );

      if (!session) {
        return reply.code(404).send({ success: false, error: 'Credit package not found' });
      }

      return reply.send({ success: true, data: session });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to create checkout session' });
    }
  });

  // POST /credits/webhook - Stripe webhook handler
  fastify.post(
    '/credits/webhook',
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      try {
        if (!env.STRIPE_SECRET_KEY) {
          return reply.code(503).send({ success: false, error: 'Stripe not configured' });
        }

        const signature = request.headers['stripe-signature'];
        if (!signature || typeof signature !== 'string') {
          return reply.code(400).send({ success: false, error: 'Missing Stripe signature' });
        }

        const rawBody = (request as any).rawBody;
        if (!rawBody) {
          return reply.code(400).send({ success: false, error: 'Missing raw body' });
        }

        await creditsService.handleStripeWebhook(rawBody, signature);
        return reply.send({ received: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ success: false, error: error.message });
      }
    },
  );

  // POST /credits/add - Admin: manually add credits to a user
  fastify.post('/credits/add', { onRequest: [requireAdmin] }, async (request, reply) => {
    try {
      const input = addCreditsSchema.parse(request.body);
      const result = await creditsService.addCredits(
        input.userId,
        input.amount,
        input.description,
        undefined,
        'admin_grant',
      );
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to add credits' });
    }
  });
};

export default creditsRoutes;
