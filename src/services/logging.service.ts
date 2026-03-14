/**
 * Logging Service - Centralized logging for all backend operations
 * Purpose: Handle action, error, and API call logging with automatic data sanitization
 * Checkpoint 2: Backend Logging Infrastructure
 */

import { PrismaClient } from '@prisma/client';
import pino from 'pino';

const prisma = new PrismaClient();
const logger = pino();

// Configuration from environment
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const LOGGING_ENABLED = process.env.LOGGING_ENABLED !== 'false';

// Sensitive fields to redact
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'refreshToken',
  'authorization',
  'apiKey',
  'secret',
  'passwd'
];

class LoggingService {
  isEnabled: boolean;

  constructor() {
    this.isEnabled = LOGGING_ENABLED && process.env.NODE_ENV !== 'test';
  }

  /**
   * Redact sensitive data from objects
   */
  redactSensitiveData(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveData(item));
    }

    const redacted = { ...obj };
    for (const key in redacted) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactSensitiveData(redacted[key]);
      }
    }
    return redacted;
  }

  /**
   * Truncate large objects
   */
  truncateObject(obj, maxSize = 10240) {
    if (!obj) return obj;
    const str = JSON.stringify(obj);
    if (str.length > maxSize) {
      return {
        ...JSON.parse(str.substring(0, maxSize)),
        '[TRUNCATED]': `Object truncated from ${str.length} bytes`
      };
    }
    return obj;
  }

  /**
   * Create a new debug session
   */
  async createDebugSession(data) {
    if (!this.isEnabled) return { id: 'disabled' };

    try {
      const session = await prisma.debugSession.create({
        data: {
          userId: data.userId,
          userEmail: data.userEmail,
          initialRoute: data.initialRoute || '/',
          userAgent: data.userAgent?.substring(0, 500),
          ipAddress: data.ipAddress,
          hasErrors: false
        }
      });

      logger.debug({ sessionId: session.id }, 'Debug session created');
      return session;
    } catch (error) {
      logger.error({ error }, 'Failed to create debug session');
      return null;
    }
  }

  /**
   * End a debug session
   */
  async endDebugSession(sessionId) {
    if (!this.isEnabled || !sessionId || sessionId === 'disabled') return;

    try {
      const session = await prisma.debugSession.update({
        where: { id: sessionId },
        data: {
          sessionEndTime: new Date()
        }
      });

      logger.debug({ sessionId }, 'Debug session ended');
      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to end debug session');
    }
  }

  /**
   * Log a user action
   */
  async logAction(data) {
    if (!this.isEnabled) return;

    try {
      const action = await prisma.actionLog.create({
        data: {
          sessionId: data.sessionId,
          userId: data.userId,
          userEmail: data.userEmail,
          actionType: data.actionType,
          actionName: data.actionName,
          componentName: data.componentName,
          currentRoute: data.currentRoute,
          metadata: this.truncateObject(
            this.redactSensitiveData(data.metadata)
          ),
          userAgent: data.userAgent?.substring(0, 500),
          timestamp: new Date()
        }
      });

      logger.debug(
        { actionId: action.id, actionType: data.actionType },
        'Action logged'
      );
      return action;
    } catch (error) {
      logger.error({ error, data }, 'Failed to log action');
    }
  }

  /**
   * Log an error
   */
  async logError(data) {
    if (!this.isEnabled) return;

    try {
      // Auto-determine severity if not provided
      let severity = data.severity || 'medium';
      if (!severity && data.errorCode) {
        if (data.errorCode >= 500) severity = 'high';
        else if (data.errorCode >= 400) severity = 'medium';
        else severity = 'low';
      }

      const error = await prisma.errorLog.create({
        data: {
          sessionId: data.sessionId,
          userId: data.userId,
          userEmail: data.userEmail,
          errorType: data.errorType || 'backend',
          errorMessage: data.errorMessage?.substring(0, 5000),
          errorStackTrace: data.errorStackTrace?.substring(0, 10000),
          errorCode: data.errorCode,
          severity,
          componentName: data.componentName,
          currentRoute: data.currentRoute,
          contextData: this.truncateObject(
            this.redactSensitiveData(data.contextData)
          ),
          timestamp: new Date()
        }
      });

      // Update session to mark it has errors
      if (data.sessionId && data.sessionId !== 'disabled') {
        await prisma.debugSession.update({
          where: { id: data.sessionId },
          data: { hasErrors: true }
        }).catch(err => logger.error({ err }, 'Failed to update session errors flag'));
      }

      logger.error(
        { errorId: error.id, errorType: data.errorType, severity },
        `Error logged: ${data.errorMessage}`
      );
      return error;
    } catch (error) {
      logger.error({ error, data }, 'Failed to log error');
    }
  }

  /**
   * Log an API call
   */
  async logApiCall(data) {
    if (!this.isEnabled) return;

    try {
      const apiLog = await prisma.apiLog.create({
        data: {
          sessionId: data.sessionId,
          userId: data.userId,
          httpMethod: data.httpMethod,
          apiEndpoint: data.apiEndpoint,
          requestHeaders: this.truncateObject(
            this.redactSensitiveData(data.requestHeaders)
          ),
          requestBody: this.truncateObject(
            this.redactSensitiveData(data.requestBody)
          ),
          responseStatus: data.responseStatus,
          responseBody: this.truncateObject(
            this.redactSensitiveData(data.responseBody)
          ),
          responseTimeMs: data.responseTimeMs || 0,
          errorMessage: data.errorMessage?.substring(0, 5000),
          timestamp: new Date()
        }
      });

      // Log error if status is 400 or higher
      if (data.responseStatus >= 400) {
        await this.logError({
          sessionId: data.sessionId,
          userId: data.userId,
          userEmail: data.userEmail,
          errorType: 'api',
          errorMessage: `API Error: ${data.httpMethod} ${data.apiEndpoint} returned ${data.responseStatus}`,
          errorCode: data.responseStatus,
          severity: data.responseStatus >= 500 ? 'high' : 'medium',
          currentRoute: data.currentRoute,
          contextData: {
            endpoint: data.apiEndpoint,
            method: data.httpMethod,
            status: data.responseStatus,
            responseTime: data.responseTimeMs
          }
        }).catch(err => logger.error({ err }, 'Failed to log API error'));
      }

      logger.debug(
        {
          apiLogId: apiLog.id,
          method: data.httpMethod,
          endpoint: data.apiEndpoint,
          status: data.responseStatus,
          responseTime: data.responseTimeMs
        },
        'API call logged'
      );
      return apiLog;
    } catch (error) {
      logger.error({ error, data }, 'Failed to log API call');
    }
  }

  /**
   * Get complete session with all logs
   */
  async getSessionWithLogs(sessionId) {
    if (!this.isEnabled) return null;

    try {
      const session = await prisma.debugSession.findUnique({
        where: { id: sessionId },
        include: {
          actionLogs: {
            orderBy: { timestamp: 'asc' }
          },
          errorLogs: {
            orderBy: { timestamp: 'asc' }
          },
          apiLogs: {
            orderBy: { timestamp: 'asc' }
          }
        }
      });

      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to fetch session with logs');
      return null;
    }
  }

  /**
   * Get paginated list of sessions
   */
  async getSessionsList(filters: any = {}) {
    if (!this.isEnabled) return { sessions: [], total: 0 };

    try {
      const where: any = {};

      if ((filters as any).hasErrors) {
        where.hasErrors = true;
      }

      if ((filters as any).userId) {
        where.userId = (filters as any).userId;
      }

      if ((filters as any).userEmail) {
        where.userEmail = {
          contains: (filters as any).userEmail,
          mode: 'insensitive'
        };
      }

      if ((filters as any).exported !== undefined) {
        where.exported = (filters as any).exported;
      }

      if ((filters as any).startDate || (filters as any).endDate) {
        where.sessionStartTime = {};
        if ((filters as any).startDate) {
          where.sessionStartTime.gte = new Date((filters as any).startDate);
        }
        if ((filters as any).endDate) {
          where.sessionStartTime.lte = new Date((filters as any).endDate);
        }
      }

      const limit = Math.min((filters as any).limit || 20, 100);
      const offset = ((filters as any).offset || 0) || 0;

      const [sessions, total] = await Promise.all([
        prisma.debugSession.findMany({
          where,
          include: {
            _count: {
              select: {
                actionLogs: true,
                errorLogs: true,
                apiLogs: true
              }
            }
          },
          orderBy: { sessionStartTime: 'desc' },
          take: limit,
          skip: offset
        }),
        prisma.debugSession.count({ where })
      ]);

      return { sessions, total };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch sessions list');
      return { sessions: [], total: 0 };
    }
  }

  /**
   * Mark error as resolved
   */
  async resolveError(errorId, resolvedById, note) {
    if (!this.isEnabled) return null;

    try {
      const error = await prisma.errorLog.update({
        where: { id: errorId },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedById,
          resolvedNote: note
        }
      });

      logger.debug({ errorId }, 'Error marked as resolved');
      return error;
    } catch (error) {
      logger.error({ error, errorId }, 'Failed to resolve error');
      return null;
    }
  }

  /**
   * Clean up old logs
   */
  async cleanupOldLogs(days = LOG_RETENTION_DAYS) {
    if (!this.isEnabled) return { deleted: 0 };

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const [deletedActions, deletedErrors, deletedApis, deletedSessions] = await Promise.all([
        prisma.actionLog.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        }),
        prisma.errorLog.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        }),
        prisma.apiLog.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        }),
        prisma.debugSession.deleteMany({
          where: { createdAt: { lt: cutoffDate } }
        })
      ]);

      const total =
        deletedActions.count +
        deletedErrors.count +
        deletedApis.count +
        deletedSessions.count;

      logger.info(
        {
          actions: deletedActions.count,
          errors: deletedErrors.count,
          apis: deletedApis.count,
          sessions: deletedSessions.count,
          total
        },
        `Cleaned up logs older than ${days} days`
      );

      return { deleted: total };
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup old logs');
      return { deleted: 0 };
    }
  }

  /**
   * Get statistics
   */
  async getStats() {
    if (!this.isEnabled) {
      return {
        totalSessions: 0,
        totalErrors: 0,
        totalActions: 0,
        totalApiCalls: 0,
        sessionsWithErrors: 0,
        unresolvedErrors: 0
      };
    }

    try {
      const [
        totalSessions,
        totalErrors,
        totalActions,
        totalApiCalls,
        sessionsWithErrors,
        unresolvedErrors
      ] = await Promise.all([
        prisma.debugSession.count(),
        prisma.errorLog.count(),
        prisma.actionLog.count(),
        prisma.apiLog.count(),
        prisma.debugSession.count({ where: { hasErrors: true } }),
        prisma.errorLog.count({ where: { resolved: false } })
      ]);

      return {
        totalSessions,
        totalErrors,
        totalActions,
        totalApiCalls,
        sessionsWithErrors,
        unresolvedErrors
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get stats');
      return null;
    }
  }

  /**
   * Update session as exported
   */
  async updateSessionExported(sessionId: string) {
    if (!this.isEnabled) return null;

    try {
      const session = await prisma.debugSession.update({
        where: { id: sessionId },
        data: {
          exported: true,
          exportedAt: new Date()
        }
      });

      logger.debug({ sessionId }, 'Session marked as exported');
      return session;
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to mark session as exported');
      return null;
    }
  }
}

// Export singleton instance
export const loggingService = new LoggingService();

export default loggingService;
