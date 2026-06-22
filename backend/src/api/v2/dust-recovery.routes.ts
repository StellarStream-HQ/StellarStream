/**
 * Dust Recovery API Routes (Issue #1182)
 *
 * GET  /api/v2/dust/recommendations  — Analyze all accounts for XLM dust < 1 XLM
 * POST /api/v2/dust/recover          — Execute dust recovery for given stream IDs
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import { DustRecoveryService } from "../../services/dust-recovery.service.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { logger } from "../../logger.js";

const router = Router();
const dustRecoveryService = new DustRecoveryService();

// ── GET /api/v2/dust/recommendations ─────────────────────────────────────────

/**
 * @openapi
 * /api/v2/dust/recommendations:
 *   get:
 *     summary: Analyze all accounts for XLM dust
 *     description: >
 *       Scans every active/paused XLM stream and identifies those with a
 *       remaining balance below 1 XLM (10,000,000 stroops). Groups results
 *       by sender and returns a prioritized list of recovery recommendations.
 *     tags: [Dust Recovery]
 *     responses:
 *       200:
 *         description: Dust recommendations computed successfully
 *       500:
 *         description: Internal error during scan
 */
router.get(
  "/recommendations",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await dustRecoveryService.getRecommendations();
    res.json(result);
  }),
);

// ── POST /api/v2/dust/recover ─────────────────────────────────────────────────

const recoverBodySchema = z.object({
  /** DB record IDs of streams to recover */
  streamIds: z
    .array(z.string().min(1))
    .min(1, "At least one stream ID is required")
    .max(500, "Maximum 500 streams per recovery request"),
  /** Stellar address of the operator — used for the audit trail */
  executedBy: z
    .string()
    .length(56)
    .regex(/^G/, "Must be a valid Stellar G-address"),
});

/**
 * @openapi
 * /api/v2/dust/recover:
 *   post:
 *     summary: Execute dust recovery for specified streams
 *     description: >
 *       Marks the specified streams as CANCELED and logs a dust_recovery audit
 *       event for each one. The caller is responsible for submitting the
 *       corresponding on-chain cancel transactions.
 *     tags: [Dust Recovery]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [streamIds, executedBy]
 *             properties:
 *               streamIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 maxItems: 500
 *               executedBy:
 *                 type: string
 *                 description: Stellar G-address of the requesting operator
 *     responses:
 *       200:
 *         description: Recovery summary
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal error during recovery
 */
router.post(
  "/recover",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parse = recoverBodySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        code: "ERR_INVALID_RECOVERY_BODY",
        error: parse.error.errors.map((e) => e.message).join("; "),
        details: parse.error.errors,
      });
      return;
    }

    const { streamIds, executedBy } = parse.data;
    logger.info(`[DustRecovery] POST /recover — ${streamIds.length} streams by ${executedBy}`);

    const result = await dustRecoveryService.recoverDust(streamIds, executedBy);
    res.json(result);
  }),
);

export default router;
