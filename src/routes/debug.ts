/**
 * Debug Routes - API endpoints for logging and debugging
 * Purpose: Public endpoints for frontend logging, admin endpoints for log viewing
 * Checkpoint 2: Backend Logging Infrastructure
 * 
 * Note: @ts-nocheck is used because Fastify schema types have restrictive 
 * definitions that don't align with our debug route configuration.
 * Future work: Create proper FastifyHandler types for debug routes.
 */
// @ts-nocheck

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loggingService } from '../services/logging.service.js';
import { requireAdmin } from '../utils/guards.js';

export async function setupDebugRoutes(fastify: FastifyInstance) {
  const truncateString = (value: unknown, maxLength: number) => {
    if (typeof value !== 'string') return value;
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  };

  const sanitizeObjectField = (value: unknown, maxLength = 8000) => {
    if (value === undefined || value === null) return value;
    try {
      const serialized = JSON.stringify(value);
      const truncated = serialized.length > maxLength ? serialized.slice(0, maxLength) : serialized;
      return JSON.parse(truncated);
    } catch {
      return undefined;
    }
  };

  /**
   * POST /debug/session
   * Create a new debug session (public endpoint, no auth required)
   */
  fastify.post<{ Body: any }>(
    '/debug/session',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      },
      schema: {
        description: 'Create a new debug session',
        tags: ['debug'],
        body: {
          type: 'object',
          properties: {
            userAgent: { type: 'string' },
            initialRoute: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' }
            }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await loggingService.createDebugSession({
        userId: request.user?.id,
        userEmail: request.user?.email,
        initialRoute: truncateString(request.body?.initialRoute, 500) || request.url,
        userAgent: truncateString(request.body?.userAgent, 500) || truncateString(request.headers['user-agent'], 500),
        ipAddress: request.ip
      });

      return reply.send({ id: session?.id || 'error' });
    }
  );

  /**
   * POST /debug/action
   * Log an action from the frontend (public endpoint, no auth required)
   */
  fastify.post<{ Body: any }>(
    '/debug/action',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      },
      schema: {
        description: 'Log a user action',
        tags: ['debug'],
        body: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            actionType: { type: 'string' },
            actionName: { type: 'string' },
            componentName: { type: 'string' },
            currentRoute: { type: 'string' },
            metadata: { type: 'object' }
          },
          required: ['sessionId', 'actionType', 'actionName']
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, actionType, actionName, componentName, currentRoute, metadata } = request.body;

      if (!sessionId) {
        return reply.status(400).send({ error: 'sessionId required' });
      }

      const action = await loggingService.logAction({
        sessionId: truncateString(sessionId, 128),
        userId: request.user?.id,
        userEmail: request.user?.email,
        actionType: truncateString(actionType, 128),
        actionName: truncateString(actionName, 256),
        componentName: truncateString(componentName, 256),
        currentRoute: truncateString(currentRoute, 500) || request.url,
        metadata: sanitizeObjectField(metadata),
        userAgent: truncateString(request.headers['user-agent'], 500)
      });

      return reply.send({ success: !!action, id: action?.id });
    }
  );

  /**
   * POST /debug/error
   * Log an error from the frontend (public endpoint, no auth required)
   */
  fastify.post<{ Body: any }>(
    '/debug/error',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      },
      schema: {
        description: 'Log an error',
        tags: ['debug'],
        body: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            errorMessage: { type: 'string' },
            errorStackTrace: { type: 'string' },
            errorType: { type: 'string' },
            severity: { type: 'string' },
            componentName: { type: 'string' },
            currentRoute: { type: 'string' },
            contextData: { type: 'object' }
          },
          required: ['sessionId', 'errorMessage']
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        sessionId,
        errorMessage,
        errorStackTrace,
        errorType,
        severity,
        componentName,
        currentRoute,
        contextData
      } = request.body;

      if (!sessionId) {
        return reply.status(400).send({ error: 'sessionId required' });
      }

      const error = await loggingService.logError({
        sessionId: truncateString(sessionId, 128),
        userId: request.user?.id,
        userEmail: request.user?.email,
        errorType: truncateString(errorType, 128) || 'frontend',
        errorMessage: truncateString(errorMessage, 4000),
        errorStackTrace: truncateString(errorStackTrace, 8000),
        severity: truncateString(severity, 32) || 'medium',
        componentName: truncateString(componentName, 256),
        currentRoute: truncateString(currentRoute, 500) || request.url,
        contextData: sanitizeObjectField(contextData)
      });

      return reply.send({ success: !!error, id: error?.id });
    }
  );

  /**
   * GET /admin/debug/sessions
   * List all debug sessions with filters (admin only)
   */
  fastify.get<{ Querystring: any }>(
    '/admin/debug/sessions',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'List debug sessions',
        tags: ['admin', 'debug'],
        querystring: {
          type: 'object',
          properties: {
            hasErrors: { type: 'boolean' },
            userId: { type: 'string' },
            userEmail: { type: 'string' },
            exported: { type: 'boolean' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessions, total } = await loggingService.getSessionsList(request.query);

      return reply.send({
        sessions,
        total,
        limit: request.query.limit || 20,
        offset: request.query.offset || 0
      });
    }
  );

  /**
   * GET /admin/debug/sessions/:sessionId
   * Get complete session details (admin only)
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/admin/debug/sessions/:sessionId',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Get session details',
        tags: ['admin', 'debug'],
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId']
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await loggingService.getSessionWithLogs(request.params.sessionId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      return reply.send(session);
    }
  );

  /**
   * POST /admin/debug/sessions/:sessionId/export
   * Export bug report JSON (admin only)
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/admin/debug/sessions/:sessionId/export',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Export bug report',
        tags: ['admin', 'debug'],
        params: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' }
          },
          required: ['sessionId']
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const session = await loggingService.getSessionWithLogs(request.params.sessionId);

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Generate bug report
      const bugReport = generateBugReport(session);

      // Mark session as exported
      try {
        await loggingService.updateSessionExported(request.params.sessionId);
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to mark session as exported');
      }

      return reply.send(bugReport);
    }
  );

  /**
   * PATCH /admin/debug/errors/:errorId/resolve
   * Mark error as resolved (admin only)
   */
  fastify.patch<{ Params: { errorId: string }; Body: any }>(
    '/admin/debug/errors/:errorId/resolve',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Mark error as resolved',
        tags: ['admin', 'debug'],
        params: {
          type: 'object',
          properties: {
            errorId: { type: 'string' }
          },
          required: ['errorId']
        },
        body: {
          type: 'object',
          properties: {
            note: { type: 'string' }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const error = await loggingService.resolveError(
        request.params.errorId,
        request.user?.id,
        request.body?.note
      );

      if (!error) {
        return reply.status(404).send({ error: 'Error not found' });
      }

      return reply.send(error);
    }
  );

  /**
   * DELETE /admin/debug/cleanup
   * Clean up old logs (admin only)
   */
  fastify.delete<{ Querystring: any }>(
    '/admin/debug/cleanup',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Clean up old logs',
        tags: ['admin', 'debug'],
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number' }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await loggingService.cleanupOldLogs(request.query.days);
      return reply.send(result);
    }
  );

  /**
   * GET /admin/debug/stats
   * Get debug statistics (admin only)
   */
  fastify.get(
    '/admin/debug/stats',
    {
      preHandler: [requireAdmin],
      schema: {
        description: 'Get debug statistics',
        tags: ['admin', 'debug']
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const stats = await loggingService.getStats();
      return reply.send(stats);
    }
  );
}

/**
 * Generate structured bug report from session data
 */
function generateBugReport(session: any) {
  const actionLogs = session.actionLogs || [];
  const errorLogs = session.errorLogs || [];
  const apiLogs = session.apiLogs || [];

  // Merge all logs by timestamp for timeline
  const timeline = [
    ...actionLogs.map(log => ({
      type: 'action',
      timestamp: log.timestamp,
      ...log
    })),
    ...errorLogs.map(log => ({
      type: 'error',
      timestamp: log.timestamp,
      ...log
    })),
    ...apiLogs.map(log => ({
      type: 'api',
      timestamp: log.timestamp,
      ...log
    }))
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Generate reproduction steps
  const stepsToReproduce = timeline.map((event, index) => {
    switch (event.type) {
      case 'action':
        if (event.actionType === 'navigation') {
          return `${index + 1}. Navigate to ${event.currentRoute}`;
        } else if (event.actionType === 'form_submit') {
          const formData = event.metadata?.fields ? Object.keys(event.metadata.fields).join(', ') : 'form';
          return `${index + 1}. Submit ${event.actionName} with form data`;
        } else {
          return `${index + 1}. ${event.actionType}: ${event.actionName}`;
        }
      case 'error':
        return `${index + 1}. Observe error: ${event.errorMessage}`;
      case 'api':
        return `${index + 1}. API call: ${event.httpMethod} ${event.apiEndpoint} → ${event.responseStatus}`;
      default:
        return `${index + 1}. Unknown event`;
    }
  });

  // Extract likely root cause
  const rootCause = extractRootCause(timeline);

  return {
    reportVersion: '1.0',
    generatedAt: new Date().toISOString(),
    sessionId: session.id,
    summary: {
      user: {
        id: session.userId,
        email: session.userEmail,
        authenticated: !!session.userId
      },
      session: {
        startTime: session.sessionStartTime,
        endTime: session.sessionEndTime,
        duration: session.sessionEndTime
          ? Math.round(
            (new Date(session.sessionEndTime).getTime() -
              new Date(session.sessionStartTime).getTime()) /
            1000
          )
          : 0,
        userAgent: session.userAgent,
        initialRoute: session.initialRoute
      },
      statistics: {
        totalActions: actionLogs.length,
        totalErrors: errorLogs.length,
        totalApiCalls: apiLogs.length,
        errorRate: errorLogs.length > 0 ? ((errorLogs.length / timeline.length) * 100).toFixed(2) : 0
      }
    },
    errors: errorLogs,
    timeline,
    apiCalls: apiLogs,
    actions: actionLogs,
    reproduction: {
      stepsToReproduce,
      expectedBehavior: 'Application should function without errors',
      actualBehavior: errorLogs.length > 0
        ? `Encountered ${errorLogs.length} error(s) during session`
        : 'Session completed successfully',
      likelyRootCause: rootCause,
      affectedComponents: [...new Set(errorLogs.map(e => e.componentName).filter(Boolean))],
      affectedEndpoints: [...new Set(apiLogs.map(e => e.apiEndpoint).filter(Boolean))]
    },
    systemInfo: {
      frontend: {
        nextjs: process.env.NEXT_PUBLIC_VERSION || 'unknown',
        react: '18.2.0'
      },
      backend: {
        fastify: '4.28.1',
        node: process.version
      },
      database: 'PostgreSQL'
    }
  };
}

/**
 * Extract likely root cause from timeline
 */
function extractRootCause(timeline: any[]): string {
  const errors = timeline.filter(e => e.type === 'error');
  const apiErrors = timeline.filter(e => e.type === 'api' && e.responseStatus >= 400);

  if (!errors.length && !apiErrors.length) {
    return 'No errors detected';
  }

  if (apiErrors.length > errors.length) {
    const firstApiError = apiErrors[0];
    if (firstApiError.responseStatus >= 500) {
      return 'Backend server error (500+) - Check backend logs';
    } else if (firstApiError.responseStatus === 404) {
      return 'Resource not found (404) - Check if resource exists or URL is correct';
    } else if (firstApiError.responseStatus === 401 || firstApiError.responseStatus === 403) {
      return 'Authentication/Authorization error - Check user permissions or token expiration';
    }
  }

  const firstError = errors[0];
  if (firstError.errorType === 'frontend') {
    return 'Frontend React error - Check component rendering or state management';
  } else if (firstError.errorType === 'validation') {
    return 'Validation error - Check input data format or schema';
  }

  return 'See error details in timeline for more information';
}

export default setupDebugRoutes;
