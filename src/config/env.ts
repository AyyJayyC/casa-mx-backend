import { config } from 'dotenv';
import { z } from 'zod';

config();

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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test') {
      return;
    }

    if (!env.MAPS_API_KEY || !env.MAPS_API_KEY.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAPS_API_KEY'],
        message: 'MAPS_API_KEY is required for Google-only address search.',
      });
    }

    if (env.ENABLE_BILLABLE_MAPS !== 'true') {
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
