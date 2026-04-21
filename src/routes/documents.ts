import { FastifyPluginAsync } from 'fastify';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyJWT } from '../utils/guards.js';

// Allowed MIME types for rental application documents
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'documents');

async function ensureUploadsDir() {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

/**
 * Verify that the requesting user is either the applicant or the
 * property owner (landlord) for a given rental application.
 */
async function canAccessApplication(prisma: any, applicationId: string, userId: string): Promise<boolean> {
  const application = await prisma.rentalApplication.findUnique({
    where: { id: applicationId },
    include: { property: { select: { sellerId: true } } },
  });

  if (!application) return false;
  return application.applicantId === userId || application.property.sellerId === userId;
}

const documentsRoutes: FastifyPluginAsync = async (fastify) => {
  await ensureUploadsDir();

  /**
   * POST /documents/upload/:applicationId
   * Upload a document for a rental application.
   * Field name determines which field is updated:
   *   - "idDocument"    → idDocumentUrl
   *   - "incomeProof"   → incomeProofUrl
   *   - "additional"    → appended to additionalDocsUrls
   */
  fastify.post<{ Params: { applicationId: string } }>(
    '/documents/upload/:applicationId',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { applicationId } = request.params;
      const userId = request.user.id;

      if (!(await canAccessApplication(fastify.prisma, applicationId, userId))) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ success: false, error: 'No file uploaded' });
      }

      if (!ALLOWED_TYPES.has(data.mimetype)) {
        return reply.code(415).send({ success: false, error: 'File type not allowed. Use PDF, JPEG, PNG, or WebP.' });
      }

      const ext = extname(data.filename) || '.bin';
      const filename = `${randomUUID()}${ext}`;
      const filePath = join(UPLOADS_DIR, filename);

      await pipeline(data.file, createWriteStream(filePath));

      const fileUrl = `/documents/file/${filename}`;
      const fieldName = data.fieldname; // idDocument | incomeProof | additional

      const updateData: Record<string, any> = {};
      if (fieldName === 'idDocument') {
        updateData.idDocumentUrl = fileUrl;
      } else if (fieldName === 'incomeProof') {
        updateData.incomeProofUrl = fileUrl;
      } else {
        // additional documents — append
        const application = await fastify.prisma.rentalApplication.findUnique({
          where: { id: applicationId },
          select: { additionalDocsUrls: true },
        });
        updateData.additionalDocsUrls = [...(application?.additionalDocsUrls ?? []), fileUrl];
      }

      await fastify.prisma.rentalApplication.update({
        where: { id: applicationId },
        data: updateData,
      });

      return reply.code(201).send({ success: true, url: fileUrl });
    }
  );

  /**
   * GET /documents/file/:filename
   * Serve a document file. Requires authentication.
   * Caller must have access to the application that references this file
   * (enforced via referencing only URLs obtained from the application object).
   */
  fastify.get<{ Params: { filename: string } }>(
    '/documents/file/:filename',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { filename } = request.params;

      // Prevent path traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return reply.code(400).send({ success: false, error: 'Invalid filename' });
      }

      // Verify the requesting user has access to an application referencing this file
      const fileUrl = `/documents/file/${filename}`;
      const userId = request.user.id;

      const application = await fastify.prisma.rentalApplication.findFirst({
        where: {
          OR: [
            { idDocumentUrl: fileUrl },
            { incomeProofUrl: fileUrl },
            { additionalDocsUrls: { has: fileUrl } },
          ],
        },
        include: { property: { select: { sellerId: true } } },
      });

      if (!application) {
        return reply.code(404).send({ success: false, error: 'File not found' });
      }

      if (application.applicantId !== userId && application.property.sellerId !== userId) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const filePath = join(UPLOADS_DIR, filename);
      if (!existsSync(filePath)) {
        return reply.code(404).send({ success: false, error: 'File not found on disk' });
      }

      // Set content type based on extension
      const ext = extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
      };
      const contentType = mimeMap[ext] ?? 'application/octet-stream';

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      reply.header('Cache-Control', 'private, no-cache');
      reply.send(createReadStream(filePath));
    }
  );
};

export default documentsRoutes;
