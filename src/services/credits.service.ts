import { PrismaClient } from '@prisma/client';

export const WHATSAPP_CREDIT_COST = 1;

export class CreditsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get or create a credit balance record for a user.
   */
  async getBalance(userId: string): Promise<number> {
    const record = await this.prisma.creditBalance.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return record?.balance ?? 0;
  }

  /**
   * Check whether a landlord has enough WhatsApp credits (at least 1).
   */
  async hasWhatsAppCredits(userId: string): Promise<boolean> {
    const balance = await this.getBalance(userId);
    return balance >= WHATSAPP_CREDIT_COST;
  }

  /**
   * Add credits to a user's balance and record the transaction.
   * Returns the new balance.
   */
  async addCredits(
    userId: string,
    credits: number,
    description: string,
    referenceId?: string,
  ): Promise<number> {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditBalance.upsert({
        where: { userId },
        update: { balance: { increment: credits } },
        create: { userId, balance: credits },
        select: { balance: true },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'purchase',
          credits,
          description,
          referenceId: referenceId ?? null,
        },
      });

      return updated.balance;
    });

    return result;
  }

  /**
   * Spend credits for a WhatsApp unlock.
   * Returns true if successful, false if insufficient credits.
   */
  async spendWhatsAppCredit(
    userId: string,
    applicationId: string,
  ): Promise<boolean> {
    const balance = await this.getBalance(userId);
    if (balance < WHATSAPP_CREDIT_COST) {
      return false;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.creditBalance.update({
        where: { userId },
        data: { balance: { decrement: WHATSAPP_CREDIT_COST } },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          type: 'whatsapp_unlock',
          credits: -WHATSAPP_CREDIT_COST,
          description: `WhatsApp unlock for application ${applicationId}`,
          referenceId: applicationId,
        },
      });

      await tx.whatsAppUnlock.create({
        data: {
          landlordId: userId,
          applicationId,
        },
      });
    });

    return true;
  }

  /**
   * Check whether a landlord has already unlocked WhatsApp for a specific application.
   */
  async isWhatsAppUnlocked(
    landlordId: string,
    applicationId: string,
  ): Promise<boolean> {
    const unlock = await this.prisma.whatsAppUnlock.findUnique({
      where: {
        landlordId_applicationId: { landlordId, applicationId },
      },
      select: { id: true },
    });
    return unlock !== null;
  }

  /**
   * Get a list of application IDs that the landlord has already unlocked.
   */
  async getUnlockedApplicationIds(landlordId: string): Promise<Set<string>> {
    const unlocks = await this.prisma.whatsAppUnlock.findMany({
      where: { landlordId },
      select: { applicationId: true },
    });
    return new Set(unlocks.map((u) => u.applicationId));
  }

  /**
   * Get credit transaction history for a user.
   */
  async getTransactions(userId: string, limit = 20, offset = 0) {
    return this.prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
