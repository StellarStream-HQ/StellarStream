/**
 * requestId — tiny middleware that attaches a unique correlation id to each
 * incoming request so we can trace errors / logs across the stack.
 *
 * Honors the upstream `x-request-id` header when present (useful for
 * gateway-proxied environments) and echoes the chosen id back on the
 * response via `x-request-id` for client-side correlation.
 *
 * Security: the upstream id is filtered to printable ASCII excluding CR/LF
 * /TAB to prevent log-injection (an attacker could otherwise smuggle fake
 * log lines via a control-character-laden header). Anything else → fresh UUID.
 *
 * Without this, the error middleware has no per-request handle to include
 * in logs and the response body.
 */

import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

const HEADER = "x-request-id";

// Permissive enough for common id formats (UUID v4, ULID, KSUID, hex hash)
// but strict enough to keep CR/LF/TAB and other control characters out of
// structured logs and the response body.
const SAFE_HEADER_VALUE = /^[A-Za-z0-9._:\-]{1,128}$/;

function sanitize(value: unknown): string {
  if (typeof value !== "string") return randomUUID();
  const trimmed = value.trim();
  if (trimmed.length === 0 || !SAFE_HEADER_VALUE.test(trimmed)) {
    return randomUUID();
  }
  return trimmed;
}

export function requestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  req.id = sanitize(req.headers[HEADER]);
  res.setHeader(HEADER, req.id);
  next();
}
