#!/usr/bin/env node

/**
 * Event Watcher Service Entry Point
 * 
 * This is the main entry point for the dedicated event watcher microservice.
 * It runs independently from the API server to avoid CPU starvation and 
 * single points of failure.
 */

import { SorobanRpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { EventWatcherConfig, WatcherState, ParsedContractEvent } from "./types";
import { logger } from "./logger";
import { parseContractEvent, extractEventType } from "./event-parser";
import { PrismaClient } from "./generated/client/client.js";
import { StreamLifecycleService, toObjectOrNull, toBigIntOrNull } from "./services/stream-lifecycle-service.js";

// @ts-expect-error Prisma Client may not be generated yet
const prisma = new PrismaClient();

export class EventWatcher {
  private server: SorobanRpc.Server;
  private config: EventWatcherConfig;
  private state: WatcherState;
  private isShuttingDown: boolean = false;
  private pollTimeout?: NodeJS.Timeout;
  private streamLifecycleService: StreamLifecycleService;

  constructor(config: EventWatcherConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });

    this.state = {
      lastProcessedLedger: 0,
      isRunning: false,
      errorCount: 0,
    };
    this.streamLifecycleService = new StreamLifecycleService();
  }
}

import * as Sentry from "@sentry/node";
import { EventWatcherService } from "./services/event-watcher.service.js";
import { ensureRedis, closeRedis } from "./lib/redis.js";
import { logger } from "./logger.js";
import express from "express";

// Initialize Sentry for error tracking
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 1.0,
});

const PORT = parseInt(process.env.EVENT_WATCHER_PORT || "3001", 10);

let eventWatcher: EventWatcherService;
let healthServer: any;

/**
 * Start the event watcher service
 */
async function start(): Promise<void> {
  try {
    logger.info("[EventWatcher] Starting event watcher service...");

    // Ensure Redis connection
    await ensureRedis();

    // Initialize event watcher
    eventWatcher = new EventWatcherService();
    
    // Start health check server
    await startHealthServer();

    // Start the event watcher
    await eventWatcher.start();

    logger.info("[EventWatcher] Event watcher service started successfully", {
      port: PORT,
      healthEndpoint: `http://localhost:${PORT}/health`,
    });

  } catch (error) {
    logger.error("[EventWatcher] Failed to start event watcher service", { error });
    process.exit(1);
  }
}

/**
 * Start health check HTTP server
 */
async function startHealthServer(): Promise<void> {
  const app = express();
  
  app.use(express.json());

  // Health check endpoint
  app.get("/health", async (req, res) => {
    try {
      const health = await eventWatcher.getHealthStatus();
      const httpStatus = health.status === "healthy" ? 200 : 503;
      
      res.status(httpStatus).json({
        service: "event-watcher",
        ...health,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        service: "event-watcher",
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Metrics endpoint for monitoring
  app.get("/metrics", async (req, res) => {
    try {
      const health = await eventWatcher.getHealthStatus();
      
      // Prometheus-style metrics
      const metrics = [
        `# HELP event_watcher_running Event watcher running status`,
        `# TYPE event_watcher_running gauge`,
        `event_watcher_running ${health.isRunning ? 1 : 0}`,
        ``,
        `# HELP event_watcher_last_processed_ledger Last processed ledger number`,
        `# TYPE event_watcher_last_processed_ledger counter`,
        `event_watcher_last_processed_ledger ${health.lastProcessedLedger}`,
        ``,
        `# HELP event_watcher_health_status Health status (1=healthy, 0=unhealthy)`,
        `# TYPE event_watcher_health_status gauge`,
        `event_watcher_health_status ${health.status === "healthy" ? 1 : 0}`,
      ].join('\n');
      
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      res.status(500).send("Error generating metrics");
    }
  });

  return new Promise((resolve) => {
    healthServer = app.listen(PORT, () => {
      logger.info(`[EventWatcher] Health server running on port ${PORT}`);
      resolve(undefined);
    });
  });
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`[EventWatcher] ${signal} received, shutting down gracefully...`);

  try {
    // Stop event watcher
    if (eventWatcher) {
      await eventWatcher.stop();
    }

    // Close health server
    if (healthServer) {
      healthServer.close();
    }

    // Close Redis connection
    await closeRedis();

    logger.info("[EventWatcher] Shutdown completed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("[EventWatcher] Error during shutdown", { error });
    process.exit(1);
  }
}

// Handle graceful shutdown signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("[EventWatcher] Uncaught exception", { error });
  shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason) => {
  logger.error("[EventWatcher] Unhandled rejection", { reason });
  shutdown("UNHANDLED_REJECTION");
});

// Start the service
start().catch((error) => {
  logger.error("[EventWatcher] Failed to start", { error });
  process.exit(1);
});
