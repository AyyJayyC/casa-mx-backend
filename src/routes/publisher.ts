import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  createSalePropertySchema,
  createRentalPropertySchema,
} from "../schemas/properties.js";
import { notifyTagSubscribers } from "../services/notification.service.js";
import {
  deletePublicImage,
  keyFromPublicUrl,
} from "../services/s3.service.js";

/**
 * Casa MX Publisher API — /publisher/*
 *
 * Authentication is enforced by the publisherAuth onRequest hook (X-API-Key).
 * Every route is scoped by `request.publisher.userId`; listings are upserted by
 * (sellerId, externalId) so a pipeline re-run updates instead of duplicating.
 */

const externalId = z.string().min(1).max(200);

const publisherCreateSchema = z.discriminatedUnion("listingType", [
  createSalePropertySchema.extend({ externalId }),
  createRentalPropertySchema.extend({ externalId }),
]);

const publisherImagesSchema = z.object({
  imageUrls: z
    .array(
      z
        .string()
        .max(500, "Each image URL must be <= 500 characters")
        .refine((v) => v.startsWith("https://"), "Image must be an https URL"),
    )
    .max(25, "Maximum 25 images allowed"),
});

const ownerSummary = (p: {
  id: string;
  status: string;
  visibility: string;
  externalId: string | null;
  imageUrls: string[];
  createdAt: Date;
}) => ({
  id: p.id,
  status: p.status,
  visibility: p.visibility,
  externalId: p.externalId,
  imageUrls: p.imageUrls,
  createdAt: p.createdAt,
});

/** Map a validated create-body to Prisma Property fields (drafts by default). */
function toPropertyData(input: any) {
  return {
    title: input.title,
    description: input.description || "",
    address: input.address || "",
    imageUrls: input.imageUrls ?? [],
    price: input.price ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    estado: input.estado,
    ciudad: input.ciudad || "",
    colonia: input.colonia || "",
    codigoPostal: input.codigoPostal || null,
    propertyType: input.propertyType || "Casa",
    bedrooms: input.bedrooms ?? 0,
    bathrooms: input.bathrooms ?? 0,
    squareMeters: input.squareMeters ?? 1,
    includedServices: input.includedServices ?? [],
    amenities: input.amenities ?? [],
    financeOptions: input.financeOptions ?? [],
    status: "incompleto",
    visibility: "private",
    listingType: input.listingType || "for_sale",
    monthlyRent: input.monthlyRent ?? null,
    securityDeposit: input.securityDeposit ?? null,
    leaseTermMonths: input.leaseTermMonths ?? null,
    availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
    furnished: input.furnished ?? "unfurnished",
    utilitiesIncluded:
      (input.includedServices?.length ?? 0) > 0 ||
      (input.utilitiesIncluded ?? false),
    condition: input.condition ?? null,
    parkingType: input.parkingType ?? null,
    parkingSpaces: input.parkingSpaces ?? null,
    miniSplits: input.miniSplits ?? null,
    petFriendly: input.petFriendly ?? false,
    petFee: input.petFee ?? null,
    petDeposit: input.petDeposit ?? null,
    yearBuilt: input.yearBuilt ?? null,
    floors: input.floors ?? null,
    lotSize: input.lotSize ?? null,
    maintenanceFee: input.maintenanceFee ?? null,
    halfBaths: input.halfBaths ?? null,
    childrenWelcome: input.childrenWelcome ?? false,
    issuesInvoice: input.issuesInvoice ?? false,
  };
}

const publisherRoutes: FastifyPluginAsync = async (app) => {
  // Env-overridable caps (read at registration so tests can tune them).
  const cap = (name: string, fallback: number) => {
    const raw = process.env[name] ?? (env as any)[name];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const keyGenerator = (req: any) =>
    "pub:" + (req.publisher?.keyId ?? req.ip);
  const limit = (name: string, fallback: number) => ({
    max: cap(name, fallback),
    timeWindow: "15 minutes",
    keyGenerator,
  });

  const publisherId = (request: any): string => request.publisher.userId;

  const findOwned = async (id: string, userId: string) => {
    const property = await app.prisma.property.findUnique({ where: { id } });
    if (!property || property.sellerId !== userId) return null;
    return property;
  };

  const grantOwnerRole = async (userId: string) => {
    const ownerRole = await app.prisma.role.findUnique({
      where: { name: "owner" },
    });
    if (!ownerRole) return;
    await app.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: ownerRole.id } },
      create: { userId, roleId: ownerRole.id, status: "approved" },
      update: {},
    });
  };

  const writeAudit = async (
    actorUserId: string,
    action: string,
    previousState: unknown,
    newState: unknown,
  ) => {
    try {
      await app.prisma.auditLog.create({
        data: {
          actorUserId,
          action,
          previousState: previousState ?? undefined,
          newState: newState ?? undefined,
        },
      });
    } catch (err) {
      app.log.warn({ err }, "publisher audit log write failed");
    }
  };

  // POST /publisher/listings — create or update a draft listing by externalId.
  app.post(
    "/listings",
    { config: { rateLimit: limit("PUBLISHER_RATE_CREATE", 60) } },
    async (request, reply) => {
      const userId = publisherId(request);
      try {
        const raw = (request.body ?? {}) as any;
        const normalized = raw.listingType
          ? raw
          : { ...raw, listingType: "for_sale" };

        const parsed = publisherCreateSchema.safeParse(normalized);
        if (!parsed.success) {
          return reply.code(400).send({
            success: false,
            error: "Validation failed",
            details: parsed.error.errors,
          });
        }

        const input = parsed.data;
        const data = toPropertyData(input);
        // status/visibility are draft defaults for `create` only. A re-POST of
        // an existing externalId is a metadata update and must not reset a
        // published listing back to draft.
        const { status: _status, visibility: _visibility, ...updateData } = data;
        const property = await app.prisma.property.upsert({
          where: {
            sellerId_externalId: {
              sellerId: userId,
              externalId: input.externalId,
            },
          },
          create: { ...data, sellerId: userId, externalId: input.externalId },
          update: { ...updateData, externalId: input.externalId },
        });

        await grantOwnerRole(userId);
        await writeAudit(
          userId,
          "PUBLISHER_CREATE_LISTING",
          null,
          { id: property.id, externalId: property.externalId },
        );

        return reply.code(201).send({ success: true, data: ownerSummary(property) });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to create listing" });
      }
    },
  );

  // PUT /publisher/listings/:id/images — replace the image array.
  app.put(
    "/listings/:id/images",
    { config: { rateLimit: limit("PUBLISHER_RATE_IMAGES", 120) } },
    async (request, reply) => {
      const userId = publisherId(request);
      const { id } = request.params as { id: string };
      try {
        const property = await findOwned(id, userId);
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Listing not found" });
        }

        const parsed = publisherImagesSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({
            success: false,
            error: "Validation failed",
            details: parsed.error.errors,
          });
        }

        const updated = await app.prisma.property.update({
          where: { id },
          data: { imageUrls: parsed.data.imageUrls },
        });
        await writeAudit(userId, "PUBLISHER_UPDATE_IMAGES", null, {
          id,
          count: updated.imageUrls.length,
        });

        return reply.send({
          success: true,
          data: { id: updated.id, imageUrls: updated.imageUrls },
        });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to update images" });
      }
    },
  );

  // POST /publisher/listings/:id/publish — requires >=1 image; idempotent.
  app.post(
    "/listings/:id/publish",
    { config: { rateLimit: limit("PUBLISHER_RATE_PUBLISH", 60) } },
    async (request, reply) => {
      const userId = publisherId(request);
      const { id } = request.params as { id: string };
      try {
        const property = await findOwned(id, userId);
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Listing not found" });
        }
        if (!property.imageUrls || property.imageUrls.length === 0) {
          return reply.code(400).send({
            success: false,
            error: "At least one image is required to publish",
          });
        }

        const updated = await app.prisma.property.update({
          where: { id },
          data: { status: "disponible", visibility: "public" },
        });

        notifyTagSubscribers(
          app.prisma,
          updated.id,
          updated.title,
          updated.ciudad,
          updated.colonia,
        ).catch((err: any) =>
          app.log.warn({ err }, "Failed to send tag notifications"),
        );

        await writeAudit(userId, "PUBLISHER_PUBLISH", null, {
          id,
          status: updated.status,
          visibility: updated.visibility,
        });

        return reply.send({
          success: true,
          data: {
            id: updated.id,
            status: updated.status,
            visibility: updated.visibility,
          },
        });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to publish listing" });
      }
    },
  );

  // POST /publisher/listings/:id/unpublish — private; idempotent.
  app.post(
    "/listings/:id/unpublish",
    { config: { rateLimit: limit("PUBLISHER_RATE_UNPUBLISH", 60) } },
    async (request, reply) => {
      const userId = publisherId(request);
      const { id } = request.params as { id: string };
      try {
        const property = await findOwned(id, userId);
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Listing not found" });
        }

        const updated = await app.prisma.property.update({
          where: { id },
          data: { visibility: "private" },
        });
        await writeAudit(userId, "PUBLISHER_UNPUBLISH", null, {
          id,
          visibility: updated.visibility,
        });

        return reply.send({
          success: true,
          data: { id: updated.id, visibility: updated.visibility },
        });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to unpublish listing" });
      }
    },
  );

  // DELETE /publisher/listings/:id — delete incl. R2 cleanup; idempotent.
  app.delete(
    "/listings/:id",
    { config: { rateLimit: limit("PUBLISHER_RATE_DELETE", 30) } },
    async (request, reply) => {
      const userId = publisherId(request);
      const { id } = request.params as { id: string };
      try {
        const property = await app.prisma.property.findUnique({
          where: { id },
        });
        if (!property) {
          // Idempotent: already gone.
          return reply.send({ success: true, message: "Listing deleted" });
        }
        if (property.sellerId !== userId) {
          // Do not leak existence of another owner's listing.
          return reply
            .code(404)
            .send({ success: false, error: "Listing not found" });
        }

        // Delete managed R2 objects; external URLs are skipped.
        const imageUrls = Array.isArray(property.imageUrls)
          ? property.imageUrls
          : [];
        const deletions = await Promise.allSettled(
          imageUrls
            .filter(
              (url): url is string =>
                typeof url === "string" && Boolean(keyFromPublicUrl(url)),
            )
            .map((url) => deletePublicImage(url)),
        );
        for (const result of deletions) {
          if (result.status === "rejected") {
            app.log.warn(
              { err: result.reason },
              "Failed to delete publisher listing image from R2",
            );
          }
        }

        await app.prisma.property.delete({ where: { id } });

        const remaining = await app.prisma.property.count({
          where: { sellerId: userId },
        });
        if (remaining === 0) {
          const ownerRole = await app.prisma.role.findUnique({
            where: { name: "owner" },
          });
          if (ownerRole) {
            await app.prisma.userRole.deleteMany({
              where: { userId, roleId: ownerRole.id },
            });
          }
        }

        await writeAudit(userId, "PUBLISHER_DELETE", { id }, null);
        return reply.send({ success: true, message: "Listing deleted" });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to delete listing" });
      }
    },
  );

  // GET /publisher/listings/:id — owner-only projection (drafts included).
  app.get(
    "/listings/:id",
    { config: { rateLimit: limit("PUBLISHER_RATE_GET", 300) } },
    async (request, reply) => {
      const userId = publisherId(request);
      const { id } = request.params as { id: string };
      try {
        const property = await findOwned(id, userId);
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Listing not found" });
        }
        return reply.send({ success: true, data: property });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch listing" });
      }
    },
  );
};

export default publisherRoutes;
