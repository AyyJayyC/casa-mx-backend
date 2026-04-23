import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import { uploadToS3, getPresignedUrl, deleteFromS3, isS3Configured } from '../services/s3.service.js';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const VALID_DOC_TYPES = new Set(['official_id', 'other']);

const userDocumentsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /users/documents
   * Upload an account-level document (e.g. INE/IFE).
   * Body: multipart/form-data with fields: documentType, file
   */
  app.post('/users/documents', { preHandler: [verifyJWT] }, async (request, reply) => {
    const userId = (request as any).user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const prisma = (app as any).prisma;

    let documentType = '';
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMimeType = '';

    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'documentType') {
        documentType = String(part.value);
      } else if (part.type === 'file' && part.fieldname === 'file') {
        fileMimeType = part.mimetype;
        fileName = part.filename || 'document';
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        fileBuffer = Buffer.concat(chunks);
      }
    }

    if (!documentType || !VALID_DOC_TYPES.has(documentType)) {
      return reply.code(400).send({ error: 'Invalid or missing documentType. Must be one of: ' + [...VALID_DOC_TYPES].join(', ') });
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }
    if (!ALLOWED_TYPES.has(fileMimeType)) {
      return reply.code(400).send({ error: 'File type not allowed. Use PDF, JPEG, PNG, or WebP.' });
    }
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return reply.code(400).send({ error: 'File too large. Maximum 10MB.' });
    }

    let fileUrl = `local/user-docs/${userId}/${documentType}/${Date.now()}-${fileName}`;

    if (isS3Configured()) {
      const s3Key = `user-documents/${userId}/${documentType}/${Date.now()}-${fileName}`;
      try {
        await uploadToS3(s3Key, fileBuffer, fileMimeType);
        fileUrl = s3Key;
      } catch (err) {
        app.log.error({ err }, 'S3 upload failed for user document');
        return reply.code(500).send({ error: 'Upload failed. Please try again.' });
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
      document: { id: doc.id, documentType: doc.documentType, fileName: doc.fileName },
    });
  });

  /**
   * GET /users/documents
   * List all account-level documents for the authenticated user.
   */
  app.get('/users/documents', { preHandler: [verifyJWT] }, async (request, reply) => {
    const userId = (request as any).user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const prisma = (app as any).prisma;
    const docs = await prisma.userDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const docsWithUrls = await Promise.all(
      docs.map(async (doc: any) => {
        let viewUrl: string | null = null;
        if (isS3Configured() && doc.fileUrl && !doc.fileUrl.startsWith('local/')) {
          try {
            viewUrl = await getPresignedUrl(doc.fileUrl);
          } catch {
            // non-fatal
          }
        }
        return {
          id: doc.id,
          documentType: doc.documentType,
          fileName: doc.fileName,
          fileMimeType: doc.fileMimeType,
          createdAt: doc.createdAt,
          viewUrl,
        };
      })
    );

    return reply.send({ documents: docsWithUrls });
  });

  /**
   * DELETE /users/documents/:docId
   * Delete an account-level document owned by the authenticated user.
   */
  app.delete('/users/documents/:docId', { preHandler: [verifyJWT] }, async (request, reply) => {
    const userId = (request as any).user?.id;
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { docId } = request.params as { docId: string };
    const prisma = (app as any).prisma;

    const doc = await prisma.userDocument.findUnique({ where: { id: docId } });
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    if (doc.userId !== userId) return reply.code(403).send({ error: 'Forbidden' });

    if (isS3Configured() && doc.fileUrl && !doc.fileUrl.startsWith('local/')) {
      try {
        await deleteFromS3(doc.fileUrl);
      } catch (err) {
        app.log.error({ err }, 'S3 delete failed — removing DB record anyway');
      }
    }

    await prisma.userDocument.delete({ where: { id: docId } });
    return reply.code(204).send();
  });
};

export default userDocumentsRoutes;
