import { PrismaClient } from "@prisma/client";

export type NotificationType =
  | "offer_accepted"
  | "offer_rejected"
  | "offer_countered"
  | "application_approved"
  | "application_rejected"
  | "offer_received"
  | "application_received"
  | "new_property_in_area";

export async function createNotification(
  prisma: PrismaClient,
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  entityType?: string,
  entityId?: string,
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

export async function notifyTagSubscribers(
  prisma: PrismaClient,
  propertyId: string,
  propertyTitle: string,
  ciudad?: string | null,
  colonia?: string | null,
) {
  const tags: string[] = [];
  if (ciudad) tags.push(ciudad);
  if (colonia) tags.push(colonia);
  if (tags.length === 0) return;

  const normalized = tags.map((t) =>
    String(t)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );

  const subscriptions = await prisma.tagSubscription.findMany({
    where: {
      tagNormal: { in: normalized },
      notifyInApp: true,
    },
    select: { userId: true, tagName: true },
  });

  if (subscriptions.length === 0) return;

  const notified = new Set<string>();
  for (const sub of subscriptions) {
    if (notified.has(sub.userId)) continue;
    notified.add(sub.userId);

    await createNotification(
      prisma,
      sub.userId,
      "new_property_in_area",
      `🏠 Nueva propiedad en ${sub.tagName}`,
      propertyTitle,
      "property",
      propertyId,
    ).catch((err) => {
      console.error(
        `[notify] Failed to create notification for user ${sub.userId}:`,
        err?.message,
      );
    });
  }
}
