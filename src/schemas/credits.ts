import { z } from 'zod';

export const SpendCreditSchema = z.object({
  leadId:   z.string().uuid('Invalid lead ID'),
  leadType: z.enum(['application', 'request']),
});

export const CreatePaymentIntentSchema = z.object({
  packageId: z.string().uuid('Invalid package ID'),
});

export const FulfillPaymentSchema = z.object({
  stripePaymentIntentId: z.string().min(1),
  packageId: z.string().uuid(),
});

export type SpendCreditInput = z.infer<typeof SpendCreditSchema>;
export type CreatePaymentIntentInput = z.infer<typeof CreatePaymentIntentSchema>;
export type FulfillPaymentInput = z.infer<typeof FulfillPaymentSchema>;
