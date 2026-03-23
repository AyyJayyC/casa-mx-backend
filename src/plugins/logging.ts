/**
 * Logging Middleware - Fastify middleware for automatic request/response logging
 * Purpose: Capture all incoming requests and outgoing responses
 * Checkpoint 2: Backend Logging Infrastructure
 */

import { loggingService } from '../services/logging.service.js';
import pino from 'pino';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const logger = pino();

type ErrorWithStatusCode = Error & { statusCode?: number };

function normalizeError(error: unknown): { errorObj: Error; statusCode: number } {
  if (error instanceof Error) {
    const errorWithStatus = error as ErrorWithStatusCode;
    return {
      errorObj: error,
      statusCode: typeof errorWithStatus.statusCode === 'number' ? errorWithStatus.statusCode : 500,
    };
  }

  return {
    errorObj: new Error('Internal server error'),
    statusCode: 500,
  };
}

// Skip logging for health checks and static assets
const SKIP_ENDPOINTS = ['/health', '/metrics', '/.well-known', '/static'];

export async function setupLoggingMiddleware(fastify: FastifyInstance) {
  /**
   * onRequest Hook - Runs before route handler
   */
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Extract or create session ID
    let sessionId: string | undefined =
      (request.headers['x-session-id'] as string) ||
      (request.query as any)?.sessionId;

    // Check for skip endpoints
    const shouldSkip = SKIP_ENDPOINTS.some(ep =>
      request.url.startsWith(ep)
    );

    if (!shouldSkip && !sessionId) {
      // Create new session automatically
      const session = await loggingService.createDebugSession({
        userId: request.user?.id,
        userEmail: request.user?.email,
        initialRoute: request.url,
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip
      });

      sessionId = session?.id;
    }

    // Store in request for use by route handlers and onResponse hook
    request.sessionId = sessionId;
    request.user = request.user || { id: '', email: '', roles: [] }; // Ensure user object exists
    request.startTime = Date.now();
  });

  /**
   * onResponse Hook - Runs after route handler
   */
  fastify.addHook('onResponse', async (request, reply) => {
    // Skip logging for certain endpoints
    const shouldSkip = SKIP_ENDPOINTS.some(ep =>
      request.url.startsWith(ep)
    );

    if (shouldSkip) return;

    try {
      const responseTime = Date.now() - (request.startTime || 0);
      const sessionId = request.sessionId;

      // Log API call
      await loggingService.logApiCall({
        sessionId,
        userId: request.user?.id,
        httpMethod: request.method,
        apiEndpoint: request.url.split('?')[0], // Remove query string
        requestHeaders: sanitizeHeaders(request.headers),
        requestBody: request.body,
        responseStatus: reply.statusCode,
        responseBody: undefined, // reply.payload not available
        responseTimeMs: responseTime,
        currentRoute: request.url,
        userAgent: request.headers['user-agent'] as string
      });

      // Log as error if response status is 400 or higher
      if (reply.statusCode >= 400) {
        await loggingService.logError({
          sessionId,
          userId: request.user?.id,
          userEmail: request.user?.email,
          errorType: 'api',
          errorMessage: `API Error: ${request.method} ${request.url} returned ${reply.statusCode}`,
          errorCode: reply.statusCode,
          severity: reply.statusCode >= 500 ? 'high' : 'medium',
          componentName: 'Fastify API',
          currentRoute: request.url,
          contextData: {
            method: request.method,
            endpoint: request.url,
            statusCode: reply.statusCode,
            responseTime
          }
        });
      }
    } catch (error) {
      logger.error(
        { error, url: request.url },
        'Failed to log response'
      );
    }
  });

  /**
   * onError Hook - Runs when an error occurs
   * Log only here; response shaping is handled by the app-level error handler.
   */
  fastify.addHook('onError', async (request, reply, error) => {
    const sessionId = request.sessionId;
    const responseTime = Date.now() - (request.startTime || 0);
    const { errorObj, statusCode } = normalizeError(error);

    // Log the error
    await loggingService.logError({
      sessionId,
      userId: request.user?.id,
      userEmail: request.user?.email,
      errorType: 'backend',
      errorMessage: errorObj.message,
      errorStackTrace: errorObj.stack,
      errorCode: statusCode,
      severity: statusCode >= 500 ? 'critical' : 'medium',
      componentName: 'Fastify Error Handler',
      currentRoute: request.url,
      contextData: {
        method: request.method,
        endpoint: request.url,
        statusCode,
        responseTime
      }
    }).catch(err =>
      logger.error({ err }, 'Failed to log unhandled error')
    );
  });
}

/**
 * Sanitize headers for logging (redact sensitive values)
 */
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };

  // Redact authorization header
  if (sanitized.authorization) {
    sanitized.authorization = '[REDACTED]';
  }

  // Redact cookies if present
  if (sanitized.cookie) {
    sanitized.cookie = '[REDACTED]';
  }

  // Redact session tokens
  if (sanitized['x-session-id']) {
    sanitized['x-session-id'] = sanitized['x-session-id'].substring(0, 8) + '...';
  }

  return sanitized;
}

export default setupLoggingMiddleware;
