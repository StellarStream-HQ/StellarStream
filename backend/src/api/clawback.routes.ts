/**
 * Clawback API Routes — POST /api/v2/streams/:id/clawback
 *
 * Provides:
 *  - POST /api/v2/streams/:id/clawback — execute a clawback on a stream
 *  - GET  /api/v2/streams/:id/clawback/status — check clawback eligibility
 *  - GET  /api/v2/streams/:id/clawback/history — view clawback history
 */

import { Router, Request, Response } from "express";
import { getClawbackService } from "../services/clawback.service.js";
import { logger } from "../logger.js";

const router = Router();

// ── POST /api/v2/streams/:id/clawback ─────────────────────────────────────

/**
 * Execute a clawback on a stream.
 *
 * Request body (JSON):
 *   { "amount": "10000000", "reason": "Fraudulent activity detected", "txHash": "abc..." }
 *
 * Responses:
 *   200 — Clawback executed successfully
 *   400 — Validation failed (errors array in body)
 *   404 — Stream not found
 *   500 — Internal server error
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const { amount, reason, txHash } = req.body;

    const service = getClawbackService();

    // Validate first
    const validation = await service.validateClawback(streamId, amount);

    if (!validation.valid) {
      res.status(400).json({
        success: false,
        message: "Clawback validation failed",
        errors: validation.errors,
        warnings: validation.warnings,
      });
      return;
    }

    // Execute
    const record = await service.executeClawback({
      streamId,
      amount,
      reason,
      txHash,
    });

    res.json({
      success: true,
      message: "Clawback executed successfully",
      data: record,
      warnings: validation.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Clawback execution failed", error, { path: req.path, body: req.body });

    // If the error is validation-related, return 400
    if (message.includes("validation failed") || message.includes("not found")) {
      res.status(400).json({
        success: false,
        message,
        errors: [message],
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      errors: [message],
    });
  }
});

// ── GET /api/v2/streams/:id/clawback/status ───────────────────────────────

/**
 * Check clawback eligibility for a stream.
 *
 * Responses:
 *   200 — { canClawback, maxAmount, warnings }
 *   404 — Stream not found
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const service = getClawbackService();

    const canClawback = await service.canClawback(streamId);
    const maxAmount = await service.getMaxClawbackAmount(streamId);
    const validation = await service.validateClawback(streamId, "0");

    res.json({
      success: true,
      data: {
        streamId,
        canClawback,
        maxAmount,
        warnings: validation.warnings,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Clawback status check failed", error, { path: req.path });

    if (message.includes("not found")) {
      res.status(404).json({
        success: false,
        message,
        errors: [message],
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      errors: [message],
    });
  }
});

// ── GET /api/v2/streams/:id/clawback/history ──────────────────────────────

/**
 * Get clawback history for a stream.
 *
 * Responses:
 *   200 — Array of clawback records
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;
    const service = getClawbackService();

    const history = await service.getClawbackHistory(streamId);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Clawback history fetch failed", error, { path: req.path });

    res.status(500).json({
      success: false,
      message: "Internal server error",
      errors: [message],
    });
  }
});

export default router;