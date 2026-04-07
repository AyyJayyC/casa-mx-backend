import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT, requireAdmin } from '../utils/guards.js';
import {
  uploadDocumentSchema,
  documentIdParamSchema,
  verifyDocumentSchema,
} from '../schemas/documents.js';
import { DocumentService } from '../services/documents.service.js';
import { env } from '../config/env.js';

/**
 * Local storage provider (for development/test).
 * In production, replace with an S3 or GCS implementation.
 */
async function localStorageProvider(_encryptedBuffer: Buffer, fileName: string): Promise<string> {
  // In a real deployment this would upload to S3 and return the object key/URL.
  // For now we return a placeholder URL so the rest of the logic can be tested.
  return `local://documents/${Date.now()}-${fileName}`;
}

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  const documentService = new DocumentService(fastify.prisma);

  const isLocalFrontend =
    env.FRONTEND_URL.includes('localhost') ||
    env.FRONTEND_URL.includes('127.0.0.1') ||
    env.FRONTEND_URL.includes('0.0.0.0');

  /**
   * POST /documents/upload
   * Upload a document. In a real deployment the client sends multipart/form-data;
   * for now we accept JSON with base64-encoded file content so the endpoint can be
   * exercised without a multipart parser.
   */
  fastify.post<{ Body: Record<string, any> }>(
    '/documents/upload',
    {
      onRequest: [verifyJWT],
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 100 : isLocalFrontend ? 200 : 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = request.user.id;

        // Parse and validate metadata fields
        const input = uploadDocumentSchema.parse(request.body);

        // Accept base64-encoded file content or treat as empty placeholder
        const base64Content: string = (request.body as any).fileContent ?? '';
        const fileBuffer = base64Content
          ? Buffer.from(base64Content, 'base64')
          : Buffer.alloc(0);

        const document = await documentService.uploadDocument(
          userId,
          input,
          fileBuffer,
          localStorageProvider
        );

        return reply.code(201).send({
          success: true,
          data: document,
          message: 'Document uploaded successfully',
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to upload document',
        });
      }
    }
  );

  /**
   * GET /documents
   * List all documents belonging to the authenticated user.
   */
  fastify.get('/documents', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const documents = await documentService.getDocumentsByUser(userId);

      return reply.send({
        success: true,
        data: documents,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch documents',
      });
    }
  });

  /**
   * GET /documents/:id
   * Get a specific document (owner or admin).
   */
  fastify.get<{ Params: Record<string, string> }>(
    '/documents/:id',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const params = documentIdParamSchema.parse(request.params);
        const userId = request.user.id;
        const userRoles = ((request.user as any)?.roles || []) as string[];
        const isAdmin = userRoles.includes('admin');

        const document = await documentService.getDocumentById(params.id, userId, isAdmin);

        if (!document) {
          return reply.code(404).send({
            success: false,
            error: 'Document not found',
          });
        }

        return reply.send({
          success: true,
          data: document,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch document',
        });
      }
    }
  );

  /**
   * DELETE /documents/:id
   * Delete a document (owner or admin).
   */
  fastify.delete<{ Params: Record<string, string> }>(
    '/documents/:id',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const params = documentIdParamSchema.parse(request.params);
        const userId = request.user.id;
        const userRoles = ((request.user as any)?.roles || []) as string[];
        const isAdmin = userRoles.includes('admin');

        const deleted = await documentService.deleteDocument(params.id, userId, isAdmin);

        if (!deleted) {
          return reply.code(404).send({
            success: false,
            error: 'Document not found or access denied',
          });
        }

        return reply.send({
          success: true,
          message: 'Document deleted successfully',
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to delete document',
        });
      }
    }
  );

  /**
   * PUT /documents/:id/verify
   * Admin-only: approve or reject a document.
   */
  fastify.put<{ Params: Record<string, string>; Body: Record<string, any> }>(
    '/documents/:id/verify',
    {
      onRequest: [requireAdmin],
      config: {
        rateLimit: {
          max: env.NODE_ENV === 'test' ? 100 : isLocalFrontend ? 200 : 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      try {
        const params = documentIdParamSchema.parse(request.params);
        const input = verifyDocumentSchema.parse(request.body);
        const verifierId = request.user.id;

        const document = await documentService.verifyDocument(params.id, verifierId, input);

        if (!document) {
          return reply.code(404).send({
            success: false,
            error: 'Document not found',
          });
        }

        return reply.send({
          success: true,
          data: document,
          message: `Document ${input.status} successfully`,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to verify document',
        });
      }
    }
  );
};

export default documentsRoutes;
