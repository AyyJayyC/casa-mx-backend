import { z } from 'zod';

/**
 * Schema for userRoleId param validation
 */
export const UserRoleIdParamSchema = z.object({
  userRoleId: z.string().uuid('Invalid userRoleId format'),
});

export type UserRoleIdParam = z.infer<typeof UserRoleIdParamSchema>;
