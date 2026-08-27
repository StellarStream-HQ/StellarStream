import { Router, Request, Response } from "express";
import { AnalyticsDatabase } from "../db/storage.js";
import { EventIndexer } from "../indexer/event-indexer.js";
import { MetricsProcessor } from "../processor/metrics-processor.js";
import { ExportFormat, ExportType } from "../processor/export-generator.js";

export function createAnalyticsRouter(db: AnalyticsDatabase, processor: MetricsProcessor, indexer?: EventIndexer): Router {
  const router = Router();

  /**
   * GET /api/v1/analytics/overview
   * Summary KPI metrics across TVL, volume, streams, gas, cancellation
   */
  router.get("/overview", (_req: Request, res: Response) => {
    try {
      const data = processor.getOverview();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve overview metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/streams/volume
   * Streams created per day / week / month
   */
  router.get("/streams/volume", (req: Request, res: Response) => {
    try {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "day";
      const token = req.query.token as string | undefined;
      const data = processor.getVolumeMetrics(timeframe, token);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve volume metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/tvl
   * TVL over time by token
   */
  router.get("/tvl", (req: Request, res: Response) => {
    try {
      const token = req.query.token as string | undefined;
      const data = processor.getTvlMetrics(token);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve TVL metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/streams/duration
   * Average stream duration and histogram distribution
   */
  router.get("/streams/duration", (_req: Request, res: Response) => {
    try {
      const data = processor.getDurationMetrics();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve duration metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/streams/amounts
   * Average stream amount and size distribution percentiles
   */
  router.get("/streams/amounts", (req: Request, res: Response) => {
    try {
      const token = req.query.token as string | undefined;
      const data = processor.getAmountMetrics(token);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve amount metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/withdrawals
   * Withdrawal patterns (timing, size distribution, hourly frequency)
   */
  router.get("/withdrawals", (_req: Request, res: Response) => {
    try {
      const data = processor.getWithdrawalPatterns();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve withdrawal patterns" });
    }
  });

  /**
   * GET /api/v1/analytics/cancellations
   * Cancellation rate and lifecycle statistics
   */
  router.get("/cancellations", (_req: Request, res: Response) => {
    try {
      const data = processor.getCancellationMetrics();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve cancellation metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/retention
   * User retention cohorts (Day 1, 7, 14, 30, 60, 90) & repeat rates
   */
  router.get("/retention", (_req: Request, res: Response) => {
    try {
      const data = processor.getRetentionMetrics();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve user retention metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/gas
   * Gas costs and transaction fees over time
   */
  router.get("/gas", (req: Request, res: Response) => {
    try {
      const action = req.query.action as string | undefined;
      const data = processor.getGasMetrics(action);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve gas metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/features
   * Feature usage statistics & contract version adoption
   */
  router.get("/features", (_req: Request, res: Response) => {
    try {
      const data = processor.getFeatureUsageMetrics();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve feature metrics" });
    }
  });

  /**
   * GET /api/v1/analytics/export
   * Export analytical data to CSV or JSON format
   */
  router.get("/export", (req: Request, res: Response) => {
    try {
      const type = (req.query.type as ExportType) || "streams";
      const format = (req.query.format as ExportFormat) || "json";
      const fromDate = req.query.fromDate as string | undefined;
      const toDate = req.query.toDate as string | undefined;
      const tokenSymbol = req.query.token as string | undefined;
      const status = req.query.status as string | undefined;

      const result = processor.generateExport(type, format, { fromDate, toDate, tokenSymbol, status });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to export report" });
    }
  });

  /**
   * GET /api/v1/analytics/events
   * Query raw indexed contract events with pagination & filters
   */
  router.get("/events", (req: Request, res: Response) => {
    try {
      const { contractVersion, action, tokenAddress, sender, receiver, fromTimestamp, toTimestamp, limit, offset } = req.query;
      const data = db.getEvents({
        contractVersion: contractVersion as string,
        action: action as string,
        tokenAddress: tokenAddress as string,
        sender: sender as string,
        receiver: receiver as string,
        fromTimestamp: fromTimestamp as string,
        toTimestamp: toTimestamp as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Failed to retrieve contract events" });
    }
  });

  /**
   * GET /api/v1/analytics/events/live
   * Server-Sent Events (SSE) stream for live indexed events
   */
  router.get("/events/live", (req: Request, res: Response) => {
    if (!indexer) {
      res.status(501).json({ success: false, error: "Live event streaming not available in current configuration" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const onEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    indexer.on("event", onEvent);

    req.on("close", () => {
      indexer.off("event", onEvent);
      res.end();
    });
  });

  /**
   * GET /api/v1/analytics/indexer/status
   */
  router.get("/indexer/status", (_req: Request, res: Response) => {
    if (!indexer) {
      res.json({ success: true, data: { status: "IDLE", lastLedger: 0 } });
      return;
    }
    res.json({ success: true, data: indexer.getStatus() });
  });

  /**
   * POST /api/v1/analytics/indexer/sync
   */
  router.post("/indexer/sync", async (_req: Request, res: Response) => {
    if (!indexer) {
      res.status(400).json({ success: false, error: "Indexer not initialized" });
      return;
    }
    try {
      const processed = await indexer.processNextBatch();
      res.json({ success: true, message: `Processed ${processed} events`, processed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || "Sync failed" });
    }
  });

  return router;
}
