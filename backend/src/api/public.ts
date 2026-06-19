import { Request, Response } from 'express';
import { prisma } from '../lib/db.js';
import { searchStreamsOptimized, fetchStreamsOptimized } from '../lib/optimized-stream-queries.js';

const MAX_SEARCH_LIMIT = 50;

/**
 * GET /stats - Aggregate stream statistics (rate-limited).
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
 * GET /search - Search streams with optional filters (rate-limited).
 * Query params: q (search in id, sender, receiver), sender, receiver, limit (cap 50), offset.
 * OPTIMIZED: Uses fetchStreamsOptimized to prevent N+1 queries
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

    // Build optimized query
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

    // Use optimized function that includes related data
    const { streams, total } = await fetchStreamsOptimized({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' }
    });

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
