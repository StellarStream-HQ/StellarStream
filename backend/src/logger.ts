/**
 * Structured logging utility — Winston integration (#246)
 *
 * Drop-in replacement for the previous console-based logger.
 * Preserves the existing API: logger.debug / info / warn / error / event
 *
 * Transports:
 *   1. Console  — always active, colorized + timestamped (dev feedback)
 *   2. File     — activated in production or when LOG_TO_FILE=true
 *                 errors.log  (error level only, 10 MB × 5 rotations)
 *                 combined.log (all levels,     20 MB × 5 rotations)
 *
 * Env vars:
 *   LOG_LEVEL    — override log level (default: "info" in prod, "debug" in dev)
 *   LOG_TO_FILE  — set to "true" to enable file transport outside production
 *   LOG_DIR      — directory for log files (default: <cwd>/logs)
 */

import winston from "winston";
import path from "path";

// ─── Console format: colorized, human-readable ────────────────────────────────
const consoleFmt = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr =
      Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `[${timestamp}] [${level}] ${message}${metaStr}${stackStr}`;
  })
);

// ─── File format: clean JSON, no ANSI color codes ────────────────────────────
const fileFmt = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.uncolorize(),
  winston.format.json()
);

// ─── Build transport list ─────────────────────────────────────────────────────
const transports: winston.transport[] = [
  // Transport 1 — Console (always on)
  new winston.transports.Console({ format: consoleFmt }),
];

// Transport 2 — File (production or LOG_TO_FILE=true)
if (
  process.env.NODE_ENV === "production" ||
  process.env.LOG_TO_FILE === "true"
) {
  const LOG_DIR = process.env.LOG_DIR ?? path.join(process.cwd(), "logs");

  transports.push(
    // Error-only file
    new winston.transports.File({
      filename: path.join(LOG_DIR, "errors.log"),
      level:    "error",
      format:   fileFmt,
      maxsize:  10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
    // All levels combined
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      format:   fileFmt,
      maxsize:  20 * 1024 * 1024, // 20 MB
      maxFiles: 5,
    })
  );
}

// ─── Winston instance ─────────────────────────────────────────────────────────
const _winston = winston.createLogger({
  level:       process.env.LOG_LEVEL ??
               (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transports,
  exitOnError: false,
  silent:      process.env.NODE_ENV === "test",
});

// ─── Public logger — identical API to the original logger.ts ─────────────────
export const logger = {
  debug(message: string, meta?: unknown): void {
    _winston.debug(message, meta !== undefined ? { meta } : {});
  },

  info(message: string, meta?: unknown): void {
    _winston.info(message, meta !== undefined ? { meta } : {});
  },

  warn(message: string, meta?: unknown): void {
    _winston.warn(message, meta !== undefined ? { meta } : {});
  },

  /**
   * Mirrors original signature: error(message, error?, meta?)
   * Automatically extracts Error.message + Error.stack for structured output.
   */
  error(message: string, error?: unknown, meta?: unknown): void {
    const errorMeta =
      error instanceof Error
        ? {
            errorMessage: error.message,
            stack:        error.stack,
            ...(meta as object | undefined),
          }
        : { error, ...(meta as object | undefined) };

    _winston.error(message, errorMeta);
  },

  /**
   * Blockchain event helper — mirrors original logger.event()
   * Logs at INFO level with an EVENT: prefix so events are easily grep-able.
   */
  event(eventType: string, data: unknown): void {
    _winston.info(`EVENT: ${eventType}`, { data });
  },
};

// ─── Named export for direct Winston access (advanced use) ───────────────────
export default _winston;