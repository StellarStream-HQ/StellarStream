import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Data snapshot for before/after comparison
 */
export interface DataSnapshot {
  [key: string]: unknown;
}

/**
 * Audit log entry to be recorded
 */
export interface AuditLogEntry {
  userId?: string;
  userEmail?: string;
  beforeSnapshot?: DataSnapshot;
  afterSnapshot?: DataSnapshot;
  changesSummary?: string;
}

/**
 * Extend Express Request to include audit context
 */
declare global {
  namespace Express {
    interface Request {
      auditLog?: {
        entryId: string;
        userId?: string;
        userEmail?: string;
        beforeSnapshot?: DataSnapshot;
        afterSnapshot?: DataSnapshot;
        changesSummary?: string;
      };
    }
  }
}

/**
 * Get client IP from request, checking X-Forwarded-For, X-Real-IP, etc.
 */
function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp.trim();
  }
  return req.socket?.remoteAddress;
}

/**
 * Sanitize sensitive data from request/response bodies
 */
function sanitizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  const obj = data as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const sensitiveFields = [
    'password', 'pin', 'secret', 'apiKey', 'token', 'privateKey',
    'seedPhrase', 'mnemonic', 'ssn', 'creditCard', 'cardNumber'
  ];

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Truncate large JSON strings to avoid database bloat
 */
function truncateJsonString(data: unknown, maxSize: number = 5000): string {
  const json = JSON.stringify(sanitizeData(data));
  if (json.length > maxSize) {
    return json.substring(0, maxSize) + `... [truncated ${json.length - maxSize} chars]`;
  }
  return json;
}

/**
 * Main audit log middleware - captures request/response details
 * Should be placed EARLY in middleware chain (after body parsing)
 */
export function auditLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = performance.now();
  const entryId = uuidv4();

  // Initialize audit context
  req.auditLog = { entryId };

  // Capture original response methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  let responseBody: unknown = null;
  let responseStarted = false;

  // Override res.json
  res.json = function (data: unknown) {
    responseBody = data;
    return originalJson(data);
  };

  // Override res.send
  res.send = function (data: unknown) {
    responseBody = data;
    return originalSend(data);
  };

  // Capture response finishing
  res.on('finish', async () => {
    if (responseStarted) return;
    responseStarted = true;

    const executionTimeMs = performance.now() - startTime;

    try {
      const logEntry = {
        id: entryId,
        timestamp: new Date(),
        userId: req.auditLog?.userId,
        userEmail: req.auditLog?.userEmail,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        executionTimeMs,
        clientIp: getClientIp(req),
        userAgent: req.headers['user-agent'],
        requestBody:
          ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body
            ? truncateJsonString(req.body)
            : null,
        responseBody:
          [200, 201, 400, 409].includes(res.statusCode) && responseBody
            ? truncateJsonString(responseBody)
            : null,
        beforeSnapshot: req.auditLog?.beforeSnapshot
          ? truncateJsonString(req.auditLog.beforeSnapshot)
          : null,
        afterSnapshot: req.auditLog?.afterSnapshot
          ? truncateJsonString(req.auditLog.afterSnapshot)
          : null,
        changesSummary: req.auditLog?.changesSummary,
        error: res.statusCode >= 400 ? truncateJsonString(responseBody) : null,
        createdAt: new Date(),
      };

      // Log to database (non-blocking)
      await prisma.adminAuditLog.create({
        data: logEntry,
      });

      logger.debug('Audit log recorded', {
        entryId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        executionTimeMs,
      });
    } catch (error) {
      // Fail gracefully - don't block the response
      logger.error('Failed to record audit log', error, { entryId });
    }
  });

  next();
}

/**
 * Helper function to set audit context on request
 * Call this in your route handlers to record user info and data changes
 */
export function setAuditContext(
  req: Request,
  context: Partial<AuditLogEntry>
): void {
  if (!req.auditLog) {
    req.auditLog = { entryId: uuidv4() };
  }

  Object.assign(req.auditLog, context);
}

/**
 * Cleanup function to be called in res.on('finish')
 * This ensures all audit data is recorded
 */
export async function recordAuditLog(
  entryId: string,
  logData: {
    userId?: string;
    userEmail?: string;
    method: string;
    path: string;
    statusCode: number;
    executionTimeMs: number;
    clientIp?: string;
    userAgent?: string;
    beforeSnapshot?: DataSnapshot;
    afterSnapshot?: DataSnapshot;
    changesSummary?: string;
    error?: string;
  }
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        id: entryId,
        ...logData,
        timestamp: new Date(),
        createdAt: new Date(),
      },
    });
  } catch (error) {
    logger.error('Failed to record audit log', error, { entryId });
  }
}
