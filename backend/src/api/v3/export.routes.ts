import { Router, Request, Response } from "express";
import { z, ZodError } from "zod";
import { prisma } from "../../lib/db.js";
import asyncHandler from "../../utils/asyncHandler.js";
import {
  generateSplitAuditPDF,
  generateSplitAuditXLSX,
} from "../../services/split-audit-export.service.js";

const router = Router();

const querySchema = z.object({
  format: z.enum(["pdf", "xlsx"]).default("pdf"),
});

/**
 * GET /api/v3/export/:tx_hash
 *
 * Generates a professional split-audit report for a single disbursement event.
 * Includes TX hash, timestamp, sender, asset, and a per-recipient breakdown.
 *
 * Query params:
 *   format — "pdf" (default) or "xlsx"
 *
 * Responses:
 *   200 application/pdf  — PDF binary when format=pdf
 *   200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet — XLSX binary when format=xlsx
 *   400 — invalid query params
 *   404 — disbursement not found for the given tx_hash
 */
router.get(
  "/export/:tx_hash",
  asyncHandler(async (req: Request, res: Response) => {
    const { tx_hash } = req.params;

    let format: "pdf" | "xlsx";
    try {
      ({ format } = querySchema.parse(req.query));
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ success: false, error: err.issues[0]?.message ?? "Invalid query params", code: "INVALID_PARAMS" });
        return;
      }
      throw err;
    }

    const disbursement = await prisma.disbursement.findUnique({
      where: { txHash: tx_hash },
      include: {
        recipients: {
          select: {
            recipientAddress: true,
            amount: true,
            status: true,
          },
        },
      },
    });

    if (!disbursement) {
      res.status(404).json({
        success: false,
        error: "Disbursement not found",
        code: "NOT_FOUND",
      });
      return;
    }

    const auditData = {
      txHash:        disbursement.txHash,
      sender:        disbursement.sender,
      receiver:      disbursement.receiver,
      amount:        disbursement.amount,
      tokenAddress:  disbursement.tokenAddress,
      createdAt:     disbursement.createdAt,
      recipients:    disbursement.recipients.map((r: any) => ({
        recipientAddress: r.recipientAddress,
        amount:           r.amount,
        status:           r.status,
      })),
    };

    if (format === "xlsx") {
      const buffer = await generateSplitAuditXLSX(auditData);
      const filename = `split-audit-${tx_hash.slice(0, 16)}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
      return;
    }

    const buffer = await generateSplitAuditPDF(auditData);
    const filename = `split-audit-${tx_hash.slice(0, 16)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  }),
);

export default router;
