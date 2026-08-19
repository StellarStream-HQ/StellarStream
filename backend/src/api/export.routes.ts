import { Router, Request, Response } from "express";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import * as XLSX from "xlsx";

const router = Router();

export type ExportFormat = "json" | "csv" | "xlsx" | "pdf" | "qif" | "ofx";

interface ExportRequest {
  format: ExportFormat;
  streamIds?: string[];
  dateRange?: { from: string; to: string };
  includeMetadata?: boolean;
}

/**
 * POST /api/v1/export
 * Create a new data export in the specified format
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { format, streamIds, dateRange, includeMetadata }: ExportRequest = req.body;

    if (!format || !isValidFormat(format)) {
      return res.status(400).json({ success: false, error: "Invalid export format" });
    }

    const whereClause: any = {
      OR: [{ sender: userId }, { receiver: userId }],
    };

    if (streamIds && streamIds.length > 0) {
      whereClause.streamId = { in: streamIds };
    }

    if (dateRange) {
      whereClause.createdAt = {
        gte: new Date(dateRange.from),
        lte: new Date(dateRange.to),
      };
    }

    const streams = await prisma.stream.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    if (streams.length === 0) {
      return res.status(400).json({ success: false, error: "No streams found for export" });
    }

    const exportData = formatExportData(format, streams, includeMetadata);

    // Log the export for audit trail
    await prisma.exportAuditLog.create({
      data: {
        userId,
        streamId: streamIds?.[0] || "multiple",
        format,
        recordCount: streams.length,
        fileSizeBytes: BigInt(JSON.stringify(exportData).length),
        dateRange: dateRange ? `${dateRange.from},${dateRange.to}` : null,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
      },
    });

    const filename = generateFilename(format);
    const mimeType = getMimeType(format);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", mimeType);

    if (format === "xlsx") {
      const buffer = XLSX.write(exportData, { type: "buffer" });
      res.send(buffer);
    } else if (format === "pdf") {
      // PDF export would require pdf generation library
      res.json({
        success: true,
        warning: "PDF export requires server-side PDF generation",
        data: exportData,
      });
    } else {
      res.send(exportData);
    }
  } catch (error) {
    logger.error("Failed to create export", error);

    // Log failed export
    if (req.user?.id) {
      await prisma.exportAuditLog.create({
        data: {
          userId: req.user.id,
          streamId: "unknown",
          format: (req.body?.format || "unknown") as ExportFormat,
          recordCount: 0,
          fileSizeBytes: BigInt(0),
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
      }).catch(err => logger.error("Failed to log export error", err));
    }

    res.status(500).json({ success: false, error: "Failed to create export" });
  }
});

/**
 * GET /api/v1/export/formats
 * Get supported export formats
 */
router.get("/formats", (_req: Request, res: Response) => {
  const formats = [
    {
      id: "json",
      name: "JSON",
      description: "JSON format for data interchange",
      mimeType: "application/json",
    },
    {
      id: "csv",
      name: "CSV",
      description: "Comma-separated values for spreadsheets",
      mimeType: "text/csv",
    },
    {
      id: "xlsx",
      name: "Excel (.xlsx)",
      description: "Microsoft Excel format",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    {
      id: "pdf",
      name: "PDF Report",
      description: "Portable document format",
      mimeType: "application/pdf",
    },
    {
      id: "qif",
      name: "QIF",
      description: "Quicken Interchange Format for accounting",
      mimeType: "text/plain",
    },
    {
      id: "ofx",
      name: "OFX",
      description: "Open Financial Exchange format",
      mimeType: "application/x-ofx",
    },
  ];

  res.json({ success: true, data: formats });
});

/**
 * GET /api/v1/export/audit-logs
 * Get export audit logs for the user
 */
router.get("/audit-logs", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const logs = await prisma.exportAuditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error("Failed to fetch audit logs", error);
    res.status(500).json({ success: false, error: "Failed to fetch audit logs" });
  }
});

// ─── Helper Functions ─────────────────────────────────────────────────────

function isValidFormat(format: string): format is ExportFormat {
  return ["json", "csv", "xlsx", "pdf", "qif", "ofx"].includes(format);
}

function generateFilename(format: ExportFormat): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  const ext = getFileExtension(format);
  return `export_${timestamp}.${ext}`;
}

function getFileExtension(format: ExportFormat): string {
  const extensions: Record<ExportFormat, string> = {
    json: "json",
    csv: "csv",
    xlsx: "xlsx",
    pdf: "pdf",
    qif: "qif",
    ofx: "ofx",
  };
  return extensions[format];
}

function getMimeType(format: ExportFormat): string {
  const mimeTypes: Record<ExportFormat, string> = {
    json: "application/json",
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pdf: "application/pdf",
    qif: "text/plain",
    ofx: "application/x-ofx",
  };
  return mimeTypes[format];
}

function formatExportData(
  format: ExportFormat,
  streams: any[],
  includeMetadata?: boolean
): any {
  switch (format) {
    case "json": {
      return JSON.stringify(
        {
          ...(includeMetadata && {
            exportDate: new Date().toISOString(),
            recordCount: streams.length,
          }),
          streams: streams.map(s => ({
            streamId: s.streamId,
            sender: s.sender,
            receiver: s.receiver,
            amount: s.amount,
            withdrawn: s.withdrawn,
            token: s.tokenAddress,
            status: s.status,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        },
        null,
        2
      );
    }

    case "csv": {
      const headers = [
        "streamId",
        "sender",
        "receiver",
        "amount",
        "withdrawn",
        "token",
        "status",
        "createdAt",
      ];
      const rows = streams.map(s => [
        s.streamId,
        s.sender,
        s.receiver,
        s.amount,
        s.withdrawn,
        s.tokenAddress,
        s.status,
        s.createdAt.toISOString(),
      ]);
      return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    }

    case "xlsx": {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(
        streams.map(s => ({
          "Stream ID": s.streamId,
          Sender: s.sender,
          Receiver: s.receiver,
          Amount: s.amount,
          Withdrawn: s.withdrawn,
          Token: s.tokenAddress,
          Status: s.status,
          "Created At": s.createdAt.toISOString(),
        }))
      );
      XLSX.utils.book_append_sheet(workbook, worksheet, "Streams");
      return workbook;
    }

    case "qif":
      return generateQIF(streams);

    case "ofx":
      return generateOFX(streams);

    case "pdf": {
      return {
        metadata: {
          exportDate: new Date().toISOString(),
          recordCount: streams.length,
        },
        content: streams,
      };
    }

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

function generateQIF(streams: any[]): string {
  let qif = "!Type:Bank\n";

  for (const stream of streams) {
    qif += `^${stream.streamId}~\n`;
    qif += `!Type:Bank\n`;
    qif += `D${new Date(stream.createdAt).toLocaleDateString("en-US")}\n`;
    qif += `T-${parseFloat(stream.amount) / 10000000}\n`;
    qif += `P${stream.receiver}\n`;
    qif += `^\n`;
  }

  return qif;
}

function generateOFX(streams: any[]): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);

  let ofx = `OFXHEADER:100
OFXVER:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEFORMAT:NO
NEWFILEFORMAT:YES
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${timestamp}
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRS>
<CURDEF>USD
<BANKTRANLIST>
<DTSTART>${timestamp}
<DTEND>${timestamp}
`;

  for (const stream of streams) {
    ofx += `<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>${new Date(stream.createdAt)
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 8)}
<TRNAMT>-${parseFloat(stream.amount) / 10000000}
<FITID>${stream.streamId}
<NAME>${stream.receiver}
</STMTTRN>
`;
  }

  ofx += `</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>0
<DTASOF>${timestamp}
</LEDGERBAL>
</STMTTRS>
</BANKMSGSRSV1>
</OFX>`;

  return ofx;
}

export default router;
