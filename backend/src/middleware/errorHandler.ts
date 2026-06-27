/**
 * errorHandler — centralized Express error middleware for the backend.
 *
 * Responsibilities:
 *  1. Coerce any thrown value into an `AppError` (via `toAppError`)
 *     so downstream code never has to discriminate on raw `Error`.
 *  2. Render a stable API response that the existing `responseWrapper`
 *     middleware recognises (`success: false` AND a `data` key are
 *     required for the wrapper's passthrough / localisation branch):
 *
 *       {
 *         success: false,
 *         data:   null,
 *         error:  "<human-readable message (localized by responseWrapper)>",
 *         code:   "<stable machine code>",
 *         details?: <optional structured metadata>,
 *         requestId?: "<echo of req.id>",
 *         stack?: "<only in NODE_ENV !== 'production'>"
 *       }
 *
 *  3. Sanitize stack traces and raw error messages in production for
 *     non-operational errors (NEVER leak internal infrastructure details).
 *  4. Emit a single structured log line per error and forward non-operational
 *     errors to Sentry via the configured `@sentry/node` integration.
 *  5. Be safe when headers are already sent — delegate to the default
 *     Express handler so we can still close the connection.
 *
 * IMPORTANT ORDERING
 *   Register AFTER `requestId` middleware so every error log carries the
 *   request id. Register after all routes. Sentry's safety-net handler may
 *   also be registered AFTER ours — Sentry still receives the error via
 *   its `withScope` capture call below.
 */

import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";

import {
  AppError,
  InternalError,
  toAppError,
  isAppError,
} from "../lib/app-error.js";
import { logger } from "../logger.js";

/**
 * Public, JSON-shaped error body returned to clients.
 *
 * Carries `data: null` so `responseWrapper` recognises it as the standard
 * wrapped shape and forwards every field (including `stack` and `requestId`)
 * instead of dropping them in its generic-wrap branch.
 */
export interface ErrorResponseBody {
  success: false;
  data: null;
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
  stack?: string; // dev-only
}

/**
 * Express error middleware — register via `app.use(errorHandler)` AFTER
 * all routes. Called automatically with any error that escapes a route.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // ── Headers already sent → delegate to Express default handler ────────
  if (res.headersSent) {
    next(err);
    return;
  }

  const appErr = toAppError(err);
  // Evaluate per-call so tests that flip NODE_ENV at runtime behave
  // correctly (vs a captured-at-import-time constant).
  const isProduction = process.env.NODE_ENV === "production";

  // ── Logging ────────────────────────────────────────────────────────────
  logError(req, appErr);

  // ── Sentry ─────────────────────────────────────────────────────────────
  // Only forward genuinely unexpected errors. Operational errors (validation,
  // not found, etc.) are noise in Sentry — they are caller mistakes, not bugs.
  if (!appErr.isOperational || appErr instanceof InternalError) {
    captureToSentry(appErr, req);
  }

  // ── Response body ──────────────────────────────────────────────────────
  const body: ErrorResponseBody = {
    success: false,
    data: null,
    error: sanitizeMessage(appErr, isProduction),
    code: appErr.code,
    ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    ...(req.id ? { requestId: req.id } : {}),
    ...(isProduction ? {} : { stack: appErr.stack ?? new Error().stack }),
  };

  // Default status: from the error itself, falling back to 500.
  const status =
    appErr.statusCode && appErr.statusCode >= 400 && appErr.statusCode < 600
      ? appErr.statusCode
      : 500;

  res.status(status).json(body);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip internal-only details from the public-facing message in production
 * so we never leak stack traces, file paths, SQL fragments, or raw upstream
 * responses. Operational errors are safe to surface verbatim because they
 * were constructed by us with caller-friendly wording.
 */
function sanitizeMessage(err: AppError, isProduction: boolean): string {
  if (!isProduction) return err.message;
  if (err.isOperational) return err.message;
  return "An unexpected error occurred";
}

/**
 * Emit a structured log line via winston. Always include the request id
 * and the original method/path so incidents are easy to trace.
 */
function logError(req: Request, err: AppError): void {
  const ctx = err.toLogContext();
  const reqCtx = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl ?? req.url,
    ip: req.ip,
  };

  if (err.isOperational && !(err instanceof InternalError)) {
    // Operational 4xx — warn level, no stack spam.
    logger.warn(err.message, { ...ctx, ...reqCtx });
    return;
  }

  // Programming / 5xx — error level with full stack.
  const errorPayload = err.cause instanceof Error ? err.cause : err;
  logger.error(err.message, errorPayload, { ...ctx, ...reqCtx });
}

function captureToSentry(err: AppError, req: Request): void {
  try {
    Sentry.withScope((scope) => {
      if (req.id) scope.setTag("requestId", req.id);
      scope.setTag("errorCode", err.code);
      scope.setTag("errorName", err.name);
      scope.setLevel(err.statusCode >= 500 ? "error" : "warning");
      scope.setContext("appError", err.toLogContext());
      Sentry.captureException(err);
    });
  } catch {
    // Never let Sentry failures break the response.
  }
}

/**
 * Helper for non-Express callers (workers, schedulers) that want the same
 * sanitized body they'd see over HTTP.
 */
export function buildErrorResponseBody(
  err: unknown,
  requestId?: string,
): ErrorResponseBody {
  const isProduction = process.env.NODE_ENV === "production";
  const appErr = toAppError(err);
  return {
    success: false,
    data: null,
    error: sanitizeMessage(appErr, isProduction),
    code: appErr.code,
    ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    ...(requestId ? { requestId } : {}),
    ...(isProduction ? {} : { stack: appErr.stack }),
  };
}

/**
 * Generate a fresh request id. Exposed so workers / scripts (which don't go
 * through Express) can stamp their own correlation id on error reports.
 */
export function newRequestId(): string {
  return randomUUID();
}

// Re-export for callers that want to narrow on AppError.
export { isAppError };
