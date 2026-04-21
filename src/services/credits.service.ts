import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

interface StripePaymentIntentLike {
  id: string;
  metadata?: Record<string, string>;
}

export class CreditsService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any;

  constructor(private prisma: PrismaClient, stripeSecretKey?: string) {
    this.stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
  }

  async getBalance(userId: string): Promise<number> {
    const balance = await this.prisma.creditBalance.findUnique({
      where: { userId },
    });
    return balance?.balance ?? 0;
  }

  async getTransactions(userId: string, limit = 20) {
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getPackages() {
    return this.prisma.creditPackage.findMany({
      where: { active: true },
      orderBy: { credits: 'asc' },
    });
  }

  async seedDefaultPackages() {
    const count = await this.prisma.creditPackage.count();
    if (count > 0) return;

    await this.prisma.creditPackage.createMany({
      data: [
        { name: 'Explorador', credits: 3,   priceMXN: 59  },
        { name: 'Básico',     credits: 10,  priceMXN: 149 },
        { name: 'Agente',     credits: 25,  priceMXN: 299 },
        { name: 'Pro',        credits: 60,  priceMXN: 599 },
        { name: 'Ilimitado',  credits: 120, priceMXN: 999 },
      ],
    });
  }

  /**
   * Deduct 1 credit to unlock a lead's contact info.
   * leadType: 'application' (RentalApplication) | 'request' (PropertyRequest for sale).
   * The caller must be the property's seller/landlord.
   * Idempotent: if the user already unlocked this lead, return immediately.
   */
  async spendCredit(
    userId: string,
    leadId: string,
    leadType: 'application' | 'request',
  ): Promise<{
    success: boolean;
    newBalance: number;
    alreadyUnlocked?: boolean;
    contact?: { fullName: string; email: string | null; phone: string | null };
  }> {
    // Idempotency check
    const existing = await this.prisma.creditTransaction.findFirst({
      where: { userId, referenceId: leadId, type: 'spend' },
    });

    const resolveContact = async () => {
      if (leadType === 'application') {
        const app = await this.prisma.rentalApplication.findUnique({
          where: { id: leadId },
          select: { fullName: true, email: true, phone: true },
        });
        return app ? { fullName: app.fullName, email: app.email ?? null, phone: app.phone ?? null } : null;
      } else {
        const req = await this.prisma.propertyRequest.findUnique({
          where: { id: leadId },
        });
        if (!req) return null;
        const buyer = await this.prisma.user.findUnique({
          where: { id: req.buyerId },
          select: { name: true, email: true, phone: true },
        });
        return buyer ? { fullName: buyer.name, email: buyer.email ?? null, phone: (buyer as any).phone ?? null } : null;
      }
    };

    if (existing) {
      const balance = await this.getBalance(userId);
      const contact = await resolveContact();
      return { success: true, newBalance: balance, alreadyUnlocked: true, contact: contact ?? undefined };
    }

    // Check balance
    const balanceRecord = await this.prisma.creditBalance.findUnique({ where: { userId } });
    if (!balanceRecord || balanceRecord.balance < 1) {
      return { success: false, newBalance: balanceRecord?.balance ?? 0 };
    }

    // Atomic deduct
    const [updated] = await this.prisma.$transaction([
      this.prisma.creditBalance.update({
        where: { userId },
        data: { balance: { decrement: 1 } },
      }),
      this.prisma.creditTransaction.create({
        data: {
          userId,
          type: 'spend',
          amount: -1,
          description: `Contacto de interesado desbloqueado (${leadType})`,
          referenceId: leadId,
        },
      }),
    ]);

    const contact = await resolveContact();
    return { success: true, newBalance: updated.balance, contact: contact ?? undefined };
  }

  /**
   * Create a Stripe PaymentIntent for purchasing a credit package.
   */
  async createPaymentIntent(userId: string, packageId: string): Promise<{ clientSecret: string; amount: number }> {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    const pkg = await this.prisma.creditPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.active) {
      throw new Error('Package not found');
    }

    const amountCentavos = Math.round(pkg.priceMXN * 100);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountCentavos,
      currency: 'mxn',
      metadata: { userId, packageId, credits: String(pkg.credits) },
    });

    return { clientSecret: paymentIntent.client_secret!, amount: amountCentavos };
  }

  /**
   * Fulfill a completed Stripe payment — add credits to user's balance.
   * Called from webhook (or manual confirmation in dev).
   */
  async fulfillPayment(stripePaymentIntentId: string, userId: string, packageId: string): Promise<number> {
    // Idempotency: skip if already processed
    const existing = await this.prisma.creditTransaction.findUnique({
      where: { stripePaymentIntentId },
    });
    if (existing) {
      return await this.getBalance(userId);
    }

    const pkg = await this.prisma.creditPackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new Error('Package not found');

    await this.prisma.$transaction([
      this.prisma.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: pkg.credits },
        update: { balance: { increment: pkg.credits } },
      }),
      this.prisma.creditTransaction.create({
        data: {
          userId,
          type: 'purchase',
          amount: pkg.credits,
          description: `Compra de paquete "${pkg.name}" (${pkg.credits} créditos)`,
          referenceId: packageId,
          stripePaymentIntentId,
        },
      }),
    ]);

    return await this.getBalance(userId);
  }

  /**
   * Handle raw Stripe webhook event.
   */
  async handleWebhook(rawBody: Buffer, signature: string, webhookSecret: string): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as StripePaymentIntentLike;
      const { userId, packageId } = pi.metadata ?? {};
      if (userId && packageId) {
        await this.fulfillPayment(pi.id, userId, packageId);
      }
    }
  }
}
