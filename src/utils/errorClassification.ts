/**
 * Error Classification Utilities
 * Determines error types and status codes for API responses
 */

const CLIENT_ERROR_MESSAGES = new Set([
  'Rental application not found',
  'Reviews are only allowed for approved rental applications',
  'You have already reviewed this user for the selected rental application',
  'Only the approved tenant can review the landlord for this application',
  'Only the property landlord can review the tenant for this application',
]);

/**
 * Determine if an error message represents a client error (400) vs server error (500)
 * Client errors are validation/permission/not-found issues
 * Server errors are unexpected failures
 */
export const isClientError = (message: string): boolean => {
  return CLIENT_ERROR_MESSAGES.has(message) || 
    message.includes('not found') ||
    message.includes('already');
};

/**
 * Calculate days remaining in current month
 */
export const getDaysRemainingInMonth = (): number => {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.ceil((+monthEnd - +now) / (1000 * 60 * 60 * 24));
};
