import express, { Express, Request, Response } from 'express';
import apiRoutes from './api/index.js';
import * as Sentry from "@sentry/node";
import express, { Express, Request, Response } from "express";
import compression from "compression";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import swaggerUi from "swagger-ui-express";
import { WebSocketService } from "./services/websocket.service.js";
import { WarpService } from "./services/warp.service.js";
import { BridgeObserverService } from "./services/bridge-observer.service.js";
import { TTLArchivalMonitorService } from "./services/ttl-archival-monitor.service.js";
import helmet from "helmet";
import cors from "cors";
import apiRouter from "./api/index.js";
import { authMiddleware } from "./middleware/auth.js";
import {
  rateLimitMiddleware,
  sensitiveRateLimitMiddleware,
} from "./middleware/rateLimit.js";
import { requireWalletAuth } from "./middleware/requireWalletAuth.js";
import { getStats, getSearch } from "./api/public.js";
import { getNonce, getMe } from "./api/auth.js";
import { ensureRedis, closeRedis } from "./lib/redis.js";
import { prisma } from "./lib/db.js";
import batchRoutes from "./api/routes.js";
import healthRoutes from "./api/health.routes.js";
import testRoutes from "./api/test.js";
import { scheduleSnapshotMaintenance } from "./services/snapshot.scheduler.js";
import { StaleStreamCleanupWorker } from "./stale-stream-cleanup.worker.js";
import { DataIntegrityWorker } from "./data-integrity.worker.js";
import { YieldAccrualWorker } from "./yield-accrual.worker.js";
import { startWebhookWorker } from "./webhook-dispatcher.worker.js";
import { XlmBufferMonitorWorker } from "./xlm-buffer-monitor.worker.js";
import { EventWatcherClient } from "./services/event-watcher-client.service.js";
import { bigintSerializer } from "./middleware/bigintSerializer.js";
import { swaggerSpec } from "./swagger.js";
import { swaggerV3Spec } from "./api/v3/swagger.js";
import { initializeSchedulers } from "./schedulers.js";
import { createSplitWorker } from "./workers/splitWorker.js";
import { enqueueSplit, getSplitJobStatus } from "./lib/splitQueue.js";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  tracesSampleRate: 1.0,
});

const app: Express = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT ?? 3000;
export const wsService = new WebSocketService(io);
export const warpService = new WarpService(wsService);
export const bridgeObserver = new BridgeObserverService(wsService);
export const ttlMonitor = new TTLArchivalMonitorService(wsService);
const cleanupWorker = new StaleStreamCleanupWorker();
const dataIntegrityWorker = new DataIntegrityWorker();
const yieldAccrualWorker = new YieldAccrualWorker();
const xlmBufferMonitor = new XlmBufferMonitorWorker();
const eventWatcherClient = new EventWatcherClient();

// ── Security middleware ────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }),
);

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((u) => u.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
  }),
);

app.use(bigintSerializer);
app.use(compression());
app.use(express.json());
app.use(authMiddleware);

// ── Root redirect → Swagger docs ──────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.redirect("/api/v1/docs");
});

// ── Swagger UI ────────────────────────────────────────────────────────────────
app.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/v1/docs.json", (_req: Request, res: Response) => {
  res.json(swaggerSpec);
});

// ── V3 Swagger UI ─────────────────────────────────────────────────────────────
app.use("/api/v3/docs", swaggerUi.serve, swaggerUi.setup(swaggerV3Spec));
app.get("/api/v3/docs.json", (_req: Request, res: Response) => {
  res.json(swaggerV3Spec);
});

// ── Auth routes ───────────────────────────────────────────────────────────────
const authRouter = express.Router();
authRouter.get("/nonce", rateLimitMiddleware, getNonce);
authRouter.get("/me", rateLimitMiddleware, requireWalletAuth, getMe);
// Sensitive: 5 req/min on challenge endpoint
authRouter.post(
  "/challenge",
  sensitiveRateLimitMiddleware,
  (_req: Request, res: Response) => {
    res.status(501).json({ error: "Not implemented", code: 501 });
  },
);
app.use("/api/v1/auth", authRouter);

// ── Webhook routes (sensitive: 5 req/min) ────────────────────────────────────
app.post(
  "/webhook/register",
  sensitiveRateLimitMiddleware,
  (_req: Request, res: Response) => {
    res.status(501).json({ error: "Not implemented", code: 501 });
  },
);

// ── Public routes (stats / search) ───────────────────────────────────────────
app.get("/api/v1/stats", rateLimitMiddleware, getStats);
app.get("/api/v1/search", rateLimitMiddleware, getSearch);

// ── Core API router (streams, yield, snapshots, governance, audit-log) ────────
app.use("/api/v1", apiRouter);

// ── V2 API router ─────────────────────────────────────────────────────────────
import apiV2Router from "./api/v2/index.js";
app.use("/api/v2", apiV2Router);

// ── V3 API router ─────────────────────────────────────────────────────────────
import apiV3Router from "./api/v3/index.js";
// Support raw text bodies for CSV uploads on v3 routes
app.use("/api/v3", express.text({ type: ["text/csv", "text/plain"], limit: "10mb" }));
app.use("/api/v3", apiV3Router);

// ── Batch metadata + stream graph ─────────────────────────────────────────────
app.use("/api/v1", batchRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'StellarStream Backend is running' });
});

// API routes
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
// ── Health / sync status ──────────────────────────────────────────────────────
app.use("/api/v1", healthRoutes);

// ── Test/dev helpers ──────────────────────────────────────────────────────────
app.use("/api/v1/test", testRoutes);

// ── WebSocket status ──────────────────────────────────────────────────────────
app.get("/ws-status", (_req: Request, res: Response) => {
  res.json({
    connectedUsers: wsService.getConnectedUsers(),
    userConnections: Object.fromEntries(
      wsService
        .getConnectedUsers()
        .map((addr) => [addr, wsService.getUserSocketCount(addr)]),
    ),
  });
});

// ── Event Watcher status ──────────────────────────────────────────────────────
app.get("/event-watcher-status", async (_req: Request, res: Response) => {
  try {
    const isHealthy = await eventWatcherClient.isEventWatcherHealthy();
    const latestStatus = eventWatcherClient.getLatestStatus();
    const processingLatency = await eventWatcherClient.getProcessingLatency();

    res.json({
      healthy: isHealthy,
      latestStatus,
      processingLatency,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

// ── Sentry error handler ──────────────────────────────────────────────────────
Sentry.setupExpressErrorHandler(app);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await ensureRedis();
  scheduleSnapshotMaintenance();
  initializeSchedulers();
  createSplitWorker();
  cleanupWorker.start();
  dataIntegrityWorker.start();
  yieldAccrualWorker.start();
  xlmBufferMonitor.start();
  startWebhookWorker();
  
  // Start background services
  bridgeObserver.start();
  ttlMonitor.start();
  
  // Start event watcher client to monitor separate service
  await eventWatcherClient.startListening();

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📖 API docs: http://localhost:${PORT}/api/v1/docs`);
    console.log(`🔌 WebSocket ready`);
    console.log(`🌉 Bridge observer active`);
    console.log(`⏱️  TTL monitor active`);
    console.log(`📡 Event watcher client connected`);
  });
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down gracefully...`);
  cleanupWorker.stop();
  dataIntegrityWorker.stop();
  yieldAccrualWorker.stop();
  xlmBufferMonitor.stop();
  bridgeObserver.stop();
  ttlMonitor.stop();
  eventWatcherClient.stopListening();
  closeRedis()
    .then(() => prisma.$disconnect())
    .then(() => {
      console.log("Goodbye.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

/**
 * @notice Route to enqueue a split_funds request
 * @dev Adds the split to the Redis queue for serialized processing
 * This prevents Stellar sequence number collisions during high concurrency
 */
app.post("/splits/enqueue", async (req, res) => {
  const { streamId, sender, receiver, amount, asset } = req.body;

  if (!streamId || !sender || !receiver || !amount || !asset) {
    return res.status(400).json({
      error: "streamId, sender, receiver, amount and asset are required",
    });
  }

  try {
    const jobId = await enqueueSplit({
      streamId,
      sender,
      receiver,
      amount,
      asset,
      requestedAt: new Date().toISOString(),
    });

    return res.status(202).json({
      jobId,
      status: "pending",
      message: "Split request queued for processing",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @notice Route to check the status of a queued split job
 * @dev Poll this endpoint to know when a split has been processed
 */
app.get("/splits/status/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    const status = await getSplitJobStatus(jobId);

    if (!status) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default app;