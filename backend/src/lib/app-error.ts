/**
 * AppError — Centralized error hierarchy for the StellarStream backend.
 *
 * Goals:
 *  1. Single shape for operational errors thrown by services.
 *  2. Carry enough metadata (code, statusCode, details) for the error
 *     middleware to render a consistent API response.
 *  3. Distinguish *operational* errors (expected, e.g. validation failures)
 *     from *programming* errors (unexpected bugs) via the `isOperational`
 *     flag. Programming errors should crash the process loudly; operational
 *     errors should be reported to the caller cleanly.
 *  4. Preserve the cause chain via the standard `cause` option introduced
 *     in ES2022 so we never lose the original stack.
 *
 * Usage:
 *   - Services throw subclasses (`throw new NotFoundError(...)`).
 *   - Express route handlers let errors propagate; the error middleware
 *     (see `middleware/errorHandler.ts`) renders them into the standard
 *     `{ success, data, error, code, details }` response shape.
 *   - Background workers can `if (err instanceof AppError) ...` to decide
 *     whether to retry or abort.
 *
 * Conventions:
 *   - `code` is a stable, machine-readable string (upper_snake_case).
 *     Clients should branch on `code`, not on the localized message.
 *   - `statusCode` is the HTTP status the API will return.
 *   - `details` is optional structured metadata (e.g. zod issues, field
 *     violations). It is not localized.
 */

// ─── Base ────────────────────────────────────────────────────────────────────

export interface AppErrorOptions {
  /** Optional machine-readable details (zod issues, field errors, etc.) */
  details?: unknown;
  /** ES2022 cause — the underlying error this wraps, if any */
  cause?: unknown;
  /** Mark as a programming (non-operational) error. Default: true */
  isOperational?: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown;
  public readonly isOperational: boolean;
  /** ISO-8601 timestamp captured at construction time for logs/audit. */
  public readonly timestamp: string;

  constructor(
    code: string,
    statusCode: number,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target?.name ?? "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    this.timestamp = new Date().toISOString();

    // Restore prototype chain when targeting older Node transpilers.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serialise to the public response body (no stack, no cause). */
  toResponseBody(fallbackMessage = "An unexpected error occurred"): {
    success: false;
    error: string;
    code: string;
    details?: unknown;
  } {
    return {
      success: false,
      error: this.message || fallbackMessage,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }

  /** Serialise for internal logs — includes stack, cause and context. */
  toLogContext(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      statusCode: this.statusCode,
      message: this.message,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      details: this.details,
      cause: this.cause,
    };
  }
}

// ─── 4xx: Client errors ──────────────────────────────────────────────────────

/** 400 Bad Request — generic input validation failure. */
export class ValidationError extends AppError {
  constructor(
    message = "Request validation failed",
    options: AppErrorOptions = {},
  ) {
    super("ERR_VALIDATION", 400, message, options);
  }
}

/** 400 Bad Request — a required resource field is missing. */
export class MissingFieldError extends ValidationError {
  constructor(field: string, options: AppErrorOptions = {}) {
    super(`Missing required field: ${field}`, {
      ...options,
      details: { field, ...(toDetailsObject(options.details) ?? {}) },
    });
  }
}

/** 401 Unauthorized — caller is not authenticated. */
export class UnauthorizedError extends AppError {
  constructor(
    message = "Authentication required",
    options: AppErrorOptions = {},
  ) {
    super("ERR_UNAUTHORIZED", 401, message, options);
  }
}

/** 403 Forbidden — caller is authenticated but not permitted. */
export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action",
    options: AppErrorOptions = {},
  ) {
    super("ERR_FORBIDDEN", 403, message, options);
  }
}

/** 404 Not Found — the requested resource does not exist. */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    identifier?: string,
    options: AppErrorOptions = {},
  ) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(
      "ERR_NOT_FOUND",
      404,
      message,
      identifier !== undefined
        ? { ...options, details: { resource, identifier, ...(toDetailsObject(options.details) ?? {}) } }
        : options,
    );
  }
}

/** 409 Conflict — the request conflicts with current resource state. */
export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("ERR_CONFLICT", 409, message, options);
  }
}

/** 422 Unprocessable Entity — input is well-formed but violates a business rule. */
export class BusinessRuleError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("ERR_BUSINESS_RULE", 422, message, options);
  }
}

/** 429 Too Many Requests — caller exceeded rate limit. */
export class RateLimitError extends AppError {
  constructor(
    retryAfterSeconds: number,
    options: AppErrorOptions = {},
  ) {
    // Clamp sub-second retries to 1 (a "in 0 seconds" response is counter-
    // intuitive and rejected by some HTTP clients). The clamped value is
    // mirrored in the human-readable message AND in machine-readable details
    // so callers always see consistent numbers.
    const clamped = Math.max(1, retryAfterSeconds);
    super(
      "ERR_RATE_LIMIT",
      429,
      `Rate limit exceeded. Try again in ${clamped} seconds.`,
      {
        ...options,
        details: {
          retryAfterSeconds: clamped,
          ...(toDetailsObject(options.details) ?? {}),
        },
      },
    );
  }
}

// ─── 5xx: Server errors ──────────────────────────────────────────────────────

/** 500 Internal Server Error — unexpected programming or runtime error. */
export class InternalError extends AppError {
  constructor(
    message = "An unexpected error occurred",
    options: AppErrorOptions = {},
  ) {
    // Mark explicitly non-operational so middleware can decide to crash.
    super("ERR_INTERNAL", 500, message, { ...options, isOperational: false });
  }
}

/** 500 — service is misconfigured (missing env, bad contract id, etc). */
export class ConfigurationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("ERR_CONFIGURATION", 500, message, options);
  }
}

/** 502 Bad Gateway — upstream dependency (RPC, Horizon, etc) failed. */
export class ExternalServiceError extends AppError {
  constructor(
    service: string,
    message?: string,
    options: AppErrorOptions = {},
  ) {
    const finalMessage = message ?? `Upstream service ${service} failed`;
    super(
      "ERR_EXTERNAL_SERVICE",
      502,
      finalMessage,
      { ...options, details: { service, ...(toDetailsObject(options.details) ?? {}) } },
    );
  }
}

/** 503 Service Unavailable — circuit-breaker / dependency down. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable", options: AppErrorOptions = {}) {
    super("ERR_SERVICE_UNAVAILABLE", 503, message, options);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Typed guard: returns true when an unknown error is one of our AppErrors.
 * Useful for `catch (err)` blocks that want to inspect/branch on error type.
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Coerce an unknown thrown value into an AppError instance. If it already
 * is an AppError, returns it unchanged. If it is a ZodError, wraps it as a
 * ValidationError with the issues attached. Otherwise wraps as an
 * InternalError (programmer error) so the middleware never sees a bare Error.
 */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (isZodError(err)) {
    const flat = (err as { issues: unknown }).issues;
    return new ValidationError("Request validation failed", { details: flat, cause: err });
  }

  if (err instanceof Error) {
    return new InternalError(err.message, { cause: err });
  }

  return new InternalError(typeof err === "string" ? err : "Unknown error", {
    cause: err,
  });
}

/**
 * Narrow helper used by MissingFieldError / NotFoundError / etc to merge
 * arbitrary user-supplied details with the fields those classes add.
 */
function toDetailsObject(details: unknown): Record<string, unknown> | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === "object" && !Array.isArray(details)) {
    return details as Record<string, unknown>;
  }
  return { value: details };
}

/**
 * Structural check for ZodError without importing zod directly here
 * (so this module remains leaf-level and avoids type-only coupling).
 */
function isZodError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { name?: string; issues?: unknown };
  return (
    candidate.name === "ZodError" && Array.isArray(candidate.issues)
  );
}

// ─── Public re-exports ───────────────────────────────────────────────────────

export {
  AppError as default,
};
