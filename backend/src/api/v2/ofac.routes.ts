import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import { OfacService } from "../../services/ofac.service.js";
import stellarAddressSchema from "../../validation/stellar.js";

const router = Router();
const ofacService = new OfacService();

const checkAddressParamsSchema = z.object({
  address: stellarAddressSchema,
});

/**
 * GET /api/v2/ofac/check/:address
 * Checks if an address is sanctioned by OFAC
 * Returns check result with sanction status and timestamp
 */
router.get(
  "/check/:address",
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = checkAddressParamsSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        code: "ERR_INVALID_ADDRESS_FORMAT",
        error: "Invalid address format",
      });
      return;
    }

    const { address } = parseResult.data;

    const result = await ofacService.checkAddress(address);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * GET /api/v2/ofac/audit
 * Retrieves OFAC check audit log
 * Query params: limit (default: 100)
 */
router.get(
  "/audit",
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const auditLog = await ofacService.getAuditLog(limit);

    res.json({
      success: true,
      data: auditLog,
    });
  })
);

/**
 * GET /api/v2/ofac/known-sdn
 * Returns list of known SDN addresses (for testing/admin purposes)
 */
router.get(
  "/known-sdn",
  asyncHandler(async (req: Request, res: Response) => {
    const knownSdnAddresses = ofacService.getKnownSdnAddresses();

    res.json({
      success: true,
      data: {
        count: knownSdnAddresses.length,
        addresses: knownSdnAddresses,
      },
    });
  })
);

export default router;
