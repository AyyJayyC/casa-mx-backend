import { z } from 'zod';

export const registerRoleSchema = z.enum(['buyer', 'tenant', 'seller', 'landlord', 'wholesaler']);

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Invalid phone number').optional(),
  roles: z.array(registerRoleSchema).min(1, 'Select at least one role').optional().default(['buyer']),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const RequestVerificationSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type RequestVerificationInput = z.infer<typeof RequestVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
