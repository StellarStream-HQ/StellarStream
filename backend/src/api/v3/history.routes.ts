import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/db.js";
import asyncHandler from "../utils/asyncHandler.js";
import type { Prisma } from "../../generated/client/index.js";
import { fetchStreamsOptimized } from "../../lib/optimized-stream-queries.js";

const router = Router();

const PAGE_SIZE = 50;

const querySchema = z.object({
  asset: z.string().optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  min_total_volume: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
});

/**
 * GET /api/v3/history/:address
 *
 * Returns paginated split history for a sender or receiver address.
 *
 * Query params:
 *   asset           — filter by token address
 *   date_from       — ISO-8601 lower bound (inclusive)
 *   date_to         — ISO-8601 upper bound (inclusive)
 *   min_total_volume — minimum stream amount (as a number, in stroops)
 *   page            — 1-based page number (default: 1, page size: 50)
 */
router.get(
  "/history/:address",
  asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const query = querySchema.parse(req.query);

    const where: Prisma.StreamWhereInput = {
      OR: [{ sender: address }, { receiver: address }],
    };

    if (query.asset) {
      where.tokenAddress = query.asset;
    }

    if (query.date_from || query.date_to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.date_from) createdAt.gte = new Date(query.date_from);
      if (query.date_to) createdAt.lte = new Date(query.date_to);
      where.createdAt = createdAt;
    }

    const skip = (query.page - 1) * PAGE_SIZE;

    // Use optimized query to prevent N+1 issues
    const { streams, total } = await fetchStreamsOptimized({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        streamId: true,
        txHash: true,
        sender: true,
        receiver: true,
        tokenAddress: true,
        amount: true,
        status: true,
        withdrawn: true,
        createdAt: true,
        affiliateId: true,
      },
    });

    // Apply min_total_volume filter in-memory (amount is a string bigint).
    const filtered =
      query.min_total_volume !== undefined
        ? streams.filter(
            (r) =>
              BigInt(r.amount) >=
              BigInt(Math.round(query.min_total_volume! * 1e7)),
          )
        : streams;

    res.json({
      success: true,
      data: {
        address,
        page: query.page,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
        results: filtered,
      },
    });
  }),
);

export default router;
