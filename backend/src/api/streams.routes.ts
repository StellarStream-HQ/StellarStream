import { Router, Request, Response } from "express";
import { z } from "zod";
import { StreamService } from "../services/stream.service";
import {
  CurveTypeInput,
  StreamFeeEstimationService,
} from "../services/stream-fee-estimation.service";
import validateRequest from "../middleware/validateRequest";
import stellarAddressSchema from "../validation/stellar";
import asyncHandler from "../utils/asyncHandler";
import { prisma } from "../lib/db";
import { sanitizeUnknown } from "../security/sanitize.js";

const router = Router();
const streamService = new StreamService();
const streamFeeEstimationService = new StreamFeeEstimationService();

const getStreamsParamsSchema = z.object({
  address: stellarAddressSchema,
});

const exportStreamsParamsSchema = z.object({
  address: stellarAddressSchema,
});

const verifyStreamParamsSchema = z.object({
  streamId: z.string().min(1),
});

const getStreamsQuerySchema = z.object({
  direction: z.enum(["inbound", "outbound"]).optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
  tokens: z.string().optional(),
});

const estimateFeeBodySchema = z.object({
  sender: stellarAddressSchema,
  receiver: stellarAddressSchema,
  token: stellarAddressSchema,
  totalAmount: z.string().regex(/^\d+$/, {
    message: "totalAmount must be an integer string in stroops.",
  }),
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive(),
  curveType: z.enum(["linear", "exponential"]).default("linear"),
  isSoulbound: z.boolean().default(false),
});
interface ExportRow {
  streamId: string;
  token: string;
  amount: string;
  startDate: string;
  endDate: string;
  totalWithdrawn: string;
}

/**
 * GET /api/v1/streams/export/:address
 * Returns downloadable CSV export for a wallet's stream history.
 * Optimized to reduce N+1 queries.
 */
router.get(
  "/streams/export/:address",
  validateRequest({
    params: exportStreamsParamsSchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    // Use optimized service method to get streams with related data
    const streamsWithRelations = await streamService.getStreamsForAddress(address);
    
    const rows: ExportRow[] = streamsWithRelations.map((stream) => {
      const resolvedStreamId = stream.streamId ?? "";
      const eventLog = stream.eventLog;
      const metadata = stream.metadata || {};
      const startDate = resolveStartDate(metadata, eventLog?.ledgerClosedAt);
      const endDate = resolveEndDate(metadata, startDate, stream.duration);

      return {
        streamId: resolvedStreamId,
        token: stream.tokenAddress ?? "",
        amount: stream.amount,
        startDate,
        endDate,
        totalWithdrawn: stream.withdrawn ?? "0",
      };
    });

    const csv = toCsv(rows);
    const filename = `streams-${address}-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.status(200).send(csv);
  })
);

/**
 * GET /api/v1/streams/:address
 * Returns streams for a given address with optional filtering.
 * Query params:
 *   - direction: inbound | outbound (optional)
 *   - status: active | paused | completed (optional)
 *   - tokens: comma-separated token addresses (optional)
 */
router.get(
  "/streams/:address",
  validateRequest({
    params: getStreamsParamsSchema,
    query: getStreamsQuerySchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { direction, status, tokens } = req.query as z.infer<
      typeof getStreamsQuerySchema
    >;

    const filters = {
      ...(direction ? { direction } : {}),
      ...(status ? { status } : {}),
      ...(typeof tokens === "string" && tokens.length > 0
        ? { tokenAddresses: tokens.split(",").map((t) => t.trim()) }
        : {}),
    };

    const streams = await streamService.getStreamsForAddress(
      address,
      filters,
    );

    res.json({
      success: true,
      address,
      count: streams.length,
      filters,
      streams,
    });
  })
);

/**
 * POST /api/v1/streams/estimate-fee
 * Estimates Soroban fee (resource + inclusion) for create_stream in XLM.
 */
router.post(
  "/streams/estimate-fee",
  validateRequest({
    body: estimateFeeBodySchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = sanitizeUnknown(req.body) as z.infer<typeof estimateFeeBodySchema>;

    if (body.endTime <= body.startTime) {
      res.status(400).json({
        success: false,
        error: "endTime must be greater than startTime.",
      });
      return;
    }

    const estimate = await streamFeeEstimationService.estimateCreateStreamFee({
      sender: body.sender,
      receiver: body.receiver,
      token: body.token,
      totalAmount: body.totalAmount,
      startTime: body.startTime,
      endTime: body.endTime,
      curveType: body.curveType as CurveTypeInput,
      isSoulbound: body.isSoulbound,
    });

    res.json({
      success: true,
      estimate,
    });
  })
);
function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function resolveStartDate(
  metadata: Record<string, unknown>,
  ledgerClosedAt?: string
): string {
  const value = metadata.start_time ?? metadata.startTime ?? metadata.timestamp;
  const parsed = toIsoDate(value);
  if (parsed) {
    return parsed;
  }
  return ledgerClosedAt ?? "";
}

function resolveEndDate(
  metadata: Record<string, unknown>,
  startDate: string,
  duration: number | null
): string {
  const value = metadata.end_time ?? metadata.endTime;
  const parsed = toIsoDate(value);
  if (parsed) {
    return parsed;
  }

  if (startDate && typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const startMs = Date.parse(startDate);
    if (!Number.isNaN(startMs)) {
      return new Date(startMs + duration * 1000).toISOString();
    }
  }

  return "";
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    const direct = Date.parse(value);
    if (!Number.isNaN(direct)) {
      return new Date(direct).toISOString();
    }
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber * 1000).toISOString();
    }
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "bigint") {
    return new Date(Number(value) * 1000).toISOString();
  }

  return null;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function toCsv(rows: ExportRow[]): string {
  const header = [
    "Stream ID",
    "Token",
    "Amount",
    "Start Date",
    "End Date",
    "Total Withdrawn",
  ];

  const lines = rows.map((row) =>
    [
      row.streamId,
      row.token,
      row.amount,
      row.startDate,
      row.endDate,
      row.totalWithdrawn,
    ]
      .map((cell) => escapeCsv(cell))
      .join(",")
  );

  return `${header.join(",")}\n${lines.join("\n")}\n`;
}

/**
 * GET /api/v1/streams/verify/:streamId
 * Verifies a stream by fetching its events from the blockchain
 */
router.get(
  "/streams/verify/:streamId",
  validateRequest({
    params: verifyStreamParamsSchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { streamId } = req.params;

    const verificationData = await streamService.verifyStream(streamId);

    if (!verificationData) {
      return res.status(404).json({
        success: false,
        error: "Stream not found or verification failed",
      });
    }

    res.json({
      success: true,
      data: verificationData,
    });
  })
);

export default router;
