import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { env } from '../config/env.js';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const DOCUMENT_TYPES = [
  'government_id',
  'income_proof',
  'residence_proof',
  'aval_id',
  'aval_ine',
  'aval_income_proof',
  'aval_residence_proof',
  'property_ownership',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export class DocumentsService {
  private uploadDir: string;
  private encryptionKey: Buffer | null;

  constructor(private prisma: PrismaClient) {
    this.uploadDir = env.UPLOAD_DIR ?? './uploads';
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }

    this.encryptionKey = env.DOCUMENT_ENCRYPTION_KEY
      ? Buffer.from(env.DOCUMENT_ENCRYPTION_KEY, 'hex')
      : null;
  }

  /**
   * Save an uploaded file, encrypting if a key is configured.
   */
  async saveDocument(
    userId: string,
    documentType: DocumentType,
    fileName: string,
    mimeType: string,
    fileBuffer: Buffer,
  ): Promise<string> {
    const ext = extname(fileName) || '.bin';
    const storedFileName = `${randomBytes(16).toString('hex')}${ext}`;
    const filePath = join(this.uploadDir, storedFileName);

    let encryptionIv = '';

    if (this.encryptionKey) {
      const iv = randomBytes(16);
      encryptionIv = iv.toString('hex');
      const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, encrypted);
    } else {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, fileBuffer);
    }

    const doc = await this.prisma.userDocument.create({
      data: {
        userId,
        documentType,
        fileName,
        storedFileName,
        filePath,
        mimeType,
        fileSizeBytes: fileBuffer.length,
        encryptionIv,
        verificationStatus: 'pending',
      },
    });

    return doc.id;
  }

  /**
   * Retrieve and optionally decrypt a document by ID.
   * Returns null if not found or user is not the owner (unless admin).
   */
  async getDocumentBuffer(
    documentId: string,
    requestingUserId: string,
    isAdmin = false,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) return null;
    if (!isAdmin && doc.userId !== requestingUserId) return null;

    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(doc.filePath);

    let buffer: Buffer;

    if (doc.encryptionIv && this.encryptionKey) {
      const iv = Buffer.from(doc.encryptionIv, 'hex');
      const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      buffer = Buffer.concat([decipher.update(raw), decipher.final()]);
    } else {
      buffer = raw;
    }

    return { buffer, mimeType: doc.mimeType, fileName: doc.fileName };
  }

  async listDocuments(userId: string) {
    return this.prisma.userDocument.findMany({
      where: { userId },
      select: {
        id: true,
        documentType: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        verificationStatus: true,
        verificationNote: true,
        verifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteDocument(documentId: string, requestingUserId: string, isAdmin = false): Promise<boolean> {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) return false;
    if (!isAdmin && doc.userId !== requestingUserId) return false;

    await this.prisma.userDocument.delete({ where: { id: documentId } });

    if (existsSync(doc.filePath)) {
      await unlink(doc.filePath);
    }

    return true;
  }

  /**
   * Admin: update verification status of a document.
   */
  async updateVerificationStatus(
    documentId: string,
    status: 'pending' | 'verified' | 'rejected',
    verifiedById: string,
    note?: string,
  ) {
    return this.prisma.userDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: status,
        verificationNote: note,
        verifiedAt: status !== 'pending' ? new Date() : null,
        verifiedById,
      },
    });
  }
}
