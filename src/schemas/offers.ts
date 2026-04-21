import { z } from 'zod';

export const FINANCING_TYPES = ['cash', 'bankLoan', 'INFONAVIT', 'FOVISSSTE', 'paymentPlan', 'other'] as const;

export const createPropertyOfferSchema = z.object({
  offerAmount: z.number().positive('Offer amount must be positive'),
  financing: z.enum(FINANCING_TYPES, { errorMap: () => ({ message: 'Invalid financing type' }) }),
  closingDate: z.string().optional(), // ISO date string
  message: z.string().max(1000).optional(),

  // Payment plan (only when financing = paymentPlan)
  enganche:     z.number().positive().optional(),
  plazoMeses:   z.number().int().min(1).max(360).optional(),
  cuotaMensual: z.number().positive().optional(),

  // Buyer contact info
  buyerName: z.string().min(1, 'Name is required'),
  buyerEmail: z.string().email('Invalid email'),
  buyerPhone: z.string().min(10, 'Phone must be at least 10 characters'),
});

export type CreatePropertyOfferInput = z.infer<typeof createPropertyOfferSchema>;

export const respondPropertyOfferSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'countered'], {
    errorMap: () => ({ message: 'Status must be accepted, rejected, or countered' }),
  }),
  sellerNote: z.string().max(1000).optional(),
  counterAmount: z.number().positive().optional(),
});

export type RespondPropertyOfferInput = z.infer<typeof respondPropertyOfferSchema>;

export const offerIdParamSchema = z.object({
  id: z.string().uuid('Invalid offer ID'),
});

export const propertyIdParamSchema = z.object({
  propertyId: z.string().uuid('Invalid property ID'),
});
