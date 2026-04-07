import { z } from 'zod';

export const updateMeSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').optional(),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number').optional().nullable(),
    bio: z.string().max(500, 'Bio must be at most 500 characters').optional().nullable(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.email !== undefined ||
      data.phone !== undefined ||
      data.bio !== undefined,
    {
      message: 'At least one field (name, email, phone, or bio) is required',
    }
  );

export const updateProfilePictureSchema = z.object({
  profilePictureUrl: z.string().url('Invalid URL for profile picture'),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});
