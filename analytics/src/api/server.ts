import cors from "cors";
import dotenv from "dotenv";
import express, { Express } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { AnalyticsDatabase, getDatabase } from "../db/storage.js";
import { EventIndexer } from "../indexer/event-indexer.js";
import { MetricsProcessor } from "../processor/metrics-processor.js";
import { createAnalyticsRouter } from "./routes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createAnalyticsApp(options?: {
  db?: AnalyticsDatabase;
  indexer?: EventIndexer;
  processor?: MetricsProcessor;
}): { app: Express; db: AnalyticsDatabase; processor: MetricsProcessor; indexer?: EventIndexer } {
  const app = express();

  const db = options?.db || getDatabase();
  const processor = options?.processor || new MetricsProcessor(db);
  const indexer = options?.indexer || new EventIndexer(db);

  app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    const state = db.getIndexerState();
    res.json({
      status: "healthy",
      service: "stellarstream-analytics",
      timestamp: new Date().toISOString(),
      indexerStatus: state.status,
      lastLedger: state.lastLedger,
      totalEventsProcessed: state.totalEventsProcessed,
    });
  });

  // Mount API router
  app.use("/api/v1/analytics", createAnalyticsRouter(db, processor, indexer));

  // Serve visualization dashboard static frontend
  const dashboardDir = path.join(__dirname, "..", "dashboard");
  app.use("/dashboard", express.static(dashboardDir));
  app.use("/", express.static(dashboardDir));

  return { app, db, processor, indexer };
}

export function startServer(port = parseInt(process.env.PORT || "4000", 10)) {
  const { app, indexer } = createAnalyticsApp();

  const server = app.listen(port, () => {
    console.log(`[Analytics API] Server running at http://localhost:${port}`);
    console.log(`[Analytics API] Dashboard available at http://localhost:${port}/`);
    console.log(`[Analytics API] Health check at http://localhost:${port}/health`);
  });

  if (process.env.START_INDEXER !== "false" && indexer) {
    indexer.start().catch((err) => {
      console.warn("[Analytics Indexer] Failed to start indexer:", err);
    });
  }

  const shutdown = () => {
    console.log("[Analytics] Shutting down gracefully...");
    if (indexer) indexer.stop();
    server.close(() => {
      console.log("[Analytics] Server closed.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, app };
}

if (process.argv[1] && process.argv[1].endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  startServer();
}
