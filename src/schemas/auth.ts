import { z } from 'zod';

export const registerRoleSchema = z.enum(['buyer', 'tenant', 'seller', 'landlord', 'wholesaler']);

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format').max(254, 'Email is too long'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name is too long'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  roles: z.array(registerRoleSchema).min(1, 'Select at least one role').optional().default(['buyer']),
  ref: z.string().max(20).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const OAuthGoogleSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
export type OAuthGoogleInput = z.infer<typeof OAuthGoogleSchema>;
