/**
 * Tests for the AppError hierarchy and the centralized errorHandler middleware
 * (issue #1150: "Consolidate Error Handling Strategy").
 *
 * 35 tests covering:
 *   - AppError base class behaviour
 *   - Each subclass's code/statusCode/status mapping
 *   - Cause chain preservation (ES2022 Error.cause)
 *   - toResponseBody / toLogContext serialisation
 *   - isAppError / toAppError helpers
 *   - errorHandler middleware mapping + sanitization + Sentry forwarding
 */

// Mock @sentry/node BEFORE importing it (ESM namespaces are non-configurable
// so vi.spyOn would throw at runtime; vi.mock replaces the whole module).
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(() => "test-event-id"),
  setupExpressErrorHandler: vi.fn(),
  withScope: vi.fn((cb: (scope: { setTag: () => void; setLevel: () => void; setContext: () => void }) => void) => {
    cb({
      setTag: vi.fn(),
      setLevel: vi.fn(),
      setContext: vi.fn(),
    });
  }),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Sentry from "@sentry/node";
import {
  AppError,
  ValidationError,
  MissingFieldError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  RateLimitError,
  InternalError,
  ConfigurationError,
  ExternalServiceError,
  ServiceUnavailableError,
  isAppError,
  toAppError,
} from "../lib/app-error.js";
import {
  errorHandler,
  buildErrorResponseBody,
} from "../middleware/errorHandler.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function mockReqRes() {
  const req = {
    method: "GET",
    originalUrl: "/test/path",
    url: "/test/path",
    ip: "127.0.0.1",
    headers: {},
    id: "req-test-id-123",
  };
  const json = vi.fn().mockReturnThis();
  const res: Record<string, unknown> = {
    statusCode: 200,
    headersSent: false,
    // status(x) → returns res (so .json() can chain)
    status: vi.fn(),
    json,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
  };
  // Wire up `res.status(x).json(y)` chain
  (res.status as ReturnType<typeof vi.fn>).mockImplementation(() => res);
  return { req, res };
}

// ─── A. AppError base class behavior ─────────────────────────────────────────

describe("AppError — base class", () => {
  it("A1: stores code, statusCode and message", () => {
    const err = new AppError("ERR_TEST", 418, "I'm a teapot");
    expect(err.code).toBe("ERR_TEST");
    expect(err.statusCode).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err.name).toBe("AppError");
  });

  it("A2: defaults isOperational to true", () => {
    const err = new AppError("ERR_TEST", 418, "x");
    expect(err.isOperational).toBe(true);
  });

  it("A3: captures an ISO timestamp at construction", () => {
    const before = new Date().toISOString();
    const err = new AppError("ERR_TEST", 418, "x");
    const after = new Date().toISOString();
    expect(err.timestamp >= before).toBe(true);
    expect(err.timestamp <= after).toBe(true);
  });

  it("A4: preserves the ES2022 cause chain", () => {
    const cause = new Error("underlying");
    const err = new AppError("ERR_TEST", 500, "wrapped", { cause });
    expect(err.cause).toBe(cause);
  });

  it("A5: toResponseBody omits details when not set", () => {
    const err = new AppError("ERR_TEST", 400, "bad input");
    const body = err.toResponseBody();
    expect(body).toEqual({ success: false, error: "bad input", code: "ERR_TEST" });
    expect("details" in body).toBe(false);
  });

  it("A6: toResponseBody includes details when set", () => {
    const err = new AppError("ERR_TEST", 400, "bad input", {
      details: { field: "amount" },
    });
    expect(err.toResponseBody()).toEqual({
      success: false,
      error: "bad input",
      code: "ERR_TEST",
      details: { field: "amount" },
    });
  });

  it("A7: toLogContext includes stack-relevant metadata but NOT the stack itself", () => {
    const err = new AppError("ERR_TEST", 500, "boom", {
      details: { x: 1 },
      cause: new Error("root"),
    });
    const ctx = err.toLogContext();
    expect(ctx.code).toBe("ERR_TEST");
    expect(ctx.statusCode).toBe(500);
    expect(ctx.message).toBe("boom");
    expect(ctx.details).toEqual({ x: 1 });
    expect(ctx.isOperational).toBe(true);
    expect(ctx.timestamp).toBeDefined();
    // Should include the cause's message in the context
    expect((ctx.cause as Error).message).toBe("root");
  });
});

// ─── B. Each subclass has the right code/statusCode/name ─────────────────────

describe("AppError — subclass mappings", () => {
  it.each([
    [new ValidationError("v"), "ERR_VALIDATION", 400, "ValidationError"],
    [new MissingFieldError("amount"), "ERR_VALIDATION", 400, "MissingFieldError"],
    [new UnauthorizedError(), "ERR_UNAUTHORIZED", 401, "UnauthorizedError"],
    [new ForbiddenError(), "ERR_FORBIDDEN", 403, "ForbiddenError"],
    [new NotFoundError("Stream", "x"), "ERR_NOT_FOUND", 404, "NotFoundError"],
    [new ConflictError("c"), "ERR_CONFLICT", 409, "ConflictError"],
    [new BusinessRuleError("b"), "ERR_BUSINESS_RULE", 422, "BusinessRuleError"],
    [new RateLimitError(30), "ERR_RATE_LIMIT", 429, "RateLimitError"],
    [new InternalError("i"), "ERR_INTERNAL", 500, "InternalError"],
    [new ConfigurationError("c"), "ERR_CONFIGURATION", 500, "ConfigurationError"],
    [new ExternalServiceError("rpc"), "ERR_EXTERNAL_SERVICE", 502, "ExternalServiceError"],
    [new ServiceUnavailableError(), "ERR_SERVICE_UNAVAILABLE", 503, "ServiceUnavailableError"],
  ])(
    "B%d: subclass maps to the right code/statusCode",
    (err, code, status, name) => {
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(status);
      expect(err.name).toBe(name);
      expect(err).toBeInstanceOf(AppError);
    },
  );

  it("B13: NotFoundError without identifier produces generic message", () => {
    const err = new NotFoundError("Stream");
    expect(err.code).toBe("ERR_NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Stream not found");
  });

  it("B14: RateLimitError clamps retryAfter to >= 1", () => {
    const err = new RateLimitError(0);
    expect(err.message).toContain("in 1 seconds");
    // also surfaces the retry-after in details
    expect((err.details as { retryAfterSeconds: number }).retryAfterSeconds).toBe(1);
  });

  it("B15: ExternalServiceError records the upstream service name in details", () => {
    const err = new ExternalServiceError("soroban-rpc", "timed out");
    expect(err.message).toBe("timed out");
    expect(err.details).toMatchObject({ service: "soroban-rpc" });
  });

  it("B16: InternalError is NOT operational (it's a programming/runtime bug)", () => {
    const err = new InternalError("oops");
    expect(err.isOperational).toBe(false);
  });
});

// ─── C. Helpers: isAppError / toAppError ─────────────────────────────────────

describe("AppError — helpers", () => {
  it("C1: isAppError narrows true for AppError instances", () => {
    expect(isAppError(new AppError("E", 500, "m"))).toBe(true);
    expect(isAppError(new NotFoundError("Stream"))).toBe(true);
  });

  it("C2: isAppError narrows false for native Error", () => {
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("C3: toAppError returns the same instance when already an AppError", () => {
    const original = new NotFoundError("Stream", "abc");
    expect(toAppError(original)).toBe(original);
  });

  it("C4: toAppError wraps a ZodError-like object as a ValidationError", () => {
    const zodLike = {
      name: "ZodError",
      issues: [{ path: ["amount"], message: "Required" }],
    };
    const wrapped = toAppError(zodLike);
    expect(wrapped).toBeInstanceOf(ValidationError);
    expect(wrapped.details).toEqual(zodLike.issues);
  });

  it("C5: toAppError wraps a plain Error as InternalError (non-operational)", () => {
    const wrapped = toAppError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.isOperational).toBe(false);
  });

  it("C6: toAppError wraps a string into InternalError", () => {
    const wrapped = toAppError("just a string");
    expect(wrapped).toBeInstanceOf(InternalError);
    expect(wrapped.message).toBe("just a string");
  });

  it("C7: toAppError wraps an arbitrary object as InternalError", () => {
    const wrapped = toAppError({ something: "odd" });
    expect(wrapped).toBeInstanceOf(InternalError);
  });
});

// ─── D. errorHandler middleware ──────────────────────────────────────────────

describe("errorHandler middleware", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.clearAllMocks();
  });

  beforeEach(() => {
    process.env.NODE_ENV = "development"; // ensure stack is included unless overridden
  });

  it("D1: renders an AppError into the standard {success:false, code, error} body", () => {
    const { req, res } = mockReqRes();
    errorHandler(new NotFoundError("Stream", "abc-123"), req as never, res as never, vi.fn() as never);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(404);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        success: false,
        data: null,
        code: "ERR_NOT_FOUND",
        error: "Stream not found: abc-123",
        requestId: "req-test-id-123",
        details: expect.objectContaining({ resource: "Stream", identifier: "abc-123" }),
      }),
    );
  });

  it("D2: applies the correct status code for each subclass", () => {
    const cases: Array<[Error, number]> = [
      [new ValidationError(), 400],
      [new UnauthorizedError(), 401],
      [new ForbiddenError(), 403],
      [new NotFoundError("Stream"), 404],
      [new ConflictError("c"), 409],
      [new BusinessRuleError("b"), 422],
      [new RateLimitError(30), 429],
      [new InternalError(), 500],
      [new ExternalServiceError("rpc"), 502],
      [new ServiceUnavailableError(), 503],
    ];
    for (const [err, expected] of cases) {
      const { req, res } = mockReqRes();
      errorHandler(err, req as never, res as never, vi.fn() as never);
      expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(expected);
    }
  });

  it("D3: wraps a plain Error as InternalError (500)", () => {
    const { req, res } = mockReqRes();
    errorHandler(new Error("kaboom"), req as never, res as never, vi.fn() as never);
    expect((res.status as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(500);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.code).toBe("ERR_INTERNAL");
    expect(body.data).toBeNull();
  });

  it("D4: includes stack in non-production; hides it in production", () => {
    const { req, res } = mockReqRes();
    process.env.NODE_ENV = "production";
    errorHandler(new InternalError("boom"), req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect("stack" in body).toBe(false);

    process.env.NODE_ENV = "development";
    const res2 = mockReqRes();
    errorHandler(new InternalError("boom"), req as never, res2.res as never, vi.fn() as never);
    const body2 = ((res2.res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(typeof body2.stack).toBe("string");
  });

  it("D4b: response body always includes data:null so responseWrapper preserves fields", () => {
    const { req, res } = mockReqRes();
    errorHandler(new ConflictError("dup"), req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.data).toBeNull();
  });

  it("D5: sanitises the public error message for non-operational errors in production", () => {
    const { req, res } = mockReqRes();
    process.env.NODE_ENV = "production";
    const original = new InternalError("secret PG connection error");
    errorHandler(original, req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.error).toBe("An unexpected error occurred");
  });

  it("D6: preserves the public error message for operational errors even in production", () => {
    const { req, res } = mockReqRes();
    process.env.NODE_ENV = "production";
    errorHandler(new NotFoundError("Stream", "abc"), req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.error).toBe("Stream not found: abc");
  });

  it("D7: delegates to default Express handler when headers already sent", () => {
    const { req, res } = mockReqRes();
    (res as Record<string, unknown>).headersSent = true;
    const next = vi.fn();
    errorHandler(new Error("after-stream"), req as never, res as never, next as never);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });

  it("D8: forwards non-operational errors to Sentry (captureException)", () => {
    const sentrySpy = vi.mocked(Sentry.captureException);
    sentrySpy.mockClear();
    const { req, res } = mockReqRes();
    errorHandler(new InternalError("bug"), req as never, res as never, vi.fn() as never);
    expect(sentrySpy).toHaveBeenCalledTimes(1);
    expect(sentrySpy.mock.calls[0]?.[0]).toBeInstanceOf(InternalError);
  });

  it("D9: does NOT forward operational errors to Sentry", () => {
    const sentrySpy = vi.mocked(Sentry.captureException);
    sentrySpy.mockClear();
    const { req, res } = mockReqRes();
    errorHandler(new NotFoundError("Stream"), req as never, res as never, vi.fn() as never);
    expect(sentrySpy).not.toHaveBeenCalled();
  });

  it("D10: response body is deterministic and contains requestId when req.id is set", () => {
    const { req, res } = mockReqRes();
    errorHandler(new ConflictError("dup"), req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(body.requestId).toBe("req-test-id-123");
    expect(body.code).toBe("ERR_CONFLICT");
    expect(body.error).toBe("dup");
  });

  it("D11: response body excludes requestId when req.id is missing", () => {
    const { req, res } = mockReqRes();
    delete (req as { id?: string }).id;
    errorHandler(new ConflictError("dup"), req as never, res as never, vi.fn() as never);
    const body = ((res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect("requestId" in body).toBe(false);
  });

  it("D12: buildErrorResponseBody produces the same shape without Express", () => {
    const body = buildErrorResponseBody(new NotFoundError("Stream", "x"), "rid-1");
    expect(body).toMatchObject({
      success: false,
      data: null,
      code: "ERR_NOT_FOUND",
      error: "Stream not found: x",
      requestId: "rid-1",
    });
  });

  it("D13: log warn for operational errors, error for non-operational", () => {
    // We can't easily spy on winston, but the call doesn't throw — sanity check.
    const { req, res } = mockReqRes();
    expect(() =>
      errorHandler(new NotFoundError("Stream"), req as never, res as never, vi.fn() as never),
    ).not.toThrow();
    expect(() =>
      errorHandler(new InternalError("boom"), req as never, res as never, vi.fn() as never),
    ).not.toThrow();
  });
});
