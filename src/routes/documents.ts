/**
 * Documents Routes
 *
 * Endpoints for document upload, listing, retrieval, deletion, and verification.
 * All documents are encrypted with AES-256-CBC before storage.
 */

import { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { verifyJWT, requireAdmin } from '../utils/guards.js';
import { encryptDocument, decryptDocument, verifyFileIntegrity } from '../services/documents.service.js';
import { uploadToS3, downloadFromS3, deleteFromS3 } from '../services/s3.service.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_DOCUMENT_TYPES = [
  'government_id',
  'income_proof',
  'residence_proof',
  'aval_id',
  'aval_income_proof',
  'aval_residence_proof',
] as const;

type DocumentType = typeof ALLOWED_DOCUMENT_TYPES[number];

const VerifyDocumentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  verificationNotes: z.string().optional(),
});

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  // Register multipart support scoped to this plugin
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
  });

  /**
   * POST /documents
   * Upload a document (multipart/form-data).
   * Fields: documentType (string), file (binary)
   */
  fastify.post('/documents', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({ success: false, error: 'No file uploaded' });
      }

      // Validate document type from form field
      const documentType = data.fields?.documentType as any;
      const docTypeValue = documentType?.value ?? documentType;
      if (!docTypeValue || !ALLOWED_DOCUMENT_TYPES.includes(docTypeValue as DocumentType)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid documentType. Must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
        });
      }

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid file type. Only PDF, JPG, and PNG are allowed.',
        });
      }

      // Read file buffer
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const fileBuffer = Buffer.concat(chunks);

      // Enforce size limit after reading (multipart plugin also enforces it)
      if (fileBuffer.length > MAX_FILE_SIZE) {
        return reply.code(400).send({ success: false, error: 'File size exceeds 10 MB limit' });
      }

      // Encrypt document
      const { encryptedData, encryptedKey, fileHash } = encryptDocument(fileBuffer);

      // Build a unique S3 key including the original extension for easier identification
      const userId = request.user.id;
      const fileId = randomUUID();
      const ext = data.filename.split('.').pop() ?? 'bin';
      const s3Key = `documents/${userId}/${fileId}.${ext}.enc`;

      // Upload encrypted data to S3
      await uploadToS3(s3Key, encryptedData, 'application/octet-stream');

      // Persist document record in database
      const document = await fastify.prisma.document.create({
        data: {
          userId,
          documentType: docTypeValue as string,
          fileName: data.filename,
          filePath: s3Key,
          fileHash,
          fileSize: fileBuffer.length,
          encryptedKey,
          status: 'pending',
        },
      });

      return reply.code(201).send({
        success: true,
        data: {
          id: document.id,
          documentType: document.documentType,
          fileName: document.fileName,
          fileSize: document.fileSize,
          status: document.status,
          uploadedAt: document.uploadedAt,
        },
      });
    } catch (error: any) {
      if (error?.code === 'FST_FILES_LIMIT') {
        return reply.code(400).send({ success: false, error: 'Only one file per request is allowed' });
      }
      if (error?.code === 'FST_FILE_TOO_LARGE' || error?.message?.includes('File size limit')) {
        return reply.code(400).send({ success: false, error: 'File size exceeds 10 MB limit' });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Document upload failed' });
    }
  });

  /**
   * GET /documents
   * List all documents for the authenticated user.
   */
  fastify.get('/documents', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const documents = await fastify.prisma.document.findMany({
        where: { userId: request.user.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          documentType: true,
          fileName: true,
          fileSize: true,
          status: true,
          verificationNotes: true,
          uploadedAt: true,
          verifiedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      return reply.code(200).send({ success: true, data: documents });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to list documents' });
    }
  });

  /**
   * GET /documents/:id
   * Download a specific document (decrypted).
   * Only the owner or an admin may download.
   */
  fastify.get<{ Params: { id: string } }>(
    '/documents/:id',
    {
      onRequest: [verifyJWT],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
    try {
      const { id } = request.params;

      const document = await fastify.prisma.document.findUnique({ where: { id } });

      if (!document) {
        return reply.code(404).send({ success: false, error: 'Document not found' });
      }

      const userRoles: string[] = (request.user as any)?.roles ?? [];
      const isAdmin = userRoles.includes('admin');

      if (document.userId !== request.user.id && !isAdmin) {
        return reply.code(403).send({ success: false, error: 'Forbidden' });
      }

      // Fetch encrypted data from S3
      const encryptedData = await downloadFromS3(document.filePath);

      // Decrypt
      const plaintext = decryptDocument({
        encryptedData,
        encryptedKey: document.encryptedKey,
      });

      // Integrity check
      if (document.fileHash && !verifyFileIntegrity(plaintext, document.fileHash)) {
        fastify.log.error({ documentId: id }, 'Document integrity check failed');
        return reply.code(500).send({ success: false, error: 'Document integrity check failed' });
      }

      // Determine content type from file name
      const ext = document.fileName.split('.').pop()?.toLowerCase();
      const contentTypeMap: Record<string, string> = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
      };
      const contentType = contentTypeMap[ext ?? ''] ?? 'application/octet-stream';

      return reply
        .code(200)
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${document.fileName}"`)
        .send(plaintext);
    } catch (error: any) {
      if (error?.message?.includes('not configured')) {
        return reply.code(503).send({ success: false, error: 'Document storage not available in this environment' });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to retrieve document' });
    }
  });

  /**
   * GET /documents/:id/status
   * Get verification status of a document.
   */
  fastify.get<{ Params: { id: string } }>('/documents/:id/status', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const document = await fastify.prisma.document.findUnique({
        where: { id },
        select: {
          id: true,
          documentType: true,
          status: true,
          verificationNotes: true,
          uploadedAt: true,
          verifiedAt: true,
          expiresAt: true,
        },
      });

      if (!document) {
        return reply.code(404).send({ success: false, error: 'Document not found' });
      }

      const userRoles: string[] = (request.user as any)?.roles ?? [];
      const isAdmin = userRoles.includes('admin');

      // Only owner or admin may view status
      const ownerDoc = await fastify.prisma.document.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true },
      });

      if (!ownerDoc && !isAdmin) {
        return reply.code(403).send({ success: false, error: 'Forbidden' });
      }

      return reply.code(200).send({ success: true, data: document });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to get document status' });
    }
  });

  /**
   * DELETE /documents/:id
   * Delete a document. Only the owner may delete.
   */
  fastify.delete<{ Params: { id: string } }>('/documents/:id', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { id } = request.params;

      const document = await fastify.prisma.document.findUnique({ where: { id } });

      if (!document) {
        return reply.code(404).send({ success: false, error: 'Document not found' });
      }

      if (document.userId !== request.user.id) {
        return reply.code(403).send({ success: false, error: 'Forbidden' });
      }

      // Delete from S3 (best-effort; ignore errors if not configured)
      try {
        await deleteFromS3(document.filePath);
      } catch {
        // S3 deletion is best-effort
      }

      await fastify.prisma.document.delete({ where: { id } });

      return reply.code(200).send({ success: true, message: 'Document deleted successfully' });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to delete document' });
    }
  });

  /**
   * PUT /documents/:id/verify
   * Verify or reject a document. Admin only.
   */
  fastify.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/documents/:id/verify',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const parsed = VerifyDocumentSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: parsed.error.errors,
          });
        }

        const document = await fastify.prisma.document.findUnique({ where: { id } });

        if (!document) {
          return reply.code(404).send({ success: false, error: 'Document not found' });
        }

        const updated = await fastify.prisma.document.update({
          where: { id },
          data: {
            status: parsed.data.status,
            verificationNotes: parsed.data.verificationNotes,
            verifiedAt: new Date(),
            verifierId: request.user.id,
          },
        });

        return reply.code(200).send({
          success: true,
          data: {
            id: updated.id,
            status: updated.status,
            verificationNotes: updated.verificationNotes,
            verifiedAt: updated.verifiedAt,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to verify document' });
      }
    }
  );
};

export default documentsRoutes;
