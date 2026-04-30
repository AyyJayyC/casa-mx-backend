import { config } from 'dotenv';
import { z } from 'zod';

config();

const MAPS_KEY_PLACEHOLDER_PATTERNS = [/^replace_with/i, /^your_/i, /^changeme/i, /^placeholder/i, /^<.+>$/i];

export function isConfiguredMapsKey(value?: string | null) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return false;
  }

  return !MAPS_KEY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3001'),
    DATABASE_URL: z.string(),
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),
    FRONTEND_URL: z.string().url().default('http://localhost:3000'),
    MAPS_API_KEY: z.string().optional(),
    ENABLE_BILLABLE_MAPS: z.enum(['true', 'false']).default('false'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_SUBSCRIPTION_PRICE_ID: z.string().optional(),
    STRIPE_SUBSCRIPTION_SUCCESS_URL: z.string().url().optional(),
    STRIPE_SUBSCRIPTION_CANCEL_URL: z.string().url().optional(),
    STRIPE_BILLING_PORTAL_RETURN_URL: z.string().url().optional(),
    SENDGRID_API_KEY: z.string().optional(),
    SENDGRID_FROM_EMAIL: z.string().email().optional().default('noreply@Casa-MX.com.mx'),
    SENDGRID_FROM_NAME: z.string().optional().default('Casa-MX.com'),
    AWS_REGION: z.string().optional().default('us-east-1'),
    AWS_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test') {
      return;
    }

    if (env.NODE_ENV === 'production' && !isConfiguredMapsKey(env.MAPS_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAPS_API_KEY'],
        message: 'MAPS_API_KEY must be set to a real Google Maps server-side key for address search.',
      });
    }

    if (env.NODE_ENV === 'production' && env.ENABLE_BILLABLE_MAPS !== 'true') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENABLE_BILLABLE_MAPS'],
        message: 'ENABLE_BILLABLE_MAPS must be true for Google-only address search.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:');
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();

