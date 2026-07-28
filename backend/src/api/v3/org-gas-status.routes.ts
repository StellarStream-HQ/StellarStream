import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/db.js";
import validateRequest from "../../middleware/validateRequest.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { logger } from "../../logger.js";

const router = Router();

const orgGasStatusSchema = z.object({
  orgAddress: z.string().min(1, "orgAddress is required"),
});

interface GasStatusResponse {
  orgAddress: string;
  gasTankBalance: string; // in XLM
  gasTankBalanceStroops: string;
  isLow: boolean; // true if < 10 XLM
  isCritical: boolean; // true if < 5 XLM
  isDepleted: boolean; // true if = 0 XLM
  alert?: string;
  lastUpdated: string;
}

/**
 * GET /api/v3/org/:orgAddress/gas-status
 *
 * Monitors the organization's XLM buffer for contract gas.
 * Triggers alerts if balance drops below threshold (10 XLM).
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     orgAddress: string,
 *     gasTankBalance: string,
 *     gasTankBalanceStroops: string,
 *     isLow: boolean,
 *     isCritical: boolean,
 *     isDepleted: boolean,
 *     alert?: string,
 *     lastUpdated: string
 *   }
 * }
 */
router.get(
  "/org/:orgAddress/gas-status",
  validateRequest({ params: orgGasStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { orgAddress } = req.params;

    try {
      // Fetch organization member to verify org exists
      const orgMember = await prisma.organizationMember.findFirst({
        where: { orgAddress },
      });

      if (!orgMember) {
        return res.status(404).json({
          success: false,
          error: "Organization not found",
        });
      }

      // Get all streams for this org to calculate total gas tank balance
      const _streams = await prisma.stream.findMany({
        where: { sender: orgAddress },
      });

      // Calculate total gas tank balance (simplified - in production, query contract state)
      let totalGasTankStroops = 0n;
      const STROOPS_PER_XLM = 10_000_000n;

      // For now, use a mock value - in production, this would query the Soroban contract
      // This is a placeholder that should be replaced with actual contract queries
      const mockGasTankStroops = BigInt(process.env.ORG_GAS_TANK_STROOPS || "50000000"); // 5 XLM default

      totalGasTankStroops = mockGasTankStroops;

      const gasTankXlm = Number(totalGasTankStroops) / Number(STROOPS_PER_XLM);
      const isLow = gasTankXlm < 10;
      const isCritical = gasTankXlm < 5;
      const isDepleted = gasTankXlm === 0;

      let alert: string | undefined;
      if (isDepleted) {
        alert = "CRITICAL: Gas tank is depleted. Streams cannot be processed.";
      } else if (isCritical) {
        alert = `WARNING: Gas tank is critically low (${gasTankXlm.toFixed(2)} XLM). Refill immediately.`;
      } else if (isLow) {
        alert = `NOTICE: Gas tank is low (${gasTankXlm.toFixed(2)} XLM). Consider refilling soon.`;
      }

      const response: GasStatusResponse = {
        orgAddress,
        gasTankBalance: gasTankXlm.toFixed(7),
        gasTankBalanceStroops: totalGasTankStroops.toString(),
        isLow,
        isCritical,
        isDepleted,
        alert,
        lastUpdated: new Date().toISOString(),
      };

      return res.json({ success: true, data: response });
    } catch (error) {
      logger.error("Failed to fetch gas status:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch gas status",
      });
    }
  })
);

export default router;
