import { z } from "zod";

export const registerRoleSchema = z.enum([
  "buyer",
  "tenant",
  "seller",
  "landlord",
  "wholesaler",
  "admin",
]);

export const RegisterSchema = z.object({
  email: z.string().email("Invalid email format").max(254, "Email is too long"),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name is too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
  roles: z
    .array(registerRoleSchema)
    .min(1, "Select at least one role")
    .optional()
    .default(["buyer"]),
  ref: z.string().max(20).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format").max(254, "Email is too long"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password is too long"),
});

export const RefreshSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "Refresh token is required")
    .max(2000, "Token is too long"),
});

export const OAuthGoogleSchema = z.object({
  idToken: z
    .string()
    .min(1, "Google ID token is required")
    .max(5000, "Token is too long"),
});

export const OAuthFacebookSchema = z.object({
  accessToken: z
    .string()
    .min(1, "Facebook access token is required")
    .max(4096, "Token is too long"),
});

export const OAuthAppleSchema = z.object({
  identityToken: z
    .string()
    .min(1, "Apple identity token is required")
    .max(5000, "Token is too long"),
  authorizationCode: z
    .string()
    .min(1, "Apple authorization code is required")
    .max(1024, "Code is too long"),
  name: z.string().max(200).optional(),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format").max(254, "Email is too long"),
});

export const ResetPasswordSchema = z.object({
  token: z
    .string()
    .min(1, "Reset token is required")
    .max(128, "Token is too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
export type OAuthGoogleInput = z.infer<typeof OAuthGoogleSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
