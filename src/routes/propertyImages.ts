import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import {
  uploadPublicImage,
  deletePublicImage,
  keyFromPublicUrl,
  isR2Configured,
  validateFileContent,
} from "../services/s3.service.js";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGES_PER_PROPERTY,
  MAX_IMAGE_SIZE,
  deleteImageSchema,
} from "../schemas/propertyImages.js";

const propertyImagesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /properties/:id/images
   * Upload one property photo to R2. Owner only. Does NOT write the DB —
   * the client collects the returned URLs and persists them via PATCH
   * /properties/:id (imageUrls), so ordering stays client-controlled.
   */
  fastify.post<{ Params: { id: string } }>(
    "/properties/:id/images",
    {
      onRequest: [verifyJWT],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "15 minutes",
          keyGenerator: (req) =>
            "img:upload:" + ((req as any).user?.id || req.ip),
        },
      },
    },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true, imageUrls: true },
      });

      if (!property) {
        return reply
          .code(404)
          .send({ success: false, error: "Property not found" });
      }
      if (property.sellerId !== userId) {
        return reply.code(403).send({
          success: false,
          error: "You can only upload images to your own properties",
        });
      }

      const imageCount = Array.isArray(property.imageUrls)
        ? property.imageUrls.length
        : 0;
      if (imageCount >= MAX_IMAGES_PER_PROPERTY) {
        return reply.code(400).send({
          success: false,
          error: `Maximum ${MAX_IMAGES_PER_PROPERTY} images per property`,
        });
      }

      if (!isR2Configured()) {
        return reply
          .code(503)
          .send({ success: false, error: "Image storage not configured" });
      }

      // NOTE: each file stream MUST be drained inside this loop — the parts()
      // iterator back-pressures and stalls otherwise.
      let buffer: Buffer | null = null;
      let fileMime = "";
      let hasFile = false;
      let tooLarge = false;

      for await (const part of request.parts()) {
        if (part.type !== "file") continue;

        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of part.file) {
          total += chunk.length;
          if (total <= MAX_IMAGE_SIZE) chunks.push(chunk);
        }

        if (part.fieldname === "file" && !hasFile) {
          hasFile = true;
          fileMime = part.mimetype;
          if (total > MAX_IMAGE_SIZE || part.file.truncated) {
            tooLarge = true;
          } else {
            buffer = Buffer.concat(chunks);
          }
        }
      }

      if (!hasFile) {
        return reply
          .code(400)
          .send({ success: false, error: "No file uploaded" });
      }
      if (tooLarge) {
        return reply.code(413).send({
          success: false,
          error: `File too large. Maximum ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)}MB.`,
        });
      }
      if (!ALLOWED_IMAGE_TYPES.has(fileMime)) {
        return reply.code(415).send({
          success: false,
          error: "File type not allowed. Use JPEG, PNG, or WebP.",
        });
      }

      const contentCheck = validateFileContent(buffer as Buffer, fileMime);
      if (!contentCheck.valid) {
        return reply
          .code(400)
          .send({ success: false, error: contentCheck.error });
      }

      try {
        const { key, publicUrl } = await uploadPublicImage(
          buffer as Buffer,
          fileMime,
          `property-images/${propertyId}`,
        );
        return reply.status(201).send({
          success: true,
          image: { url: publicUrl, key },
        });
      } catch (error: any) {
        request.log.error({ err: error }, "R2 property image upload failed");
        return reply
          .code(500)
          .send({ success: false, error: error?.message || "Upload failed" });
      }
    },
  );

  /**
   * DELETE /properties/:id/images
   * Delete an uploaded image object from R2 by URL. Owner only. External
   * URLs (host ≠ R2_PUBLIC_BASE_URL) are rejected so we never touch
   * third-party storage.
   */
  fastify.delete<{ Params: { id: string } }>(
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
        return reply.code(403).send({
          success: false,
          error: "You can only delete images from your own properties",
        });
      }

      const parsed = deleteImageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: "Validation error",
          details: parsed.error.errors,
        });
      }

      if (!keyFromPublicUrl(parsed.data.url)) {
        return reply.code(400).send({
          success: false,
          error: "URL does not belong to image storage",
        });
      }

      await deletePublicImage(parsed.data.url);

      return reply.send({ success: true });
    },
  );
};

export default propertyImagesRoutes;
