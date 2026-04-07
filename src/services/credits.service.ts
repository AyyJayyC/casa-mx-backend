import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe') as any;

// Credit costs for various actions
export const CREDIT_COSTS = {
  PROPERTY_LISTING: 5,        // Credits to upload/list a property
  PROPERTY_BLAST: 10,         // Credits to blast property to interested parties
  PROPERTY_PROMOTE: 8,        // Credits to promote a listing
  WHATSAPP_UNLOCK: 3,         // Credits to unlock a buyer's WhatsApp number
  WHATSAPP_MESSAGE: 1,        // Credits per WhatsApp message initiation
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export class CreditsService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any = null;

  constructor(private prisma: PrismaClient) {
    if (env.STRIPE_SECRET_KEY) {
      this.stripe = new StripeLib(env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
    }
  }

  async getBalance(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });
    return user?.creditBalance ?? 0;
  }

  async getPackages() {
    return this.prisma.creditPackage.findMany({
      where: { active: true },
      orderBy: { priceUsd: 'asc' },
    });
  }

  async getTransactionHistory(userId: string, limit = 20, offset = 0) {
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Deduct credits for an action. Returns false if insufficient balance.
   */
  async spendCredits(
    userId: string,
    action: CreditAction,
    referenceId?: string,
    referenceType?: string,
  ): Promise<{ success: boolean; balanceAfter: number; error?: string }> {
    const cost = CREDIT_COSTS[action];

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { creditBalance: true },
      });

      if (!user) {
        return { success: false, balanceAfter: 0, error: 'User not found' };
      }

      if (user.creditBalance < cost) {
        return {
          success: false,
          balanceAfter: user.creditBalance,
          error: `Insufficient credits. Required: ${cost}, Available: ${user.creditBalance}`,
        };
      }

      const balanceAfter = user.creditBalance - cost;

      await tx.user.update({
        where: { id: userId },
        data: { creditBalance: balanceAfter },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'debit',
          amount: -cost,
          balanceAfter,
          description: this.getActionDescription(action),
          referenceId,
          referenceType,
        },
      });

      return { success: true, balanceAfter };
    });
  }

  /**
   * Add credits to a user's balance (manual grant / admin bonus).
   */
  async addCredits(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    referenceType?: string,
  ): Promise<{ balanceAfter: number }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { creditBalance: { increment: amount } },
        select: { creditBalance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'purchase',
          amount,
          balanceAfter: user.creditBalance,
          description,
          referenceId,
          referenceType,
        },
      });

      return { balanceAfter: user.creditBalance };
    });
  }

  /**
   * Create a Stripe Checkout Session for credit purchase.
   */
  async createCheckoutSession(
    userId: string,
    packageId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ sessionId: string; url: string } | null> {
    if (!this.stripe) {
      return null;
    }

    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: packageId, active: true },
    });

    if (!pkg) return null;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: pkg.stripePriceId
        ? [{ price: pkg.stripePriceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `Casa MX Credits - ${pkg.name}`,
                  description: pkg.description ?? `${pkg.credits} Casa MX Credits`,
                },
                unit_amount: Math.round(pkg.priceUsd * 100),
              },
              quantity: 1,
            },
          ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        packageId,
        credits: pkg.credits.toString(),
      },
    });

    return { sessionId: session.id, url: session.url! };
  }

  /**
   * Handle a completed Stripe webhook event to credit the user.
   */
  async handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!this.stripe || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Stripe is not configured');
    }

    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const { userId, packageId, credits } = session.metadata ?? {};

      if (userId && credits) {
        const creditsAmount = parseInt(credits, 10);
        await this.addCredits(
          userId,
          creditsAmount,
          `Credit purchase: ${session.metadata?.packageId ?? packageId}`,
          session.id,
          'stripe_payment',
        );
      }
    }
  }

  private getActionDescription(action: CreditAction): string {
    const descriptions: Record<CreditAction, string> = {
      PROPERTY_LISTING: 'Property listing upload',
      PROPERTY_BLAST: 'Property blast to interested parties',
      PROPERTY_PROMOTE: 'Property promotion',
      WHATSAPP_UNLOCK: 'WhatsApp contact unlock',
      WHATSAPP_MESSAGE: 'WhatsApp message initiation',
    };
    return descriptions[action];
  }
}
