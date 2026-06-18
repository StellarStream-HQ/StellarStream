/**
 * Event Watcher Client Service
 * 
 * This service communicates with the separate event watcher microservice
 * via Redis pub/sub to monitor its status and relay information to the API.
 */

import { redis } from "../lib/redis.js";
import { logger } from "../logger.js";

interface EventWatcherStatus {
  status: string;
  timestamp: string;
  lockKey: string;
  lastProcessedLedger: number;
}

export class EventWatcherClient {
  private subscriber: any;
  private isListening = false;
  private latestStatus: EventWatcherStatus | null = null;
  private readonly STATUS_CHANNEL = "event_watcher:status";

  constructor() {
    this.subscriber = redis.duplicate();
  }

  /**
   * Start listening to event watcher status updates
   */
  async startListening(): Promise<void> {
    if (this.isListening) return;

    try {
      await this.subscriber.subscribe(this.STATUS_CHANNEL);
      
      this.subscriber.on("message", (channel: string, message: string) => {
        if (channel === this.STATUS_CHANNEL) {
          try {
            this.latestStatus = JSON.parse(message);
            logger.debug("[EventWatcherClient] Status update received", {
              status: this.latestStatus.status,
              lastProcessedLedger: this.latestStatus.lastProcessedLedger,
            });
          } catch (error) {
            logger.error("[EventWatcherClient] Failed to parse status message", { error, message });
          }
        }
      });

      this.isListening = true;
      logger.info("[EventWatcherClient] Started listening to event watcher status");
    } catch (error) {
      logger.error("[EventWatcherClient] Failed to start listening", { error });
      throw error;
    }
  }

  /**
   * Stop listening to status updates
   */
  async stopListening(): Promise<void> {
    if (!this.isListening) return;

    try {
      await this.subscriber.unsubscribe(this.STATUS_CHANNEL);
      await this.subscriber.disconnect();
      this.isListening = false;
      logger.info("[EventWatcherClient] Stopped listening to event watcher status");
    } catch (error) {
      logger.error("[EventWatcherClient] Error stopping listener", { error });
    }
  }

  /**
   * Get the latest event watcher status
   */
  getLatestStatus(): EventWatcherStatus | null {
    return this.latestStatus;
  }

  /**
   * Check if event watcher is healthy
   */
  async isEventWatcherHealthy(): Promise<boolean> {
    try {
      // Try to fetch status directly from the event watcher service
      const response = await fetch(`http://localhost:${process.env.EVENT_WATCHER_PORT || 3001}/health`);
      if (!response.ok) {
        return false;
      }
      const health: any = await response.json();
      return health.status === "healthy";
    } catch (error) {
      logger.warn("[EventWatcherClient] Failed to reach event watcher health endpoint", { error });
      
      // Fallback to Redis-based status check
      if (this.latestStatus) {
        const statusAge = Date.now() - new Date(this.latestStatus.timestamp).getTime();
        return statusAge < 30000; // Status is fresh if less than 30 seconds old
      }
      
      return false;
    }
  }

  /**
   * Get processing latency (time since last ledger was processed)
   */
  async getProcessingLatency(): Promise<number | null> {
    if (!this.latestStatus) return null;

    try {
      // This would require getting the latest ledger from Stellar network
      // For now, return a simple timestamp-based latency
      const statusAge = Date.now() - new Date(this.latestStatus.timestamp).getTime();
      return statusAge;
    } catch (error) {
      logger.error("[EventWatcherClient] Failed to calculate processing latency", { error });
      return null;
    }
  }
}
