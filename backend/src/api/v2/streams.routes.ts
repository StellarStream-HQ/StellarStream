import { Router, Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../utils/asyncHandler.js";
import { StreamService } from "../../services/stream.service.js";
import { ExportService } from "../../services/export.service.js";
import stellarAddressSchema from "../../validation/stellar.js";
import { prisma } from "../../lib/db.js";
import { requireOfacCheck } from "../../middleware/requireOfacCheck.js";

const router = Router();
const streamService = new StreamService();
const exportService = new ExportService();

const getStreamsParamsSchema = z.object({
  address: stellarAddressSchema,
});

/**
 * GET /api/v2/streams/:address
 * Fetches V1 and V2 streams for a user, sorted by status.
 * Returns { success: true, data: { v1: [...], v2: [...] } } via middleware.
 */
router.get(
  "/:address",
  asyncHandler(async (req: Request, res: Response) => {
    // Validate address
    const parseResult = getStreamsParamsSchema.safeParse(req.params);
    if (!parseResult.success) {
      res.status(400).json({
        code: "ERR_INVALID_ADDRESS_FORMAT",
        error: "Invalid address format",
      });
      return;
    }
    const { address } = parseResult.data;

    // Fetch all current streams (assume all are v1 for now)
    const streams = await streamService.getStreamsForAddress(address);

    // Sort by status
    const statusOrder = { ACTIVE: 1, PAUSED: 2, COMPLETED: 3, CANCELED: 4 };
    streams.sort((a, b) => {
      const aRank = statusOrder[a.status as keyof typeof statusOrder] || 10;
      const bRank = statusOrder[b.status as keyof typeof statusOrder] || 10;
      return aRank - bRank;
    });

    // Provide empty array for v2 as placeholder for future Nebula features
    res.json({
      v1: streams,
      v2: [],
    });
  }),
);

const patchStreamPrivacySchema = z.object({
  isPrivate: z.boolean(),
});

/**
 * PATCH /api/v2/streams/:id/privacy
 * Toggles the privacy of a stream.
 */
router.patch(
  "/:id/privacy",
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = patchStreamPrivacySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        code: "ERR_INVALID_PRIVACY_BODY",
        error: "Invalid body. 'isPrivate' boolean is required.",
      });
      return;
    }

    const streamId = req.params.id;
    const { isPrivate } = parseResult.data;

    const updated = await prisma.stream.update({
      where: { id: streamId },
      data: { isPrivate },
    });

    res.json({ success: true, data: updated });
  }),
);

const exportFormatSchema = z.enum(["csv", "json"]).default("csv");

/**
 * GET /api/v2/streams/:id/export
 * Exports stream audit log as CSV or JSON for tax/accounting purposes.
 * Query param: format=csv|json (default: csv)
 */
router.get(
    "/:id/export",
    asyncHandler(async (req: Request, res: Response) => {
        const streamId = req.params.id;
        const formatResult = exportFormatSchema.safeParse(req.query.format);
        const format = formatResult.success ? formatResult.data : "csv";

        // Verify stream exists
        const stream = await prisma.stream.findUnique({
            where: { id: streamId },
        });

        if (!stream) {
            res.status(404).json({ error: "Stream not found" });
            return;
        }

        let data: string;
        let contentType: string;
        let filename: string;

        if (format === "json") {
            data = await exportService.exportStreamAsJSON(streamId);
            contentType = "application/json";
            filename = `stream-${streamId}-audit-log.json`;
        } else {
            data = await exportService.exportStreamAsCSV(streamId);
            contentType = "text/csv";
            filename = `stream-${streamId}-audit-log.csv`;
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(data);
    })
);

export default router;
