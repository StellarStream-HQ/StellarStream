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
 * @swagger
 * /streams/export/{address}:
 *   get:
 *     summary: Export stream history as CSV
 *     description: Returns a downloadable CSV file containing all streams for the given Stellar address (as sender or receiver).
 *     tags: [Streams]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *         description: Stellar G-address of the wallet
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *             example: |
 *               Stream ID,Token,Amount,Start Date,End Date,Total Withdrawn
 *               stream-123,GABC...,1000000,2024-01-01T00:00:00.000Z,2024-12-31T00:00:00.000Z,500000
 *       400:
 *         description: Invalid Stellar address
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Invalid address format
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Internal server error
 */
router.get(
  "/streams/export/:address",
  validateRequest({
    params: exportStreamsParamsSchema,
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const streams = await prisma.stream.findMany({
      where: {
        OR: [{ sender: address }, { receiver: address }],
      },
      select: {
        streamId: true,
        tokenAddress: true,
        amount: true,
        withdrawn: true,
        duration: true,
      },
      orderBy: {
        streamId: "desc",
      },
    });

    const streamIds = streams
      .map((stream) => stream.streamId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const createEvents = streamIds.length
      ? await prisma.eventLog.findMany({
          where: {
            eventType: "create",
            streamId: {
              in: streamIds,
            },
          },
          select: {
            streamId: true,
            ledgerClosedAt: true,
            metadata: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        })
      : [];

    const createEventByStreamId = new Map<
      string,
      { ledgerClosedAt: string; metadata: string | null }
    >();
    for (const event of createEvents) {
      if (!createEventByStreamId.has(event.streamId)) {
        createEventByStreamId.set(event.streamId, {
          ledgerClosedAt: event.ledgerClosedAt,
          metadata: event.metadata,
        });
      }
    }

    const rows: ExportRow[] = streams.map((stream) => {
      const resolvedStreamId = stream.streamId ?? "";
      const event = createEventByStreamId.get(resolvedStreamId);
      const metadata = parseMetadata(event?.metadata ?? null);
      const startDate = resolveStartDate(metadata, event?.ledgerClosedAt);
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
 * @swagger
 * /streams/{address}:
 *   get:
 *     summary: Get streams for a Stellar address
 *     description: Returns all streams associated with the given Stellar address, with optional filtering by direction, status, and token.
 *     tags: [Streams]
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *           example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *         description: Stellar G-address of the wallet
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [inbound, outbound]
 *         description: Filter by stream direction relative to the address
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, paused, completed]
 *         description: Filter by stream status
 *       - in: query
 *         name: tokens
 *         schema:
 *           type: string
 *           example: GABC...,GDEF...
 *         description: Comma-separated list of token contract addresses to filter by
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               address: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *               count: 2
 *               filters:
 *                 direction: inbound
 *                 status: active
 *               streams:
 *                 - streamId: stream-001
 *                   sender: GABC...
 *                   receiver: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *                   amount: "5000000"
 *                   status: active
 *       400:
 *         description: Invalid address or query parameters
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Invalid Stellar address
 *       404:
 *         description: Address not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Address not found
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Internal server error
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
 * @swagger
 * /streams/estimate-fee:
 *   post:
 *     summary: Estimate Soroban fee for creating a stream
 *     description: Estimates the Soroban resource + inclusion fee (in XLM) for invoking the create_stream contract function.
 *     tags: [Streams]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sender, receiver, token, totalAmount, startTime, endTime]
 *             properties:
 *               sender:
 *                 type: string
 *                 example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *               receiver:
 *                 type: string
 *                 example: GBBB...
 *               token:
 *                 type: string
 *                 example: GCCC...
 *               totalAmount:
 *                 type: string
 *                 description: Integer string in stroops
 *                 example: "10000000"
 *               startTime:
 *                 type: integer
 *                 description: Unix timestamp (seconds)
 *                 example: 1700000000
 *               endTime:
 *                 type: integer
 *                 description: Unix timestamp (seconds), must be > startTime
 *                 example: 1730000000
 *               curveType:
 *                 type: string
 *                 enum: [linear, exponential]
 *                 default: linear
 *               isSoulbound:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Fee estimate returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               estimate:
 *                 fee: "0.00501"
 *                 feeStroops: "501"
 *       400:
 *         description: Invalid request body or endTime <= startTime
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: endTime must be greater than startTime.
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: totalAmount must be an integer string in stroops.
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Internal server error
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
 * @swagger
 * /streams/verify/{streamId}:
 *   get:
 *     summary: Verify a stream by ID
 *     description: Fetches and verifies a stream's on-chain event history to confirm its integrity.
 *     tags: [Streams]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *           example: stream-001
 *         description: The unique stream identifier
 *     responses:
 *       200:
 *         description: Stream verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               data:
 *                 streamId: stream-001
 *                 status: active
 *                 events:
 *                   - eventType: create
 *                     txHash: abc123
 *                     ledgerClosedAt: "2024-01-01T00:00:00.000Z"
 *       404:
 *         description: Stream not found or verification failed
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Stream not found or verification failed
 *       400:
 *         description: Invalid stream ID
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Invalid stream ID
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Internal server error
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
      res.status(404).json({
        success: false,
        error: "Stream not found or verification failed",
      });
      return;
    }

    res.json({
      success: true,
      data: verificationData,
    });
  })
);

export default router;
