/**
 * Event Watcher Service - Dedicated microservice for blockchain event indexing
 * 
 * This service runs independently from the API server to avoid single points
 * of failure and CPU starvation issues. It manages cursor state through Redis
 * with distributed locking for high availability.
 */

import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { PrismaClient } from "../generated/client/index.js";
import { redis } from "../lib/redis.js";
import { logger } from "../logger.js";
import { V3SplitIngestor } from "../ingestor/v3-split-ingestor.js";

interface EventWatcherConfig {
  rpcUrl: string;
  contractId: string;
  lockTtl: number; // Redis lock TTL in seconds
  pollInterval: number; // Polling interval in milliseconds
}

interface EventWatcherState {
  lastProcessedLedger: number;
  isRunning: boolean;
  lockKey: string;
}

export class EventWatcherService {
  private config: EventWatcherConfig;
  private state: EventWatcherState;
  private prisma: PrismaClient;
  private v3Ingestor: V3SplitIngestor;
  private pollTimeout?: NodeJS.Timeout;
  private lockRenewalInterval?: NodeJS.Timeout;
  private readonly CURSOR_KEY = "event_watcher:cursor";
  private readonly LOCK_KEY = "event_watcher:lock";
  private readonly STATUS_CHANNEL = "event_watcher:status";

  constructor(config?: Partial<EventWatcherConfig>) {
    this.config = {
      rpcUrl: process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
      contractId: process.env.V3_CONTRACT_ID || "",
      lockTtl: 30, // 30 seconds
      pollInterval: 2000, // 2 seconds
      ...config,
    };

    this.state = {
      lastProcessedLedger: 0,
      isRunning: false,
      lockKey: `${this.LOCK_KEY}:${process.pid}`,
    };

    this.prisma = new PrismaClient();
    this.v3Ingestor = new V3SplitIngestor(this.config.rpcUrl);
  }

  /**
   * Start the event watcher service
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      logger.warn("[EventWatcher] Already running");
      return;
    }

    try {
      // Acquire distributed lock
      const lockAcquired = await this.acquireLock();
      if (!lockAcquired) {
        throw new Error("Failed to acquire distributed lock. Another instance may be running.");
      }

      // Load cursor state from Redis
      await this.loadCursorState();

      this.state.isRunning = true;

      // Start V3 ingestor
      await this.v3Ingestor.start();

      // Start lock renewal
      this.startLockRenewal();

      // Start polling
      this.startPolling();

      // Publish status update
      await this.publishStatus("started");

      logger.info("[EventWatcher] Service started", {
        lockKey: this.state.lockKey,
        lastProcessedLedger: this.state.lastProcessedLedger,
      });
    } catch (error) {
      logger.error("[EventWatcher] Failed to start service", { error });
      throw error;
    }
  }

  /**
   * Stop the event watcher service gracefully
   */
  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    logger.info("[EventWatcher] Stopping service gracefully...");

    this.state.isRunning = false;

    // Clear timers
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    if (this.lockRenewalInterval) {
      clearInterval(this.lockRenewalInterval);
    }

    // Stop V3 ingestor
    this.v3Ingestor.stop();

    // Save cursor state
    await this.saveCursorState();

    // Release lock
    await this.releaseLock();

    // Publish status update
    await this.publishStatus("stopped");

    // Disconnect from database
    await this.prisma.$disconnect();

    logger.info("[EventWatcher] Service stopped");
  }

  /**
   * Get current watcher health status
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "unhealthy";
    lastProcessedLedger: number;
    isRunning: boolean;
    lockOwner: string | null;
  }> {
    const lockOwner = await redis.get(this.LOCK_KEY);
    
    return {
      status: this.state.isRunning ? "healthy" : "unhealthy",
      lastProcessedLedger: this.state.lastProcessedLedger,
      isRunning: this.state.isRunning,
      lockOwner,
    };
  }

  /**
   * Acquire distributed lock with TTL
   */
  private async acquireLock(): Promise<boolean> {
    const result = await redis.set(
      this.LOCK_KEY,
      this.state.lockKey,
      "EX",
      this.config.lockTtl,
      "NX"
    );
    return result === "OK";
  }

  /**
   * Renew the distributed lock periodically
   */
  private async renewLock(): Promise<void> {
    if (!this.state.isRunning) return;

    try {
      const currentLock = await redis.get(this.LOCK_KEY);
      if (currentLock === this.state.lockKey) {
        await redis.expire(this.LOCK_KEY, this.config.lockTtl);
      } else {
        logger.error("[EventWatcher] Lost lock ownership, stopping service");
        await this.stop();
      }
    } catch (error) {
      logger.error("[EventWatcher] Failed to renew lock", { error });
    }
  }

  /**
   * Release the distributed lock
   */
  private async releaseLock(): Promise<void> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, this.LOCK_KEY, this.state.lockKey);
  }

  /**
   * Start lock renewal timer
   */
  private startLockRenewal(): void {
    const renewalInterval = Math.floor(this.config.lockTtl * 1000 / 2); // Renew at half TTL
    this.lockRenewalInterval = setInterval(() => {
      this.renewLock();
    }, renewalInterval);
  }

  /**
   * Load cursor state from Redis
   */
  private async loadCursorState(): Promise<void> {
    const cursor = await redis.get(this.CURSOR_KEY);
    if (cursor) {
      this.state.lastProcessedLedger = parseInt(cursor, 10);
      logger.info("[EventWatcher] Loaded cursor from Redis", {
        lastProcessedLedger: this.state.lastProcessedLedger,
      });
    }
  }

  /**
   * Save cursor state to Redis
   */
  private async saveCursorState(): Promise<void> {
    await redis.set(this.CURSOR_KEY, this.state.lastProcessedLedger.toString());
  }

  /**
   * Start polling for events
   */
  private startPolling(): void {
    const poll = async () => {
      if (!this.state.isRunning) return;

      try {
        // The actual event processing is handled by V3SplitIngestor
        // We just need to update our cursor when it processes events
        await this.updateCursorFromIngestor();
        await this.saveCursorState();
      } catch (error) {
        logger.error("[EventWatcher] Polling error", { error });
      }

      if (this.state.isRunning) {
        this.pollTimeout = setTimeout(poll, this.config.pollInterval);
      }
    };

    poll();
  }

  /**
   * Update cursor from the V3 ingestor's progress
   */
  private async updateCursorFromIngestor(): Promise<void> {
    // This would need to be implemented based on how V3SplitIngestor tracks progress
    // For now, we'll use a simple approach
    const { getLastLedgerSequence } = await import("../services/syncMetadata.service.js");
    const latestLedger = await getLastLedgerSequence();
    if (latestLedger > this.state.lastProcessedLedger) {
      this.state.lastProcessedLedger = latestLedger;
    }
  }

  /**
   * Publish status updates to Redis pub/sub
   */
  private async publishStatus(status: string): Promise<void> {
    const statusData = {
      status,
      timestamp: new Date().toISOString(),
      lockKey: this.state.lockKey,
      lastProcessedLedger: this.state.lastProcessedLedger,
    };

    await redis.publish(this.STATUS_CHANNEL, JSON.stringify(statusData));
  }
}
