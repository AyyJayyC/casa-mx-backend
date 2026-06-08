import { z } from "zod";
import { randomBytes } from "crypto";

/**
 * Type guard to check if an error is a Zod validation error
 * Replaces brittle constructor.name checks with proper instanceof
 */
export const isZodError = (error: unknown): error is z.ZodError => {
  return error instanceof z.ZodError;
};

/**
 * Standardized error response format for API errors
 */
export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
  field?: string;
}

/**
 * Create a standardized error response for validation errors
 */
export const createValidationErrorResponse = (
  error: z.ZodError,
  showDetails = false,
): ErrorResponse => {
  const isProduction = process.env.NODE_ENV === "production";
  const masked = isProduction && !showDetails;
  return {
    success: false,
    error: "Validation error",
    details: masked
      ? [{ message: "Uno o más campos no son válidos" }]
      : error.errors || error.message,
  };
};

/**
 * Create a standardized error response for server errors
 */
export const createServerErrorResponse = (
  message: string = "Internal server error",
): ErrorResponse => {
  return {
    success: false,
    error: message,
  };
};

/**
 * Normalize an unknown error into a structured object with status code.
 * Extracted from app.ts and plugins/logging.ts to avoid duplication.
 */
export type ErrorWithStatusCode = Error & { statusCode?: number };

export function normalizeError(error: unknown): {
  errorObj: Error;
  statusCode: number;
} {
  if (error instanceof Error) {
    const errorWithStatus = error as ErrorWithStatusCode;
    return {
      errorObj: error,
      statusCode:
        typeof errorWithStatus.statusCode === "number"
          ? errorWithStatus.statusCode
          : 500,
    };
  }

  return {
    errorObj: new Error("Internal server error"),
    statusCode: 500,
  };
}

/**
 * Generate a short referral code.
 * Extracted from auth.service.ts, referrals.ts, and agencies.ts.
 */
export function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
