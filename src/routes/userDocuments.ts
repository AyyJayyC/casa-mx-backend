import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import {
  uploadToS3,
  getPresignedUrl,
  deleteFromS3,
  isS3Configured,
  validateFileContent,
  formatS3Error,
} from "../services/s3.service.js";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const VALID_DOC_TYPES = new Set(["official_id", "other"]);

const userDocumentsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /users/documents
   * Upload an account-level document (e.g. INE/IFE).
   * Body: multipart/form-data with fields: documentType, file
   */
  app.post(
    "/users/documents",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const prisma = (app as any).prisma;

      let documentType = "";
      let fileBuffer: Buffer | null = null;
      let fileName = "";
      let fileMimeType = "";

      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "documentType") {
          documentType = String(part.value);
        } else if (part.type === "file" && part.fieldname === "file") {
          fileMimeType = part.mimetype;
          fileName = part.filename || "document";
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          fileBuffer = Buffer.concat(chunks);
        }
      }

      if (!documentType || !VALID_DOC_TYPES.has(documentType)) {
        return reply
          .code(400)
          .send({
            error:
              "Invalid or missing documentType. Must be one of: " +
              [...VALID_DOC_TYPES].join(", "),
          });
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        return reply
          .code(400)
          .send({ error: "No file uploaded. Please select a file to upload." });
      }
      if (!ALLOWED_TYPES.has(fileMimeType)) {
        return reply
          .code(400)
          .send({
            error: `File type "${fileMimeType}" not allowed. Accepted types: PDF, JPEG, PNG, WebP.`,
          });
      }
      if (fileBuffer.length > MAX_FILE_SIZE) {
        const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(1);
        return reply
          .code(400)
          .send({
            error: `File too large (${sizeMB} MB). Maximum allowed: 10 MB.`,
          });
      }

      // Verify file content matches its declared type (magic bytes check)
      const contentCheck = validateFileContent(fileBuffer, fileMimeType);
      if (!contentCheck.valid) {
        return reply.code(400).send({ error: contentCheck.error });
      }

      let fileUrl = `local/user-docs/${userId}/${documentType}/${Date.now()}-${fileName}`;

      if (isS3Configured()) {
        const folder = `user-documents/${userId}/${documentType}`;
        try {
          const uploaded = await uploadToS3(
            fileBuffer,
            fileName,
            fileMimeType,
            folder,
          );
          fileUrl = uploaded.key;
        } catch (err: any) {
          const detail = formatS3Error(err);
          app.log.error(
            { err, userId, documentType, fileName, fileMimeType },
            "S3 upload failed for user document",
          );
          return reply.code(500).send({ error: detail });
        }
      }

      const doc = await prisma.userDocument.create({
        data: {
          userId,
          documentType,
          fileUrl,
          fileName,
          fileMimeType,
        },
      });

      return reply.code(201).send({
        document: {
          id: doc.id,
          documentType: doc.documentType,
          fileName: doc.fileName,
        },
      });
    },
  );

  /**
   * GET /users/documents
   * List all account-level documents for the authenticated user.
   */
  app.get(
    "/users/documents",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const prisma = (app as any).prisma;
      const docs = await prisma.userDocument.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      const docsWithUrls = await Promise.all(
        docs.map(async (doc: any) => {
          let viewUrl: string | null = null;
          if (
            isS3Configured() &&
            doc.fileUrl &&
            !doc.fileUrl.startsWith("local/")
          ) {
            try {
              viewUrl = await getPresignedUrl(doc.fileUrl);
            } catch (err: any) {
              app.log.error(
                { err, docId: doc.id },
                "Failed to generate presigned URL for document",
              );
            }
          }
          return {
            id: doc.id,
            documentType: doc.documentType,
            fileName: doc.fileName,
            fileMimeType: doc.fileMimeType,
            createdAt: doc.createdAt,
            viewUrl,
            isVerified: doc.isVerified ?? false,
            reviewStatus: doc.reviewStatus ?? null,
            reviewNote: doc.reviewNote ?? null,
          };
        }),
      );

      return reply.send({ documents: docsWithUrls });
    },
  );

  /**
   * DELETE /users/documents/:docId
   * Delete an account-level document owned by the authenticated user.
   */
  app.delete(
    "/users/documents/:docId",
    { preHandler: [verifyJWT] },
    async (request, reply) => {
      const userId = (request as any).user?.id;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { docId } = request.params as { docId: string };
      const prisma = (app as any).prisma;

      const doc = await prisma.userDocument.findUnique({
        where: { id: docId },
      });
      if (!doc) return reply.code(404).send({ error: "Document not found" });
      if (doc.userId !== userId)
        return reply.code(403).send({ error: "Forbidden" });

      if (
        isS3Configured() &&
        doc.fileUrl &&
        !doc.fileUrl.startsWith("local/")
      ) {
        try {
          await deleteFromS3(doc.fileUrl);
        } catch (err: any) {
          app.log.error(
            { err, docId },
            "S3 delete failed — removing DB record anyway",
          );
        }
      }

      await prisma.userDocument.delete({ where: { id: docId } });
      return reply.code(204).send();
    },
  );
};

export default userDocumentsRoutes;
