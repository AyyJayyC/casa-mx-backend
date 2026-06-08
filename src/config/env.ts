import { config } from "dotenv";
import { z } from "zod";

config();

const MAPS_KEY_PLACEHOLDER_PATTERNS = [
  /^replace_with/i,
  /^your_/i,
  /^changeme/i,
  /^placeholder/i,
  /^<.+>$/i,
];

export function isConfiguredMapsKey(value?: string | null) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return false;
  }

  return !MAPS_KEY_PLACEHOLDER_PATTERNS.some((pattern) =>
    pattern.test(trimmed),
  );
}

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.string().default("3001"),
    DATABASE_URL: z.string(),
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default("15m"),
    JWT_REFRESH_EXPIRY: z.string().default("7d"),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),
    MAPS_API_KEY: z.string().optional(),
    ENABLE_BILLABLE_MAPS: z.enum(["true", "false"]).default("false"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_APP_ID: z.string().optional(),
    FACEBOOK_APP_SECRET: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_TEAM_ID: z.string().optional(),
    APPLE_KEY_ID: z.string().optional(),
    APPLE_PRIVATE_KEY: z.string().optional(),
    FULFILL_SECRET: z.string().optional(),
    ADMIN_INITIAL_PASSWORD: z.string().optional(),
    MIGRATION_SECRET: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z
      .string()
      .email()
      .optional()
      .default("noreply@casa-mx.com"),
    RESEND_FROM_NAME: z.string().optional().default("CasaMX"),
    AWS_REGION: z.string().optional().default("us-east-1"),
    AWS_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    TEST_ADMIN_PASSWORD: z.string().optional().default("admin123"),
    TEST_SELLER_PASSWORD: z.string().optional().default("seller123"),
    DISABLE_SECURITY: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "test") {
      return;
    }

    // Production-required services
    if (env.NODE_ENV === "production") {
      if (
        !env.RESEND_API_KEY ||
        env.RESEND_API_KEY.startsWith("re_placeholder")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESEND_API_KEY"],
          message:
            "RESEND_API_KEY must be set to a real Resend API key (all emails silently fail without it)",
        });
      }

      if (!isConfiguredMapsKey(env.MAPS_API_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MAPS_API_KEY"],
          message:
            "MAPS_API_KEY must be set to a real Google Maps server-side key for address search.",
        });
      }

      if (env.ENABLE_BILLABLE_MAPS !== "true") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ENABLE_BILLABLE_MAPS"],
          message:
            "ENABLE_BILLABLE_MAPS must be true for Google-only address search.",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Invalid environment variables:");
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join(".")}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
