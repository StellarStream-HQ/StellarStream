import { Router, Request, Response } from "express";
import { z } from "zod";
import { GasTankService } from "../services/gas-tank.service.js";
import validateRequest from "../middleware/validateRequest.js";
import asyncHandler from "../utils/asyncHandler.js";

const router = Router();
const gasTankService = new GasTankService();

const gasTankParamsSchema = z.object({
  streamId: z.string().min(1, "streamId is required"),
});

/**
 * GET /api/v1/streams/:streamId/gas-tank
 *
 * Returns the burn rate and depletion forecast for a stream's gas tank
 * (the XLM balance covering ongoing Soroban storage-rent fees).
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     streamId: string,
 *     gasTankBalanceStroops: string,
 *     gasTankBalanceXlm: string,
 *     burnRatePerLedgerStroops: string,
 *     burnRatePerSecondStroops: string,
 *     burnRatePerDayStroops: string,
 *     burnRatePerDayXlm: string,
 *     estimatedLedgersRemaining: string | null,
 *     estimatedSecondsRemaining: number | null,
 *     estimatedDepletionAt: string | null,   // ISO-8601
 *     isCritical: boolean,                   // < 7 days runway
 *     isDepleted: boolean,
 *     streamEndTime: number | null,          // Unix timestamp
 *     effectiveEndAt: string | null          // ISO-8601, min(depletion, streamEnd)
 *   }
 * }
 */
router.get(
  "/streams/:streamId/gas-tank",
  validateRequest({ params: gasTankParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { streamId } = req.params;

    const data = await gasTankService.getGasTankStatus(streamId);

    res.json({ success: true, data });
  })
);

export default router;
