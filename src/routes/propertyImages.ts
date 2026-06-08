import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import {
  uploadToS3,
  getPresignedUrl,
  deleteFromS3,
  isS3Configured,
} from "../services/s3.service.js";
import {
  createImageSchema,
  reorderImagesSchema,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGES_PER_PROPERTY,
} from "../schemas/propertyImages.js";
import { z } from "zod";

const propertyImagesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /properties/:id/images
   * Upload a property listing photo to S3. Owner only.
   * Max 10 images per property. Multipart file upload with optional caption.
   */
  fastify.post<{ Params: { id: string } }>(
    "/properties/:id/images",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }
      if (property.sellerId !== userId) {
        return reply
          .code(403)
          .send({
            success: false,
            error: "You can only upload images to your own properties",
          });
      }

      const imageCount = await fastify.prisma.propertyImage.count({
        where: { propertyId },
      });

      if (imageCount >= MAX_IMAGES_PER_PROPERTY) {
        return reply.code(400).send({
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_PROPERTY} images per property`,
        });
      }

      if (!isS3Configured()) {
        return reply
          .code(503)
          .send({ success: false, error: "Image storage not configured" });
      }

      let caption: string | undefined;
      let filePart: any = null;

      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "caption") {
          caption = String(part.value || "") || undefined;
        }
        if (part.type === "file" && part.fieldname === "file") {
          filePart = part;
        }
      }

      if (!filePart) {
        return reply
          .code(400)
          .send({ success: false, error: "No file uploaded" });
      }
      if (!ALLOWED_IMAGE_TYPES.has(filePart.mimetype)) {
        return reply.code(415).send({
          success: false,
          error: "File type not allowed. Use JPEG, PNG, or WebP.",
        });
      }

      if (caption) {
        const parsed = createImageSchema.safeParse({ caption });
        if (!parsed.success) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: parsed.error.errors,
          });
        }
      }

      const chunks: Buffer[] = [];
      for await (const chunk of filePart.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const { key, fileName, mimeType } = await uploadToS3(
        buffer,
        filePart.filename,
        filePart.mimetype,
        `property-images/${propertyId}`,
      );

      const maxOrder = await fastify.prisma.propertyImage.aggregate({
        where: { propertyId },
        _max: { order: true },
      });
      const nextOrder = (maxOrder._max.order ?? -1) + 1;

      const created = await fastify.prisma.propertyImage.create({
        data: {
          property: { connect: { id: propertyId } },
          imageUrl: key,
          fileName,
          fileMimeType: mimeType,
          order: nextOrder,
          caption: caption || null,
        },
      });

      const presignedUrl = await getPresignedUrl(key);

      return reply.status(201).send({
        success: true,
        image: {
          id: created.id,
          imageUrl: presignedUrl,
          fileName: created.fileName,
          order: created.order,
          caption: created.caption,
          createdAt: created.createdAt,
        },
      });
    },
  );

  /**
   * GET /properties/:id/images
   * List property images with presigned URLs. Public endpoint.
   */
  fastify.get<{ Params: { id: string } }>(
    "/properties/:id/images",
    async (request, reply) => {
      const { id: propertyId } = request.params;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }

      const images = await fastify.prisma.propertyImage.findMany({
        where: { propertyId },
        orderBy: { order: "asc" },
      });

      const imagesWithUrls = await Promise.all(
        images.map(async (img: any) => ({
          id: img.id,
          imageUrl: await getPresignedUrl(img.imageUrl),
          fileName: img.fileName,
          order: img.order,
          caption: img.caption,
          createdAt: img.createdAt,
        })),
      );

      return reply.send({ success: true, images: imagesWithUrls });
    },
  );

  /**
   * DELETE /properties/:id/images/:imageId
   * Delete a listing image. Owner only.
   */
  fastify.delete<{ Params: { id: string; imageId: string } }>(
    "/properties/:id/images/:imageId",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId, imageId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }
      if (property.sellerId !== userId) {
        return reply
          .code(403)
          .send({
            success: false,
            error: "You can only delete images from your own properties",
          });
      }

      const image = await fastify.prisma.propertyImage.findFirst({
        where: { id: imageId, propertyId },
      });

      if (!image) {
        return reply
          .code(404)
          .send({ success: false, error: "Image not found" });
      }

      await deleteFromS3(image.imageUrl);
      await fastify.prisma.propertyImage.delete({ where: { id: imageId } });

      const remaining = await fastify.prisma.propertyImage.findMany({
        where: { propertyId },
        orderBy: { order: "asc" },
      });

      const updates = remaining
        .map((img, i) => ({
          id: img.id,
          currentOrder: img.order,
          expectedOrder: i,
        }))
        .filter(
          ({ currentOrder, expectedOrder }) => currentOrder !== expectedOrder,
        )
        .map(({ id, expectedOrder }) =>
          fastify.prisma.propertyImage.update({
            where: { id },
            data: { order: expectedOrder },
          }),
        );

      if (updates.length > 0) {
        await fastify.prisma.$transaction(updates);
      }

      return reply.send({ success: true });
    },
  );

  /**
   * PATCH /properties/:id/images/:imageId
   * Update image caption or metadata. Owner only.
   */
  fastify.patch<{ Params: { id: string; imageId: string } }>(
    "/properties/:id/images/:imageId",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId, imageId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }
      if (property.sellerId !== userId) {
        return reply
          .code(403)
          .send({
            success: false,
            error: "You can only update images on your own properties",
          });
      }

      const image = await fastify.prisma.propertyImage.findFirst({
        where: { id: imageId, propertyId },
      });

      if (!image) {
        return reply
          .code(404)
          .send({ success: false, error: "Image not found" });
      }

      const body = request.body as { caption?: string };
      const data: Record<string, any> = {};

      if (body.caption !== undefined) {
        const parsed = z.string().max(300).safeParse(body.caption);
        if (!parsed.success) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: parsed.error.errors,
          });
        }
        data.caption = body.caption || null;
      }

      const updated = await fastify.prisma.propertyImage.update({
        where: { id: imageId },
        data,
      });

      return reply.send({
        success: true,
        image: {
          id: updated.id,
          imageUrl: await getPresignedUrl(updated.imageUrl),
          fileName: updated.fileName,
          order: updated.order,
          caption: updated.caption,
          createdAt: updated.createdAt,
        },
      });
    },
  );

  /**
   * PATCH /properties/:id/images/reorder
   * Reorder images by providing an ordered array of image IDs.
   * Owner only.
   */
  fastify.patch<{ Params: { id: string } }>(
    "/properties/:id/images/reorder",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }
      if (property.sellerId !== userId) {
        return reply
          .code(403)
          .send({
            success: false,
            error: "You can only reorder images on your own properties",
          });
      }

      const parsed = reorderImagesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: "Validation error",
          details: parsed.error.errors,
        });
      }

      const { imageIds } = parsed.data;

      const existingImages = await fastify.prisma.propertyImage.findMany({
        where: { propertyId },
        select: { id: true },
      });
      const existingIds = new Set(existingImages.map((i: any) => i.id));

      const allBelong = imageIds.every((id) => existingIds.has(id));
      if (!allBelong) {
        return reply.code(400).send({
          success: false,
          error: "One or more image IDs do not belong to this property",
        });
      }

      await fastify.prisma.$transaction(
        imageIds.map((imageId, index) =>
          fastify.prisma.propertyImage.update({
            where: { id: imageId },
            data: { order: index },
          }),
        ),
      );

      const reordered = await fastify.prisma.propertyImage.findMany({
        where: { propertyId },
        orderBy: { order: "asc" },
      });

      const imagesWithUrls = await Promise.all(
        reordered.map(async (img: any) => ({
          id: img.id,
          imageUrl: await getPresignedUrl(img.imageUrl),
          fileName: img.fileName,
          order: img.order,
          caption: img.caption,
          createdAt: img.createdAt,
        })),
      );

      return reply.send({ success: true, images: imagesWithUrls });
    },
  );
};

export default propertyImagesRoutes;
