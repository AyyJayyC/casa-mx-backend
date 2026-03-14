import { z } from 'zod';

export const updateMeSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').optional(),
    email: z.string().email('Invalid email').optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'At least one field (name or email) is required',
  });

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});
