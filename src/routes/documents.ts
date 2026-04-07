import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireAdmin } from '../utils/guards.js';
import {
  DocumentsService,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  DOCUMENT_TYPES,
} from '../services/documents.service.js';

const documentIdParamSchema = z.object({
  id: z.string().uuid('Invalid document ID'),
});

const updateVerificationSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']),
  note: z.string().optional(),
});

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  const documentsService = new DocumentsService(fastify.prisma);

  // GET /documents - List current user's documents
  fastify.get('/documents', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const docs = await documentsService.listDocuments(request.user.id);
      return reply.send({ success: true, data: docs });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to list documents' });
    }
  });

  // POST /documents/upload - Upload a document
  fastify.post('/documents/upload', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const data = await (request as any).file();

      if (!data) {
        return reply.code(400).send({ success: false, error: 'No file provided' });
      }

      const documentType = data.fields?.documentType?.value;
      if (!documentType || !(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid documentType. Must be one of: ${DOCUMENT_TYPES.join(', ')}`,
        });
      }

      if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid file type. Allowed: PDF, JPEG, PNG, WEBP`,
        });
      }

      // Read file into buffer to enforce size limit
      const chunks: Buffer[] = [];
      let totalSize = 0;
      for await (const chunk of data.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE_BYTES) {
          return reply.code(413).send({
            success: false,
            error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
          });
        }
        chunks.push(chunk);
      }

      const fileBuffer = Buffer.concat(chunks);

      const documentId = await documentsService.saveDocument(
        request.user.id,
        documentType,
        data.filename,
        data.mimetype,
        fileBuffer,
      );

      return reply.code(201).send({
        success: true,
        data: { id: documentId },
        message: 'Document uploaded successfully. Pending verification.',
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to upload document' });
    }
  });

  // GET /documents/:id/download - Download/view a document
  fastify.get('/documents/:id/download', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const params = documentIdParamSchema.parse(request.params);
      const isAdmin = ((request.user as any).roles ?? []).includes('admin');

      const result = await documentsService.getDocumentBuffer(
        params.id,
        request.user.id,
        isAdmin,
      );

      if (!result) {
        return reply.code(404).send({ success: false, error: 'Document not found or access denied' });
      }

      return reply
        .header('Content-Type', result.mimeType)
        .header('Content-Disposition', `inline; filename="${result.fileName}"`)
        .send(result.buffer);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Invalid document ID' });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to retrieve document' });
    }
  });

  // DELETE /documents/:id - Delete a document
  fastify.delete('/documents/:id', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const params = documentIdParamSchema.parse(request.params);
      const isAdmin = ((request.user as any).roles ?? []).includes('admin');

      const deleted = await documentsService.deleteDocument(params.id, request.user.id, isAdmin);

      if (!deleted) {
        return reply.code(404).send({ success: false, error: 'Document not found or access denied' });
      }

      return reply.send({ success: true, message: 'Document deleted' });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Invalid document ID' });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to delete document' });
    }
  });

  // PATCH /documents/:id/verify - Admin: update verification status
  fastify.patch('/documents/:id/verify', { onRequest: [requireAdmin] }, async (request, reply) => {
    try {
      const params = documentIdParamSchema.parse(request.params);
      const input = updateVerificationSchema.parse(request.body);

      const updated = await documentsService.updateVerificationStatus(
        params.id,
        input.status,
        request.user.id,
        input.note,
      );

      return reply.send({ success: true, data: updated });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return reply.code(400).send({ success: false, error: 'Validation error', details: error.errors });
      }
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to update verification status' });
    }
  });
};

export default documentsRoutes;
