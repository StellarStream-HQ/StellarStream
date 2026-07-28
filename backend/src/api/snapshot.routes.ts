/**
 * Snapshot API Routes
 * Endpoints for managing stream snapshots and archives
 */

import { Router, Request, Response } from "express";
// import { SnapshotService } from "../services/snapshot.service";
// import { runMaintenanceNow } from "../services/snapshot.scheduler";
import { logger } from "../logger.js";

const router = Router();
const snapshotService = new SnapshotService();

/**
 * POST /api/v1/snapshots/maintenance
 * Manually trigger snapshot maintenance
 */
router.post("/maintenance", async (_req: Request, res: Response) => {
  try {
    const result = await runMaintenanceNow();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Manual maintenance trigger failed", error);
    res.status(500).json({
      success: false,
      error: "Failed to run maintenance",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId
 * Get all snapshots for a stream
 */
router.get("/:streamId", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const snapshots = await snapshotService.getStreamSnapshots(streamId);
    
    res.json({
      success: true,
      data: snapshots,
    });
  } catch (error) {
    logger.error("Failed to fetch snapshots", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch snapshots",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/:month
 * Get snapshot for a specific month
 */
router.get("/:streamId/:month", async (req: Request, res: Response): Promise<void> => {
  try {
    const { streamId, month } = req.params;
    const snapshot = await snapshotService.getSnapshot(streamId, month);
    
    if (!snapshot) {
      res.status(404).json({
        success: false,
        error: "Snapshot not found",
      });
      return;
    }
    
    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error("Failed to fetch snapshot", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch snapshot",
    });
  }
});

/**
 * GET /api/v1/snapshots/:streamId/archive
 * Get archived logs for a stream
 */
router.get("/:streamId/archive", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const archives = await snapshotService.getArchivedLogs(streamId);
    
    res.json({
      success: true,
      data: archives,
    });
  } catch (error) {
    logger.error("Failed to fetch archived logs", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch archived logs",
    });
  }
});

export default router;
