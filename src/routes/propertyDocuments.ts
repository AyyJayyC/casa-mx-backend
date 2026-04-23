import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import { uploadToS3, getPresignedUrl, deleteFromS3, isS3Configured } from '../services/s3.service.js';
import { sendVerificationApprovedEmail, sendVerificationRejectedEmail } from '../services/email.service.js';

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Required docs per role type
const REQUIRED_DOCS_BY_ROLE: Record<string, string[]> = {
  seller:     ['title_deed'],
  landlord:   ['title_deed'],
  wholesaler: ['agent_authorization'],
};

// All recognized documentType values
const VALID_DOC_TYPES = new Set(['title_deed', 'official_id', 'agent_authorization', 'other']);

async function getSellerRole(prisma: any, userId: string): Promise<string> {
  const roles = await prisma.userRole.findMany({
    where: { userId, status: 'approved' },
    include: { role: true },
  });
  const roleNames = roles.map((r: any) => r.role.name as string);
  if (roleNames.includes('admin'))      return 'seller';
  if (roleNames.includes('wholesaler')) return 'wholesaler';
  if (roleNames.includes('landlord'))   return 'landlord';
  return 'seller';
}

async function tryAutoVerify(prisma: any, propertyId: string, sellerRole: string): Promise<boolean> {
  const required = REQUIRED_DOCS_BY_ROLE[sellerRole] ?? REQUIRED_DOCS_BY_ROLE['seller'];
  const docs = await prisma.propertyDocument.findMany({
    where: { propertyId },
    select: { documentType: true },
  });
  const uploaded = new Set(docs.map((d: any) => d.documentType as string));
  const allPresent = required.every((r) => uploaded.has(r));

  if (allPresent) {
    await prisma.property.update({
      where: { id: propertyId },
      data: { verificationStatus: 'verified' },
    });
    return true;
  } else {
    // Mark as docs_uploaded if at least one doc is present
    if (docs.length > 0) {
      await prisma.property.update({
        where: { id: propertyId },
        data: { verificationStatus: 'docs_uploaded' },
      });
    }
    return false;
  }
}

const propertyDocumentsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /properties/:id/documents
   * Seller/landlord/wholesaler uploads an ownership verification document.
   * Field `documentType` (multipart field) must be one of:
   *   title_deed | official_id | agent_authorization | other
   */
  fastify.post<{ Params: { id: string } }>(
    '/properties/:id/documents',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true, verificationStatus: true },
      });

      if (!property) return reply.code(404).send({ success: false, error: 'Property not found' });
      if (property.sellerId !== userId) return reply.code(403).send({ success: false, error: 'Access denied' });
      if (property.verificationStatus === 'verified') {
        return reply.code(400).send({ success: false, error: 'Property is already verified' });
      }

      if (!isS3Configured()) {
        return reply.code(503).send({ success: false, error: 'Document storage not configured' });
      }

      let documentType = 'other';
      let filePart: any = null;

      for await (const part of request.parts()) {
        if (part.type === 'field' && part.fieldname === 'documentType') {
          documentType = String(part.value || 'other');
        }

        if (part.type === 'file' && part.fieldname === 'file') {
          filePart = part;
        }
      }

      if (!filePart) return reply.code(400).send({ success: false, error: 'No file uploaded' });
      if (!ALLOWED_TYPES.has(filePart.mimetype)) {
        return reply.code(415).send({ success: false, error: 'File type not allowed. Use PDF, JPEG, PNG, or WebP.' });
      }

      if (!VALID_DOC_TYPES.has(documentType)) {
        return reply.code(400).send({ success: false, error: `Invalid documentType. Valid: ${[...VALID_DOC_TYPES].join(', ')}` });
      }

      // Read buffer (10 MB limit already enforced by multipart plugin)
      const chunks: Buffer[] = [];
      for await (const chunk of filePart.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const { key, fileName, mimeType } = await uploadToS3(
        buffer,
        filePart.filename,
        filePart.mimetype,
        `property-docs/${propertyId}`,
      );

      const createdDoc = await fastify.prisma.propertyDocument.create({
        data: {
          propertyId,
          uploaderId: userId,
          documentType,
          fileUrl: key,
          fileName,
          fileMimeType: mimeType,
        },
      });

      const sellerRole = await getSellerRole(fastify.prisma, userId);
      const autoVerified = await tryAutoVerify(fastify.prisma, propertyId, sellerRole);

      const required = REQUIRED_DOCS_BY_ROLE[sellerRole] ?? REQUIRED_DOCS_BY_ROLE['seller'];
      const docs = await fastify.prisma.propertyDocument.findMany({
        where: { propertyId },
        select: { documentType: true },
      });
      const uploaded = docs.map((d: any) => d.documentType as string);
      const missing = required.filter((r) => !uploaded.includes(r));

      return reply.send({
        success: true,
        document: {
          id: createdDoc.id,
          documentType: createdDoc.documentType,
          fileName: createdDoc.fileName,
        },
        autoVerified,
        verificationStatus: autoVerified ? 'verified' : 'docs_uploaded',
        uploadedTypes: uploaded,
        missingTypes: missing,
      });
    }
  );

  /**
   * GET /properties/:id/documents
   * Returns document list with presigned URLs (seller + admin only).
   */
  fastify.get<{ Params: { id: string } }>(
    '/properties/:id/documents',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true },
      });
      if (!property) return reply.code(404).send({ success: false, error: 'Property not found' });

      const isAdmin = (request.user as any).roles?.includes('admin');
      if (property.sellerId !== userId && !isAdmin) {
        return reply.code(403).send({ success: false, error: 'Access denied' });
      }

      const docs = await fastify.prisma.propertyDocument.findMany({
        where: { propertyId },
        orderBy: { createdAt: 'asc' },
      });

      const docsWithUrls = await Promise.all(
        docs.map(async (doc: any) => ({
          ...doc,
          presignedUrl: await getPresignedUrl(doc.fileUrl),
        }))
      );

      return reply.send({ success: true, documents: docsWithUrls });
    }
  );

  /**
   * DELETE /properties/:id/documents/:docId
   * Seller removes a document (only when not yet verified).
   */
  fastify.delete<{ Params: { id: string; docId: string } }>(
    '/properties/:id/documents/:docId',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const { id: propertyId, docId } = request.params;
      const userId = request.user.id;

      const property = await fastify.prisma.property.findUnique({
        where: { id: propertyId },
        select: { sellerId: true, verificationStatus: true },
      });
      if (!property) return reply.code(404).send({ success: false, error: 'Property not found' });
      if (property.sellerId !== userId) return reply.code(403).send({ success: false, error: 'Access denied' });
      if (property.verificationStatus === 'verified') {
        return reply.code(400).send({ success: false, error: 'Cannot remove documents from a verified property' });
      }

      const doc = await fastify.prisma.propertyDocument.findFirst({
        where: { id: docId, propertyId },
      });
      if (!doc) return reply.code(404).send({ success: false, error: 'Document not found' });

      await deleteFromS3(doc.fileUrl);
      await fastify.prisma.propertyDocument.delete({ where: { id: docId } });

      // Re-check if status should revert
      const remaining = await fastify.prisma.propertyDocument.count({ where: { propertyId } });
      if (remaining === 0) {
        await fastify.prisma.property.update({
          where: { id: propertyId },
          data: { verificationStatus: 'unverified' },
        });
      }

      return reply.send({ success: true });
    }
  );

  /**
   * PATCH /admin/properties/:id/verify
   * Admin override: set verificationStatus (verified | rejected) with optional note.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/admin/properties/:id/verify',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const adminId = request.user.id;
      const isAdmin = (request.user as any).roles?.includes('admin');
      if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });

      const { id: propertyId } = request.params;
      const { status, note } = request.body as { status: 'verified' | 'rejected'; note?: string };

      if (!['verified', 'rejected'].includes(status)) {
        return reply.code(400).send({ success: false, error: 'status must be verified or rejected' });
      }

      const property = await fastify.prisma.property.update({
        where: { id: propertyId },
        data: { verificationStatus: status, verificationNote: note ?? null },
        include: { documents: true },
      });

      // Fetch seller email for notification
      const seller = await fastify.prisma.user.findUnique({
        where: { id: property.sellerId },
        select: { email: true, name: true },
      });
      if (seller) {
        if (status === 'verified') {
          await sendVerificationApprovedEmail({ sellerEmail: seller.email, sellerName: seller.name, propertyTitle: property.title });
        } else {
          await sendVerificationRejectedEmail({ sellerEmail: seller.email, sellerName: seller.name, propertyTitle: property.title, note: note ?? '' });
        }
      }

      await fastify.prisma.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: property.sellerId,
          action: status === 'verified' ? 'VERIFY_PROPERTY' : 'REJECT_PROPERTY',
          newState: { propertyId, status, note },
        },
      });

      return reply.send({ success: true, verificationStatus: status });
    }
  );

  /**
   * GET /admin/properties/pending-verification
   * Admin: list all properties that need manual review (docs_uploaded or unverified with docs).
   */
  fastify.get(
    '/admin/properties/pending-verification',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const isAdmin = (request.user as any).roles?.includes('admin');
      if (!isAdmin) return reply.code(403).send({ success: false, error: 'Admin only' });

      const properties = await fastify.prisma.property.findMany({
        where: { verificationStatus: { in: ['docs_uploaded', 'unverified'] } },
        select: {
          id: true,
          title: true,
          verificationStatus: true,
          verificationNote: true,
          createdAt: true,
          sellerId: true,
          seller: { select: { name: true, email: true } },
          documents: {
            select: { id: true, documentType: true, fileName: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return reply.send({ success: true, properties });
    }
  );
};

export default propertyDocumentsRoutes;
