import { PrismaClient } from '@prisma/client';

export type NotificationType =
  | 'offer_accepted'
  | 'offer_rejected'
  | 'offer_countered'
  | 'application_approved'
  | 'application_rejected'
  | 'offer_received'
  | 'application_received';

export async function createNotification(
  prisma: PrismaClient,
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  entityType?: string,
  entityId?: string
) {
  return prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
    },
  });
}
