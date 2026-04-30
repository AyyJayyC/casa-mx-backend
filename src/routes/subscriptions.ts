import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { env } from '../config/env.js';
import { verifyJWT } from '../utils/guards.js';

const createCheckoutSchema = z.object({
  priceId: z.string().optional(),
});

function requireStripe() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured');
  }
  return new Stripe(env.STRIPE_SECRET_KEY);
}

function toDateOrNull(unixSeconds?: number | null) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}

const subscriptionsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/subscriptions/status', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const subscription = await fastify.prisma.userSubscription.findUnique({
        where: { userId: request.user.id },
      });

      return reply.send({
        success: true,
        data: {
          isActive: Boolean(subscription && ['active', 'trialing'].includes(subscription.status)),
          status: subscription?.status ?? 'inactive',
          currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to get subscription status' });
    }
  });

  fastify.post('/subscriptions/checkout-session', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const stripe = requireStripe();
      const input = createCheckoutSchema.parse(request.body ?? {});
      const priceId = input.priceId || env.STRIPE_SUBSCRIPTION_PRICE_ID;

      if (!priceId) {
        return reply.code(400).send({ success: false, error: 'Missing subscription price id' });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { id: true, email: true, name: true, stripeCustomerId: true },
      });

      if (!user) {
        return reply.code(404).send({ success: false, error: 'User not found' });
      }

      let customerId = user.stripeCustomerId || null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await fastify.prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: customerId },
        });
      }

      const successUrl = env.STRIPE_SUBSCRIPTION_SUCCESS_URL || `${env.FRONTEND_URL}/dashboard/account?subscription=success`;
      const cancelUrl = env.STRIPE_SUBSCRIPTION_CANCEL_URL || `${env.FRONTEND_URL}/dashboard/account?subscription=cancel`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: user.id },
      });

      return reply.send({ success: true, data: { url: session.url } });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: error?.message || 'Failed to create subscription checkout session' });
    }
  });

  fastify.post('/subscriptions/billing-portal', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const stripe = requireStripe();
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { stripeCustomerId: true },
      });

      if (!user?.stripeCustomerId) {
        return reply.code(400).send({ success: false, error: 'No Stripe customer linked to this account' });
      }

      const returnUrl = env.STRIPE_BILLING_PORTAL_RETURN_URL || `${env.FRONTEND_URL}/dashboard/account`;
      const portal = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: returnUrl,
      });

      return reply.send({ success: true, data: { url: portal.url } });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: error?.message || 'Failed to create billing portal session' });
    }
  });

  fastify.post('/subscriptions/webhook', { config: { rawBody: true } }, async (request, reply) => {
    try {
      if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
        return reply.code(503).send({ error: 'Webhook not configured' });
      }

      const signature = request.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        return reply.code(400).send({ error: 'Missing stripe-signature header' });
      }

      const stripe = requireStripe();
      const rawBody = (request as any).rawBody as Buffer;
      const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

      const upsertFromSubscription = async (subscription: any) => {
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
        const user = await fastify.prisma.user.findFirst({
          where: { stripeCustomerId: customerId },
          select: { id: true },
        });

        if (!user) {
          return;
        }

        const firstItem = subscription.items.data[0];
        const priceId = firstItem?.price?.id || null;

        await fastify.prisma.userSubscription.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            status: subscription.status,
            currentPeriodStart: toDateOrNull((subscription as any).current_period_start),
            currentPeriodEnd: toDateOrNull((subscription as any).current_period_end),
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            canceledAt: toDateOrNull(subscription.canceled_at),
          },
          update: {
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            status: subscription.status,
            currentPeriodStart: toDateOrNull((subscription as any).current_period_start),
            currentPeriodEnd: toDateOrNull((subscription as any).current_period_end),
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            canceledAt: toDateOrNull(subscription.canceled_at),
          },
        });
      };

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          if (session.mode === 'subscription' && session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
            await upsertFromSubscription(subscription);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await upsertFromSubscription(subscription);
          break;
        }
        default:
          break;
      }

      return reply.send({ received: true });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(400).send({ error: error?.message || 'Webhook processing failed' });
    }
  });
};

export default subscriptionsRoutes;
