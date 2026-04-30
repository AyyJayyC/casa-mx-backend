import { z } from 'zod';

export const updateMeSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    avatarUrl: z.string().url('Invalid avatar URL').optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.whatsapp !== undefined ||
      data.avatarUrl !== undefined,
    {
      message: 'At least one field is required',
    },
  );

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});
