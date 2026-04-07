import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { UploadDocumentInput, VerifyDocumentInput } from '../schemas/documents.js';

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY_HEX = process.env.DOCUMENT_ENCRYPTION_KEY || '';

function getEncryptionKey(): Buffer {
  const nodeEnv = process.env.NODE_ENV;
  if (ENCRYPTION_KEY_HEX.length >= 64) {
    return Buffer.from(ENCRYPTION_KEY_HEX.slice(0, 64), 'hex');
  }
  if (nodeEnv === 'production') {
    throw new Error(
      'DOCUMENT_ENCRYPTION_KEY must be set to a 64-character hex string in production'
    );
  }
  // Dev/test fallback: derive a key from a fixed string
  return createHash('sha256').update('casa-mx-dev-key').digest();
}

export function encryptData(data: Buffer): { encryptedData: Buffer; iv: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

export function decryptData(encryptedData: Buffer, ivHex: string): Buffer {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

export function computeFileHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class DocumentService {
  constructor(private prisma: PrismaClient) {}

  async uploadDocument(
    userId: string,
    input: UploadDocumentInput,
    fileBuffer: Buffer,
    storageProvider: (encryptedBuffer: Buffer, fileName: string) => Promise<string>
  ) {
    const fileHash = computeFileHash(fileBuffer);
    const { encryptedData, iv } = encryptData(fileBuffer);

    // Store the encrypted file via the provided storage provider
    const fileUrl = await storageProvider(encryptedData, input.fileName);

    const document = await this.prisma.document.create({
      data: {
        userId,
        documentType: input.documentType,
        fileUrl,
        fileHash,
        fileName: input.fileName,
        fileSize: input.fileSize ?? fileBuffer.length,
        mimeType: input.mimeType ?? null,
        encryptionIv: iv,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: 'pending',
      },
    });

    return this.formatDocument(document);
  }

  async getDocumentsByUser(userId: string) {
    const documents = await this.prisma.document.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
    });
    return documents.map(this.formatDocument);
  }

  async getDocumentById(documentId: string, userId: string, isAdmin = false) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });

    if (!document) {
      return null;
    }

    if (!isAdmin && document.userId !== userId) {
      return null; // not found for this user
    }

    return this.formatDocument(document);
  }

  async deleteDocument(documentId: string, userId: string, isAdmin = false) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });

    if (!document) {
      return false;
    }

    if (!isAdmin && document.userId !== userId) {
      return false;
    }

    await this.prisma.document.delete({ where: { id: documentId } });
    return true;
  }

  async verifyDocument(documentId: string, verifierId: string, input: VerifyDocumentInput) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });

    if (!document) {
      return null;
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: input.status,
        verifierNotes: input.verifierNotes ?? null,
        verifiedAt: new Date(),
        verifiedById: verifierId,
      },
    });

    return this.formatDocument(updated);
  }

  private formatDocument(doc: {
    id: string;
    userId: string;
    documentType: string;
    fileUrl: string;
    fileHash: string | null;
    fileName: string;
    fileSize: number | null;
    mimeType: string | null;
    encryptionIv: string | null;
    status: string;
    verifierNotes: string | null;
    verifiedAt: Date | null;
    verifiedById: string | null;
    expiresAt: Date | null;
    uploadedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: doc.id,
      userId: doc.userId,
      documentType: doc.documentType,
      fileName: doc.fileName,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      fileHash: doc.fileHash,
      status: doc.status,
      verifierNotes: doc.verifierNotes,
      verifiedAt: doc.verifiedAt,
      expiresAt: doc.expiresAt,
      uploadedAt: doc.uploadedAt,
      // fileUrl and encryptionIv are intentionally omitted from public output
    };
  }
}
