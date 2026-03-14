import { z } from 'zod';

export const AnalyticsEventSchema = z.object({
  eventName: z.string().min(1, 'Event name is required'),
  entityId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export type AnalyticsEventInput = z.infer<typeof AnalyticsEventSchema>;
