import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { sendPaymentConfirmationEmail } from "./email.service.js";

interface StripePaymentIntentLike {
  id: string;
  metadata?: Record<string, string>;
}

export class CreditsService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stripe: any;

  constructor(
    private prisma: PrismaClient,
    stripeSecretKey?: string,
  ) {
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
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async getPackages() {
    return this.prisma.creditPackage.findMany({
      where: { active: true },
      orderBy: { credits: "asc" },
    });
  }

  async seedDefaultPackages() {
    const count = await this.prisma.creditPackage.count();
    if (count > 0) return;

    await this.prisma.creditPackage.createMany({
      data: [
        { name: "Explorador", credits: 30, priceMXN: 59 },
        { name: "Básico", credits: 100, priceMXN: 149 },
        { name: "Agente", credits: 250, priceMXN: 299 },
        { name: "Pro", credits: 600, priceMXN: 599 },
        { name: "Ilimitado", credits: 1200, priceMXN: 999 },
      ],
    });
  }

  /**
   * Deduct 1 credit to unlock a lead's contact info.
   * leadType: 'application' (RentalApplication) | 'request' (PropertyRequest) | 'offer' (PropertyOffer).
   * The caller must be the property's seller/landlord.
   * Idempotent: if the user already unlocked this lead, return immediately.
   */
  async spendCredit(
    userId: string,
    leadId: string,
    leadType: "application" | "request" | "offer",
  ): Promise<{
    success: boolean;
    newBalance: number;
    alreadyUnlocked?: boolean;
    contact?: { fullName: string; email: string | null; phone: string | null };
  }> {
    // Idempotency check
    const existing = await this.prisma.creditTransaction.findFirst({
      where: { userId, referenceId: leadId, type: "spend" },
    });

    const resolveContact = async () => {
      if (leadType === "application") {
        const app = await this.prisma.rentalApplication.findUnique({
          where: { id: leadId },
          select: { fullName: true, email: true, phone: true },
        });
        return app
          ? {
              fullName: app.fullName,
              email: app.email ?? null,
              phone: app.phone ?? null,
            }
          : null;
      } else if (leadType === "offer") {
        const offer = await this.prisma.propertyOffer.findUnique({
          where: { id: leadId },
          select: { buyerName: true, buyerEmail: true, buyerPhone: true },
        });
        return offer
          ? {
              fullName: offer.buyerName,
              email: offer.buyerEmail ?? null,
              phone: offer.buyerPhone ?? null,
            }
          : null;
      } else {
        const req = await this.prisma.propertyRequest.findUnique({
          where: { id: leadId },
          select: { name: true, phone: true, buyerId: true },
        });
        if (!req) return null;
        const buyer = await this.prisma.user.findUnique({
          where: { id: req.buyerId },
          select: { email: true },
        });
        return {
          fullName: req.name ?? buyer?.email ?? "",
          email: buyer?.email ?? null,
          phone: req.phone ?? null,
        };
      }
    };

    if (existing) {
      const balance = await this.getBalance(userId);
      const contact = await resolveContact();
      return {
        success: true,
        newBalance: balance,
        alreadyUnlocked: true,
        contact: contact ?? undefined,
      };
    }

    // Atomic check + deduct using interactive transaction to prevent race conditions
    const SPEND_AMOUNT = 10;
    const spendResult = await this.prisma.$transaction(async (tx) => {
      const balance = await tx.creditBalance.findUnique({ where: { userId } });
      if (!balance || balance.balance < SPEND_AMOUNT) {
        return { success: false as const, newBalance: balance?.balance ?? 0 };
      }
      const updated = await tx.creditBalance.update({
        where: { userId },
        data: { balance: { decrement: SPEND_AMOUNT } },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          type: "spend",
          amount: -SPEND_AMOUNT,
          description: `Contacto de interesado desbloqueado (${leadType})`,
          referenceId: leadId,
        },
      });
      return { success: true as const, newBalance: updated.balance };
    });

    if (!spendResult.success) {
      return spendResult;
    }

    const contact = await resolveContact();
    return {
      success: true,
      newBalance: spendResult.newBalance,
      contact: contact ?? undefined,
    };
  }

  /**
   * Create a Stripe PaymentIntent for purchasing a credit package.
   */
  async createPaymentIntent(
    userId: string,
    packageId: string,
  ): Promise<{ clientSecret: string; amount: number }> {
    if (!this.stripe) {
      throw new Error("Stripe not configured");
    }

    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg || !pkg.active) {
      throw new Error("Package not found");
    }

    const amountCentavos = Math.round(pkg.priceMXN * 100);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountCentavos,
      currency: "mxn",
      metadata: { userId, packageId, credits: String(pkg.credits) },
    });

    return {
      clientSecret: paymentIntent.client_secret!,
      amount: amountCentavos,
    };
  }

  /**
   * Fulfill a completed Stripe payment — add credits to user's balance.
   * Called from webhook (or manual confirmation in dev).
   */
  async fulfillPayment(
    stripePaymentIntentId: string,
    userId: string,
    packageId: string,
  ): Promise<number> {
    // Idempotency: skip if already processed
    const existing = await this.prisma.creditTransaction.findUnique({
      where: { stripePaymentIntentId },
    });
    if (existing) {
      return await this.getBalance(userId);
    }

    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new Error("Package not found");

    await this.prisma.$transaction([
      this.prisma.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: pkg.credits },
        update: { balance: { increment: pkg.credits } },
      }),
      this.prisma.creditTransaction.create({
        data: {
          userId,
          type: "purchase",
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
  async handleWebhook(
    rawBody: Buffer,
    signature: string,
    webhookSecret: string,
  ): Promise<void> {
    if (!this.stripe) throw new Error("Stripe not configured");

    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as StripePaymentIntentLike;
      const { userId, packageId } = pi.metadata ?? {};
      if (userId && packageId) {
        await this.fulfillPayment(pi.id, userId, packageId);
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, name: true },
          });
          const pkg = await this.prisma.creditPackage.findUnique({
            where: { id: packageId },
          });
          if (user && pkg) {
            await sendPaymentConfirmationEmail({
              userEmail: user.email,
              userName: user.name,
              packageName: pkg.name,
              credits: pkg.credits,
              amount: ((pi as any).amount ?? 0) / 100,
              transactionDate: new Date().toISOString(),
            });
          }
        } catch {}
      }
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as {
        id: string;
        payment_intent: string | null;
      };
      if (charge.payment_intent) {
        await this.processRefund(charge.payment_intent as string);
      }
    }

    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object as {
        id: string;
        charge: string;
        amount: number;
        reason: string;
        status: string;
      };
      console.error(
        "[DISPUTE ALERT]",
        JSON.stringify({
          disputeId: dispute.id,
          chargeId: dispute.charge,
          amount: dispute.amount,
          reason: dispute.reason,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as StripePaymentIntentLike & {
        last_payment_error?: { message: string; code: string };
      };
      const { userId } = pi.metadata ?? {};
      console.warn(
        "[PAYMENT FAILED]",
        JSON.stringify({
          paymentIntentId: pi.id,
          userId,
          error: pi.last_payment_error,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  async processRefund(paymentIntentId: string): Promise<void> {
    const transaction = await this.prisma.creditTransaction.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (!transaction) return;

    const existingRefund = await this.prisma.creditTransaction.findFirst({
      where: {
        userId: transaction.userId,
        type: "refund",
        referenceId: paymentIntentId,
      },
    });
    if (existingRefund) return;

    const currentBalance = await this.prisma.creditBalance.findUnique({
      where: { userId: transaction.userId },
    });
    const deductAmount = Math.min(
      Math.abs(transaction.amount),
      currentBalance?.balance ?? 0,
    );
    if (deductAmount <= 0) return;

    await this.prisma.$transaction([
      this.prisma.creditBalance.update({
        where: { userId: transaction.userId },
        data: { balance: { decrement: deductAmount } },
      }),
      this.prisma.creditTransaction.create({
        data: {
          userId: transaction.userId,
          type: "refund",
          amount: -deductAmount,
          description: `Reembolso — payment intent ${paymentIntentId}`,
          referenceId: paymentIntentId,
        },
      }),
    ]);
  }
}
