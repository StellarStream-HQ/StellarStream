import { Request, Response } from 'express';
import { prisma } from '../lib/db.js';

const MAX_SEARCH_LIMIT = 50;

/**
 * @swagger
 * /api/v1/stats:
 *   get:
 *     summary: Get aggregate stream statistics
 *     description: Returns global protocol statistics including total streams, unique participants, TVL, and active stream count. This endpoint is rate-limited.
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Statistics returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               totalStreams: 1042
 *               uniqueSenders: 318
 *               uniqueReceivers: 524
 *               globalTvl: "98540000000"
 *               activeStreams: 204
 *               tvlRefreshedAt: "2024-06-01T12:00:00.000Z"
 *       429:
 *         description: Rate limited
 *         content:
 *           application/json:
 *             example:
 *               error: Too Many Requests
 *       500:
 *         description: Failed to compute stats
 *         content:
 *           application/json:
 *             example:
 *               error: Internal Server Error
 *               message: Failed to compute stats.
 */
export async function getStats(_req: Request, res: Response): Promise<void> {
  try {
    const [totalStreams, bySenderCount, byReceiverCount, tvlSnapshot] = await Promise.all([
      prisma.stream.count(),
      prisma.stream.groupBy({
        by: ['sender'],
        _count: { id: true },
      }),
      prisma.stream.groupBy({
        by: ['receiver'],
        _count: { id: true },
      }),
      getGlobalTvlSnapshot(),
    ]);

    const uniqueSenders = bySenderCount.length;
    const uniqueReceivers = byReceiverCount.length;

    res.json({
      totalStreams,
      uniqueSenders,
      uniqueReceivers,
      globalTvl: tvlSnapshot.totalActiveAmount,
      activeStreams: tvlSnapshot.activeStreamCount,
      tvlRefreshedAt: tvlSnapshot.refreshedAt,
    });
  } catch (err) {
    console.error('[GET /stats]', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to compute stats.',
    });
  }
}

async function getGlobalTvlSnapshot(): Promise<{
  totalActiveAmount: string;
  activeStreamCount: number;
  refreshedAt: string | null;
}> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      totalActiveAmount: string;
      activeStreamCount: bigint | number;
      refreshedAt: Date | string | null;
    }>>`
      SELECT
        "totalActiveAmount",
        "activeStreamCount",
        "refreshedAt"
      FROM "GlobalTvlView"
      WHERE "id" = 1
    `;

    const row = rows[0];
    if (row) {
      return {
        totalActiveAmount: row.totalActiveAmount,
        activeStreamCount: Number(row.activeStreamCount),
        refreshedAt: row.refreshedAt ? new Date(row.refreshedAt).toISOString() : null,
      };
    }
  } catch {
    // Fall back to a live aggregate when the materialized view is unavailable.
  }

  const fallback = await prisma.$queryRaw<Array<{
    totalActiveAmount: string;
    activeStreamCount: bigint | number;
  }>>`
    SELECT
      COALESCE(SUM(CASE WHEN "status" = 'ACTIVE' THEN "amount"::numeric ELSE 0 END), 0)::text AS "totalActiveAmount",
      COUNT(*) FILTER (WHERE "status" = 'ACTIVE') AS "activeStreamCount"
    FROM "Stream"
  `;

  const row = fallback[0] ?? { totalActiveAmount: "0", activeStreamCount: 0 };
  return {
    totalActiveAmount: row.totalActiveAmount,
    activeStreamCount: Number(row.activeStreamCount),
    refreshedAt: null,
  };
}

/**
 * @swagger
 * /api/v1/search:
 *   get:
 *     summary: Search streams
 *     description: Search streams by a general query string or by specific sender/receiver addresses. Supports pagination. This endpoint is rate-limited.
 *     tags: [Public]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *           example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *         description: General search term matched against stream ID, sender, and receiver
 *       - in: query
 *         name: sender
 *         schema:
 *           type: string
 *           example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *         description: Filter by sender address (partial match)
 *       - in: query
 *         name: receiver
 *         schema:
 *           type: string
 *           example: GBBB...
 *         description: Filter by receiver address (partial match)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *         description: Number of results to return (max 50)
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of results to skip for pagination
 *     responses:
 *       200:
 *         description: Search results returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               streams:
 *                 - streamId: stream-001
 *                   sender: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *                   receiver: GBBB...
 *                   amount: "5000000"
 *                   status: active
 *               total: 1
 *               limit: 20
 *               offset: 0
 *       429:
 *         description: Rate limited
 *         content:
 *           application/json:
 *             example:
 *               error: Too Many Requests
 *       500:
 *         description: Search failed
 *         content:
 *           application/json:
 *             example:
 *               error: Internal Server Error
 *               message: Search failed.
 */
export async function getSearch(req: Request, res: Response): Promise<void> {
  try {
    const rawLimit = req.query.limit;
    const limit = Math.min(
      Math.max(1, parseInt(String(rawLimit), 10) || 20),
      MAX_SEARCH_LIMIT
    );
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sender = typeof req.query.sender === 'string' ? req.query.sender.trim() : '';
    const receiver = typeof req.query.receiver === 'string' ? req.query.receiver.trim() : '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (sender) {
      where.sender = { contains: sender, mode: 'insensitive' };
    }
    if (receiver) {
      where.receiver = { contains: receiver, mode: 'insensitive' };
    }
    if (q) {
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { sender: { contains: q, mode: 'insensitive' } },
        { receiver: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [streams, total] = await Promise.all([
      prisma.stream.findMany({
        where,
        take: limit,
        skip: offset,
      }),
      prisma.stream.count({ where }),
    ]);

    res.json({
      streams,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[GET /search]', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Search failed.',
    });
  }
}
