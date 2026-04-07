import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'government_id',       // Identificación Oficial - INE/Pasaporte
  'income_proof',        // Comprobante de Ingresos
  'residence_proof',     // Comprobante de Domicilio
  'aval_id',             // Aval (co-signer) Government ID
  'aval_rfc',            // Aval RFC/Tax ID
  'aval_income',         // Aval Comprobante de Ingresos
  'aval_residence',      // Aval Comprobante de Domicilio
  'property_deed',       // Escritura / Contrato de Arrendamiento (for landlords)
] as const;

export const DOCUMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);

export const uploadDocumentSchema = z.object({
  documentType: documentTypeSchema,
  fileName: z.string().min(1, 'File name is required'),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const documentIdParamSchema = z.object({
  id: z.string().uuid('Invalid document ID'),
});

export const verifyDocumentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  verifierNotes: z.string().max(1000).optional(),
});

export type DocumentType = z.infer<typeof documentTypeSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
