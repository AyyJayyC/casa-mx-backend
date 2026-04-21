import { z } from 'zod';

export const StartNegotiationSchema = z.object({
  rentalApplicationId: z.string().uuid(),
  proposedRent: z.number().positive('La renta propuesta debe ser mayor a 0'),
  message: z.string().max(500).optional(),
});

export const CounterOfferSchema = z.object({
  proposedRent: z.number().positive('La renta propuesta debe ser mayor a 0'),
  message: z.string().max(500).optional(),
});

export const RespondOfferSchema = z.object({
  action: z.enum(['accept', 'reject']),
});

export type StartNegotiationInput = z.infer<typeof StartNegotiationSchema>;
export type CounterOfferInput = z.infer<typeof CounterOfferSchema>;
export type RespondOfferInput = z.infer<typeof RespondOfferSchema>;
