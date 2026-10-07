import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import {
  uploadToS3,
  getPresignedUrl,
  isS3Configured,
  validateFileContent,
  formatS3Error,
} from "../services/s3.service.js";

// Allowed MIME types for rental application documents
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Verify that the requesting user is either the applicant or the
 * property owner (landlord) for a given rental application.
 */
async function canAccessApplication(
  prisma: any,
  applicationId: string,
  userId: string,
): Promise<boolean> {
  const application = await prisma.rentalApplication.findUnique({
    where: { id: applicationId },
    include: { property: { select: { sellerId: true } } },
  });

  if (!application) return false;
  return (
    application.applicantId === userId ||
    application.property.sellerId === userId
  );
}

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /documents/upload/:applicationId
   * Upload a rental application document to S3 (never local disk).
   * Field name determines which field is updated:
   *   - "idDocument"    → idDocumentUrl
   *   - "incomeProof"   → incomeProofUrl
   *   - "additional"    → appended to additionalDocsUrls
   * The stored value is the S3 object key; use /documents/access to resolve it.
   */
  fastify.post<{ Params: { applicationId: string } }>(
    "/documents/upload/:applicationId",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { applicationId } = request.params;
      const userId = request.user.id;

      if (
        !(await canAccessApplication(fastify.prisma, applicationId, userId))
      ) {
        return reply.code(403).send({ success: false, error: "Access denied" });
      }

      const data = await request.file();
      if (!data) {
        return reply
          .code(400)
          .send({ success: false, error: "No file uploaded" });
      }

      if (!ALLOWED_TYPES.has(data.mimetype)) {
        return reply.code(415).send({
          success: false,
          error: "File type not allowed. Use PDF, JPEG, PNG, or WebP.",
        });
      }

      // Read into memory (capped) so we can validate content before upload.
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of data.file) {
        total += chunk.length;
        if (total > MAX_FILE_SIZE) {
          return reply
            .code(413)
            .send({ success: false, error: "File too large. Maximum 10 MB." });
        }
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      const contentCheck = validateFileContent(buffer, data.mimetype);
      if (!contentCheck.valid) {
        return reply.code(400).send({ success: false, error: contentCheck.error });
      }

      if (!isS3Configured()) {
        return reply.code(503).send({
          success: false,
          error: "Document storage is not configured",
        });
      }

      let key: string;
      try {
        const uploaded = await uploadToS3(
          buffer,
          data.filename || "document",
          data.mimetype,
          `rental-documents/${applicationId}`,
        );
        key = uploaded.key;
      } catch (err: any) {
        fastify.log.error(
          { err, applicationId, userId },
          "S3 upload failed for rental document",
        );
        return reply.code(500).send({ success: false, error: formatS3Error(err) });
      }

      const fieldName = data.fieldname; // idDocument | incomeProof | additional

      const updateData: Record<string, any> = {};
      if (fieldName === "idDocument") {
        updateData.idDocumentUrl = key;
      } else if (fieldName === "incomeProof") {
        updateData.incomeProofUrl = key;
      } else {
        // additional documents — append
        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: applicationId },
          select: { additionalDocsUrls: true },
        });
        updateData.additionalDocsUrls = [
          ...(application?.additionalDocsUrls ?? []),
          key,
        ];
      }

      await fastify.prisma.rentalApplication.update({
        where: { id: applicationId },
        data: updateData,
      });

      return reply.code(201).send({ success: true, url: key });
    },
  );

  /**
   * GET /documents/access?key=<s3-key>
   * Resolve a stored document key to a short-lived presigned URL, after
   * verifying the caller has access to an application referencing that key.
   */
  fastify.get<{ Querystring: { key?: string } }>(
    "/documents/access",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const key = request.query.key;
      if (!key || key.includes("..")) {
        return reply.code(400).send({ success: false, error: "Invalid key" });
      }

      const userId = request.user.id;
      const application = await fastify.prisma.rentalApplication.findFirst({
        where: {
          OR: [
            { idDocumentUrl: key },
            { incomeProofUrl: key },
            { additionalDocsUrls: { has: key } },
          ],
        },
        include: { property: { select: { sellerId: true } } },
      });

      if (!application) {
        return reply
          .code(404)
          .send({ success: false, error: "File not found" });
      }

      if (
        application.applicantId !== userId &&
        application.property.sellerId !== userId
      ) {
        return reply.code(403).send({ success: false, error: "Access denied" });
      }

      if (!isS3Configured()) {
        return reply.code(503).send({
          success: false,
          error: "Document storage is not configured",
        });
      }

      try {
        const url = await getPresignedUrl(key);
        return reply.send({ success: true, url });
      } catch (err: any) {
        fastify.log.error({ err, key }, "Failed to presign document");
        return reply
          .code(500)
          .send({ success: false, error: "Failed to resolve document" });
      }
    },
  );
};

export default documentsRoutes;
