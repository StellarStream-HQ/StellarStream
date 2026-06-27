import { prisma } from "../lib/db.js";
import { computeEntryHash } from "../lib/audit-hash-chain.js";
import { logger } from "../logger.js";
import { InternalError } from "../lib/app-error.js";

export interface EventLogEntry {
  eventType: string;
  streamId: string;
  txHash: string;
  /** Zero-based index of this event within its transaction */
  eventIndex?: number;
  ledger: number;
  ledgerClosedAt: string;
  sender?: string;
  receiver?: string;
  amount?: bigint;
  metadata?: Record<string, unknown>;
  /**
   * Deterministic hash computed from on-chain event XDR.
   */
  eventHash?: string;
}

export interface AuditLogItem {
  id: string;
  eventType: string;
  streamId: string;
  txHash: string;
  ledger: number;
  ledgerClosedAt: string;
  sender: string | null;
  receiver: string | null;
  amount: string | null;
  metadata: Record<string, unknown> | null;
  parentHash: string | null;
  entryHash: string | null;
  createdAt: Date;
}

export class AuditLogService {
  /**
   * Log an event to the audit log.
   * Uses upsert on (txHash, eventIndex) to guarantee idempotency —
   * re-processing the same on-chain event (e.g. after a re-org recovery)
   * will update the existing row rather than creating a duplicate.
   */
  async logEvent(entry: EventLogEntry): Promise<void> {
    try {
      const eventIndex = entry.eventIndex ?? 0;
      const data = {
        metadata: entry.metadata
          ? JSON.stringify(
              entry.eventHash
                ? { ...entry.metadata, __eventHash: entry.eventHash }
                : entry.metadata,
            )
          : entry.eventHash
          ? JSON.stringify({ __eventHash: entry.eventHash })
          : null,
        eventType: entry.eventType,
        streamId: entry.streamId,
        txHash: entry.txHash,
        eventIndex,
        ledger: entry.ledger,
        ledgerClosedAt: entry.ledgerClosedAt,
        sender: entry.sender ?? null,
        receiver: entry.receiver ?? null,
        amount: entry.amount ?? null,
      };

      const latest = await prisma.eventLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { entryHash: true },
      });
      const parentHash = latest?.entryHash ?? null;
      const entryHash = computeEntryHash(
        {
          eventType: data.eventType,
          streamId: data.streamId,
          txHash: data.txHash,
          eventIndex,
          ledger: data.ledger,
          ledgerClosedAt: data.ledgerClosedAt,
          sender: data.sender,
          receiver: data.receiver,
          amount: data.amount?.toString() ?? null,
          metadata: data.metadata,
        },
        parentHash,
      );

      await prisma.eventLog.upsert({
        where: {
          txHash_eventIndex: { txHash: entry.txHash, eventIndex },
        },
        create: {
          ...data,
          parentHash,
          entryHash,
        },
        update: {
          eventType: data.eventType,
          streamId: data.streamId,
          ledger: data.ledger,
          ledgerClosedAt: data.ledgerClosedAt,
          sender: data.sender,
          receiver: data.receiver,
          amount: data.amount,
          metadata: data.metadata,
          parentHash,
          entryHash,
        },
      });

      logger.info("Event logged to audit log", {
        eventType: entry.eventType,
        streamId: entry.streamId,
        txHash: entry.txHash,
        eventIndex,
      });
    } catch (error) {
      logger.error("Failed to log event to audit log", error, {
        eventType: entry.eventType,
        streamId: entry.streamId,
      });
    }
  }

  /**
   * Get the last N events from the audit log
   */
  async getRecentEvents(limit: number = 50): Promise<AuditLogItem[]> {
    try {
      const events = await prisma.eventLog.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      });

      return events.map(
        (event: {
          id: string;
          eventType: string;
          streamId: string;
          txHash: string;
          ledger: number;
          ledgerClosedAt: string;
          sender: string | null;
          receiver: string | null;
          amount: bigint | null;
          metadata: string | null;
          parentHash: string | null;
          entryHash: string | null;
          createdAt: Date;
        }) => ({
          id: event.id,
          eventType: event.eventType,
          streamId: event.streamId,
          txHash: event.txHash,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
          sender: event.sender,
          receiver: event.receiver,
          amount: event.amount?.toString() ?? null,
          metadata: event.metadata ? JSON.parse(event.metadata) : null,
          parentHash: event.parentHash,
          entryHash: event.entryHash,
          createdAt: event.createdAt,
        }),
      );
    } catch (error) {
      logger.error("Failed to retrieve audit log", error);
      // Re-throw as a typed InternalError so error middleware can report consistently.
      throw new InternalError("Failed to retrieve audit log", { cause: error });
    }
  }

  /**
   * Get events for a specific stream
   */
  async getStreamEvents(streamId: string): Promise<AuditLogItem[]> {
    try {
      const events = await prisma.eventLog.findMany({
        where: {
          streamId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return events.map(
        (event: {
          id: string;
          eventType: string;
          streamId: string;
          txHash: string;
          ledger: number;
          ledgerClosedAt: string;
          sender: string | null;
          receiver: string | null;
          amount: bigint | null;
          metadata: string | null;
          parentHash: string | null;
          entryHash: string | null;
          createdAt: Date;
        }) => ({
          id: event.id,
          eventType: event.eventType,
          streamId: event.streamId,
          txHash: event.txHash,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
          sender: event.sender,
          receiver: event.receiver,
          amount: event.amount?.toString() ?? null,
          metadata: event.metadata ? JSON.parse(event.metadata) : null,
          parentHash: event.parentHash,
          entryHash: event.entryHash,
          createdAt: event.createdAt,
        }),
      );
    } catch (error) {
      logger.error("Failed to retrieve stream events", error, { streamId });
      // Re-throw as a typed InternalError so error middleware can report consistently.
      throw new InternalError("Failed to retrieve stream events", {
        cause: error,
        details: { streamId },
      });
    }
  }
}
