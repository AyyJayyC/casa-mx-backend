import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import { CreditsService } from '../services/credits.service.js';
import {
  SpendCreditSchema,
  CreatePaymentIntentSchema,
  FulfillPaymentSchema,
} from '../schemas/credits.js';
import { env } from '../config/env.js';
import { isZodError, createValidationErrorResponse, createServerErrorResponse } from '../utils/errorHandling.js';

const creditsRoutes: FastifyPluginAsync = async (fastify) => {
  const creditsService = new CreditsService(fastify.prisma, env.STRIPE_SECRET_KEY);

  // Seed default packages on startup (no-op if already seeded)
  await creditsService.seedDefaultPackages();

  // GET /credits/balance - Get current user's credit balance
  fastify.get('/credits/balance', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const balance = await creditsService.getBalance(request.user.id);
      return reply.send({ success: true, balance });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to fetch balance' });
    }
  });

  // GET /credits/transactions - Get user's transaction history
  fastify.get('/credits/transactions', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const transactions = await creditsService.getTransactions(request.user.id);
      return reply.send({ success: true, transactions });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to fetch transactions' });
    }
  });

  // GET /credits/packages - List available credit packages
  fastify.get('/credits/packages', async (_request, reply) => {
    try {
      const packages = await creditsService.getPackages();
      return reply.send({ success: true, packages });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to fetch packages' });
    }
  });

  // POST /credits/spend - Seller spends 1 credit to unlock a lead's contact info
  fastify.post('/credits/spend', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { leadId, leadType } = SpendCreditSchema.parse(request.body);
      const sellerId = request.user.id;

      // Verify the requester owns the property this lead belongs to
      let propertyOwnerId: string | null = null;
      if (leadType === 'application') {
        const app = await fastify.prisma.rentalApplication.findUnique({
          where: { id: leadId },
          include: { property: { select: { sellerId: true } } },
        });
        propertyOwnerId = (app as any)?.property?.sellerId ?? null;
      } else {
        const req = await fastify.prisma.propertyRequest.findUnique({
          where: { id: leadId },
          include: { property: { select: { sellerId: true } } },
        });
        propertyOwnerId = (req as any)?.property?.sellerId ?? null;
      }

      if (!propertyOwnerId) {
        return reply.code(404).send({ success: false, error: 'Lead not found' });
      }
      if (propertyOwnerId !== sellerId) {
        return reply.code(403).send({ success: false, error: 'No autorizado' });
      }

      const result = await creditsService.spendCredit(sellerId, leadId, leadType);

      if (!result.success) {
        return reply.code(402).send({
          success: false,
          error: 'Saldo insuficiente. Compra créditos para ver el contacto.',
          newBalance: result.newBalance,
        });
      }

      return reply.send({ success: true, ...result });
    } catch (error: any) {
      if (isZodError(error)) {
        return reply.code(400).send(createValidationErrorResponse(error));
      }
      fastify.log.error(error);
      return reply.code(500).send(createServerErrorResponse('Failed to spend credit'));
    }
  });

  // POST /credits/payment-intent - Create Stripe PaymentIntent
  fastify.post('/credits/payment-intent', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      if (!env.STRIPE_SECRET_KEY) {
        return reply.code(503).send({ success: false, error: 'Payments not configured' });
      }
      const { packageId } = CreatePaymentIntentSchema.parse(request.body);
      const result = await creditsService.createPaymentIntent(request.user.id, packageId);
      return reply.send({ success: true, ...result });
    } catch (error: any) {
      if (error.constructor?.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: error.message ?? 'Failed to create payment intent' });
    }
  });

  // POST /credits/fulfill - Manually confirm payment (dev/testing only)
  fastify.post('/credits/fulfill', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      if (env.NODE_ENV === 'production') {
        return reply.code(404).send({ success: false, error: 'Not found' });
      }
      const { stripePaymentIntentId, packageId } = FulfillPaymentSchema.parse(request.body);
      const newBalance = await creditsService.fulfillPayment(stripePaymentIntentId, request.user.id, packageId);
      return reply.send({ success: true, newBalance });
    } catch (error: any) {
      if (error.constructor?.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: error.message ?? 'Failed to fulfill payment' });
    }
  });

  // POST /credits/admin/sync-packages - Force upsert all default packages (admin only)
  fastify.post('/credits/admin/sync-packages', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      if (!(request.user as any).roles?.includes('admin')) {
        return reply.code(403).send({ success: false, error: 'Forbidden' });
      }
      const packages = [
        { name: 'Explorador', credits: 3,   priceMXN: 59  },
        { name: 'Básico',     credits: 10,  priceMXN: 149 },
        { name: 'Agente',     credits: 25,  priceMXN: 299 },
        { name: 'Pro',        credits: 60,  priceMXN: 599 },
        { name: 'Ilimitado',  credits: 120, priceMXN: 999 },
      ];
      // Deactivate all existing, then upsert by name
      await fastify.prisma.creditPackage.updateMany({ where: {}, data: { active: false } });
      for (const pkg of packages) {
        const existing = await fastify.prisma.creditPackage.findFirst({ where: { name: pkg.name } });
        if (existing) {
          await fastify.prisma.creditPackage.update({
            where: { id: existing.id },
            data: { credits: pkg.credits, priceMXN: pkg.priceMXN, active: true },
          });
        } else {
          await fastify.prisma.creditPackage.create({ data: { ...pkg } });
        }
      }
      return reply.send({ success: true, message: 'Packages synced' });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  // POST /credits/webhook - Stripe webhook (raw body required)
  fastify.post(
    '/credits/webhook',
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      try {
        if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
          return reply.code(503).send({ error: 'Webhook not configured' });
        }
        const signature = request.headers['stripe-signature'] as string;
        if (!signature) {
          return reply.code(400).send({ error: 'Missing stripe-signature header' });
        }
        const rawBody = (request as any).rawBody as Buffer;
        await creditsService.handleWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
        return reply.send({ received: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({ error: error.message });
      }
    }
  );
};

export default creditsRoutes;
