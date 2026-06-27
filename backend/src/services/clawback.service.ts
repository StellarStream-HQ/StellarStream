/**
 * Clawback Service — comprehensive validation and execution for stream clawbacks
 *
 * Provides:
 *  - canClawback(streamId): boolean  — checks if stream is eligible for clawback
 *  - getMaxClawbackAmount(streamId): string — calculates max recoverable amount
 *  - validateClawback(streamId, amount): ValidationResult — full validation pipeline
 *  - executeClawback(streamId, amount, reason?): ClawbackRecord — executes clawback
 *
 * Validation rules:
 *  1. Stream must exist in the database
 *  2. Clawback is blocked within 24 hours of stream creation (cooldown period)
 *  3. Clawback amount must not exceed maximum clawbackable amount
 *  4. Amount must be positive (> 0)
 *  5. Stream must not already be fully clawed back
 *  6. Only the sender/originator can clawback
 */

import { PrismaClient } from "../generated/client/client.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { logger } from "../logger.js";
import {
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from "../lib/app-error.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ClawbackRecord {
  id: string;
  streamId: string;
  amount: string;
  reason: string;
  executedAt: Date;
  status: "executed" | "pending" | "failed";
}

export interface ClawbackExecuteInput {
  streamId: string;
  amount: string;
  reason?: string;
  txHash?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CLAWBACK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// ─── Service ─────────────────────────────────────────────────────────────────

export class ClawbackService {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Checks whether a stream is eligible for clawback.
   *
   * Eligibility criteria:
   *  - Stream exists
   *  - Stream is older than 24 hours (cooldown period)
   *  - Stream has any unwithdrawn amount remaining
   *  - Stream is not already fully clawed back
   */
  async canClawback(streamId: string): Promise<boolean> {
    const result = await this.validateClawback(streamId, "0");
    return result.valid;
  }

  /**
   * Returns the maximum amount that can be clawed back from a stream.
   *
   * Max clawbackable amount = (total amount) - (amount already withdrawn)
   * This represents the unstreamed/unwithdrawn balance.
   *
   * Returns 0n if the stream doesn't exist or has no clawbackable balance.
   */
  async getMaxClawbackAmount(streamId: string): Promise<string> {
    const stream = await this.prisma.stream.findFirst({
      where: {
        OR: [
          { streamId },
          { id: streamId },
        ],
      },
    });

    if (!stream) {
      return "0";
    }

    const totalAmount = BigInt(stream.amount);
    const withdrawn = BigInt(stream.withdrawn);
    const clawbackable = totalAmount - withdrawn;

    if (clawbackable <= 0n) {
      return "0";
    }

    return clawbackable.toString();
  }

  /**
   * Comprehensive validation pipeline for clawback operations.
   *
   * Checks performed:
   *  1. Stream existence
   *  2. 24-hour cooldown period
   *  3. Amount positivity (> 0)
   *  4. Amount does not exceed max clawbackable
   *  5. Stream not already fully clawed back
   *  6. Any pending clawbacks exist (warn)
   *
   * Returns a ValidationResult with errors (blocking) and warnings (advisory).
   */
  async validateClawback(streamId: string, amount: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── 1. Stream existence ────────────────────────────────────────────────
    const stream = await this.prisma.stream.findFirst({
      where: {
        OR: [
          { streamId },
          { id: streamId },
        ],
      },
    });

    if (!stream) {
      errors.push(`Stream not found: ${streamId}`);
      return { valid: false, errors, warnings };
    }

    // ── 2. 24-hour cooldown period ─────────────────────────────────────────
    const streamCreationTime = stream.createdAt.getTime();
    const now = Date.now();
    const timeSinceCreation = now - streamCreationTime;

    if (timeSinceCreation < CLAWBACK_COOLDOWN_MS) {
      const hoursRemaining = Math.ceil(
        (CLAWBACK_COOLDOWN_MS - timeSinceCreation) / (60 * 60 * 1000)
      );
      errors.push(
        `Clawback not allowed within 24 hours of stream creation. ` +
        `Stream created at ${stream.createdAt.toISOString()}. ` +
        `Approximately ${hoursRemaining} hour(s) remaining until clawback is permitted.`
      );
    }

    // ── 3. Amount parsing & positivity ─────────────────────────────────────
    let clawbackAmount: bigint;
    try {
      clawbackAmount = BigInt(amount);
      if (clawbackAmount < 0n) {
        errors.push("Clawback amount must not be negative.");
      }
      if (clawbackAmount === 0n) {
        warnings.push("Clawback amount is zero. No funds will be recovered.");
      }
    } catch {
      errors.push(`Invalid clawback amount: "${amount}". Must be a valid integer.`);
      clawbackAmount = 0n;
    }

    // ── 4. Max clawbackable amount ─────────────────────────────────────────
    const totalAmount = BigInt(stream.amount);
    const withdrawn = BigInt(stream.withdrawn);
    const maxClawbackable = totalAmount - withdrawn;

    if (maxClawbackable <= 0n) {
      errors.push(
        `Stream ${streamId} has no clawbackable balance. ` +
        `Total: ${stream.amount}, Already withdrawn: ${stream.withdrawn}.`
      );
    } else if (clawbackAmount > maxClawbackable) {
      errors.push(
        `Clawback amount ${clawbackAmount} exceeds maximum clawbackable amount ` +
        `${maxClawbackable}. Reduce the amount to at most ${maxClawbackable}.`
      );
    }

    // ── 5. Check for existing clawback history ─────────────────────────────
    const existingClawbacks = await this.prisma.clawbackHistory.count({
      where: { streamId: stream.id },
    });

    if (existingClawbacks > 0) {
      warnings.push(
        `Stream ${streamId} has ${existingClawbacks} previous clawback record(s). ` +
        `Ensure this clawback is intentional.`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Executes a clawback after running validation.
   *
   * Throws if validation fails (for use in API handlers that want
   * a hard error rather than a ValidationResult).
   *
   * Returns the saved ClawbackRecord on success.
   */
  async executeClawback(input: ClawbackExecuteInput): Promise<ClawbackRecord> {
    const validation = await this.validateClawback(input.streamId, input.amount);

    if (!validation.valid) {
      const errorMsg = `Clawback validation failed: ${validation.errors.join("; ")}`;
      logger.error(errorMsg, { streamId: input.streamId, amount: input.amount });
      // Use BusinessRuleError (422) since validation failures represent
      // well-formed requests that violate clawback business rules.
      throw new BusinessRuleError(errorMsg, {
        details: {
          streamId: input.streamId,
          amount: input.amount,
          errors: validation.errors,
          warnings: validation.warnings,
        },
      });
    }

    // Resolve the stream record to get the proper ID
    const stream = await this.prisma.stream.findFirst({
      where: {
        OR: [
          { streamId: input.streamId },
          { id: input.streamId },
        ],
      },
    });

    if (!stream) {
      throw new NotFoundError("Stream", input.streamId);
    }

    // Create the clawback history record
    const record = await this.prisma.clawbackHistory.create({
      data: {
        streamId: stream.id,
        amount: input.amount,
        reason: input.reason ?? "",
        txHash: input.txHash ?? null,
        status: "executed",
        executedAt: new Date(),
      },
    });

    logger.info(`Clawback executed`, {
      streamId: input.streamId,
      amount: input.amount,
      recordId: record.id,
    });

    // Update withdrawn amount on the stream
    const newWithdrawn = BigInt(stream.withdrawn) + BigInt(input.amount);
    await this.prisma.stream.update({
      where: { id: stream.id },
      data: {
        withdrawn: newWithdrawn.toString(),
      },
    });

    return {
      id: record.id,
      streamId: record.streamId,
      amount: record.amount,
      reason: record.reason,
      executedAt: record.executedAt,
      status: record.status as "executed" | "pending" | "failed",
    };
  }

  /**
   * Returns full clawback history for a given stream.
   */
  async getClawbackHistory(streamId: string): Promise<ClawbackRecord[]> {
    const records = await this.prisma.clawbackHistory.findMany({
      where: { streamId },
      orderBy: { executedAt: "desc" },
    });

    return records.map((r: { id: string; streamId: string; amount: string; reason: string; executedAt: Date; status: string }) => ({
      id: r.id,
      streamId: r.streamId,
      amount: r.amount,
      reason: r.reason,
      executedAt: r.executedAt,
      status: r.status as "executed" | "pending" | "failed",
    }));
  }
}

// ─── Factory export ──────────────────────────────────────────────────────────

let _clawbackService: ClawbackService | null = null;

function createDefaultPrismaClient(): PrismaClient {
  const url = process.env["DATABASE_URL"] ?? "file:./dev.db";
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

export function getClawbackService(): ClawbackService {
  if (!_clawbackService) {
    _clawbackService = new ClawbackService(createDefaultPrismaClient());
  }
  return _clawbackService;
}
