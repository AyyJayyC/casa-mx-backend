/**
 * Logging Middleware - Fastify middleware for automatic request/response logging
 * Purpose: Capture all incoming requests and outgoing responses
 * Checkpoint 2: Backend Logging Infrastructure
 */

import { loggingService } from '../services/logging.service.js';
import pino from 'pino';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const logger = pino();

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
   */
  fastify.setErrorHandler(async (error, request, reply) => {
    const sessionId = request.sessionId;
    const responseTime = Date.now() - (request.startTime || 0);

    // Log the error
    await loggingService.logError({
      sessionId,
      userId: request.user?.id,
      userEmail: request.user?.email,
      errorType: 'backend',
      errorMessage: error.message,
      errorStackTrace: error.stack,
      errorCode: error.statusCode || 500,
      severity: (error as any)?.statusCode >= 500 ? 'critical' : 'medium',
      componentName: 'Fastify Error Handler',
      currentRoute: request.url,
      contextData: {
        method: request.method,
        endpoint: request.url,
        statusCode: error.statusCode || 500,
        responseTime
      }
    }).catch(err =>
      logger.error({ err }, 'Failed to log unhandled error')
    );

    // Return error response (Fastify handles this automatically)
    reply.statusCode = error.statusCode || 500;
    return {
      statusCode: error.statusCode || 500,
      error: error.name,
      message: error.message
    };
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
