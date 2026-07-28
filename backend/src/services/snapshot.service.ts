/**
 * Snapshot Service
 * Creates monthly snapshots of stream states and archives old event logs
 */

import { PrismaClient } from "../generated/client/index.js";
import { logger } from "../logger.js";

const prisma = new PrismaClient();

export class SnapshotService {
  /**
   * Create monthly snapshots for all active streams
   */
  async createMonthlySnapshots(): Promise<void> {
    const snapshotMonth = this.getCurrentMonth();
    
    try {
      const streams = await prisma.stream.findMany();
      
      for (const stream of streams) {
        // Derive amountPerSecond from amount / duration (both stored as strings/ints)
        const totalAmount = BigInt(stream.amount ?? "0");
        const durationSec = BigInt(stream.duration ?? 1);
        const amountPerSecond = durationSec > 0n ? totalAmount / durationSec : 0n;
        const tokenAddress = stream.tokenAddress ?? "";

        await prisma.streamSnapshot.upsert({
          where: {
            streamId_snapshotMonth: {
              streamId: stream.id,
              snapshotMonth,
            },
          },
          update: {
            sender: stream.sender,
            receiver: stream.receiver,
            tokenAddress,
            amountPerSecond,
            totalAmount,
            status: stream.status,
          },
          create: {
            streamId: stream.id,
            sender: stream.sender,
            receiver: stream.receiver,
            tokenAddress,
            amountPerSecond,
            totalAmount,
            status: stream.status,
            snapshotMonth,
          },
        });
      }

      logger.info(`Created snapshots for ${streams.length} streams`, {
        snapshotMonth,
      });
    } catch (error) {
      logger.error("Failed to create monthly snapshots", error);
      throw error;
    }
  }

  /**
   * Archive event logs older than 3 months
   */
  async archiveOldLogs(): Promise<number> {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    try {
      const oldLogs = await prisma.eventLog.findMany({
        where: {
          createdAt: {
            lt: threeMonthsAgo,
          },
        },
      });

      if (oldLogs.length === 0) {
        logger.info("No logs to archive");
        return 0;
      }

      await prisma.streamArchive.createMany({
        data: oldLogs.map((log) => ({
          id: log.id,
          eventType: log.eventType,
          streamId: log.streamId,
          txHash: log.txHash,
          ledger: log.ledger,
          ledgerClosedAt: log.ledgerClosedAt,
          sender: log.sender,
          receiver: log.receiver,
          amount: log.amount,
          metadata: log.metadata,
          createdAt: log.createdAt,
        })),
      });

      await prisma.eventLog.deleteMany({
        where: {
          createdAt: {
            lt: threeMonthsAgo,
          },
        },
      });

      logger.info(`Archived ${oldLogs.length} event logs`, {
        cutoffDate: threeMonthsAgo.toISOString(),
      });

      return oldLogs.length;
    } catch (error) {
      logger.error("Failed to archive old logs", error);
      throw error;
    }
  }

  /**
   * Run both snapshot and archive operations
   */
  async runMaintenance(): Promise<{ snapshotsCreated: boolean; logsArchived: number }> {
    await this.createMonthlySnapshots();
    const logsArchived = await this.archiveOldLogs();
    
    return {
      snapshotsCreated: true,
      logsArchived,
    };
  }

  /**
   * Get current month in YYYY-MM format
   */
  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  /**
   * Get snapshot for a specific stream and month
   */
  async getSnapshot(streamId: string, month?: string) {
    const snapshotMonth = month || this.getCurrentMonth();
    
    return prisma.streamSnapshot.findUnique({
      where: {
        streamId_snapshotMonth: {
          streamId,
          snapshotMonth,
        },
      },
    });
  }

  /**
   * Get all snapshots for a stream
   */
  async getStreamSnapshots(streamId: string) {
    return prisma.streamSnapshot.findMany({
      where: { streamId },
      orderBy: { snapshotMonth: "desc" },
    });
  }

  /**
   * Get archived logs for a stream
   */
  async getArchivedLogs(streamId: string) {
    return prisma.streamArchive.findMany({
      where: { streamId },
      orderBy: { createdAt: "desc" },
    });
  }
}
