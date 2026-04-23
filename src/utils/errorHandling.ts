import { z } from 'zod';

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
export const createValidationErrorResponse = (error: z.ZodError): ErrorResponse => {
  return {
    success: false,
    error: 'Validation error',
    details: error.errors || error.message,
  };
};

/**
 * Create a standardized error response for server errors
 */
export const createServerErrorResponse = (message: string = 'Internal server error'): ErrorResponse => {
  return {
    success: false,
    error: message,
  };
};
