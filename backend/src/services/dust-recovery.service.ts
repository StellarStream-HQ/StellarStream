/**
 * Dust Recovery Optimization Service (Issue #1182)
 *
 * Analyzes all user accounts for XLM dust (balances < 1 XLM that cannot be
 * streamed) and generates consolidation recommendations. Optionally executes
 * recovery by merging small dust streams into a single sweep transaction.
 *
 * Key concepts:
 *   - "Dust" here means a stream's remaining unstreamed XLM balance is below
 *     MIN_STREAMABLE_XLM (1 XLM = 10_000_000 stroops).
 *   - A "recommendation" groups all dust streams for a given sender + token
 *     and suggests either: cancel+refund, merge-and-reopen, or simply flag.
 *   - Recovery marks dust streams CANCELED in the DB and records a recovery
 *     audit entry so the operation is traceable.
 */

import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** 1 XLM in stroops */
const STROOPS_PER_XLM = 10_000_000n;

/** Streams with a remaining balance below this threshold are considered dust */
const MIN_STREAMABLE_STROOPS = STROOPS_PER_XLM; // 1 XLM

/** How many streams to fetch per page during the account scan */
const SCAN_PAGE_SIZE = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecoveryStrategy = "cancel_and_refund" | "merge_and_reopen" | "flag_only";

export interface DustStreamInfo {
  streamDbId: string;
  streamId: string | null;
  sender: string;
  receiver: string;
  tokenAddress: string | null;
  /** Original stream amount in stroops */
  amount: string;
  /** Already-withdrawn amount in stroops */
  withdrawn: string;
  /** Remaining balance = amount - withdrawn, in stroops */
  remainingStroops: string;
  /** Remaining balance in XLM (human-readable) */
  remainingXlm: string;
  status: string;
}

export interface DustRecommendation {
  /** Unique key: `${sender}::${tokenAddress ?? "native"}` */
  groupKey: string;
  sender: string;
  tokenAddress: string | null;
  dustStreams: DustStreamInfo[];
  totalDustStroops: string;
  totalDustXlm: string;
  streamCount: number;
  /** Recommended action for this group */
  strategy: RecoveryStrategy;
  reason: string;
}

export interface RecommendationsResult {
  scannedStreams: number;
  dustStreamsFound: number;
  affectedAccounts: number;
  recommendations: DustRecommendation[];
  generatedAt: string;
}

export interface RecoveryResult {
  recovered: number;
  skipped: number;
  errors: number;
  details: Array<{
    streamDbId: string;
    status: "recovered" | "skipped" | "error";
    reason?: string;
  }>;
  executedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole}.${frac.toString().padStart(7, "0")}`;
}

function remainingBalance(amount: string, withdrawn: string): bigint {
  const a = BigInt(amount ?? "0");
  const w = BigInt(withdrawn ?? "0");
  return a > w ? a - w : 0n;
}

function pickStrategy(
  dustStreams: DustStreamInfo[],
  totalDustStroops: bigint,
): { strategy: RecoveryStrategy; reason: string } {
  if (dustStreams.length >= 2 && totalDustStroops >= MIN_STREAMABLE_STROOPS) {
    return {
      strategy: "merge_and_reopen",
      reason: `${dustStreams.length} dust streams total ${stroopsToXlm(totalDustStroops)} XLM — consolidate into one new stream`,
    };
  }
  if (totalDustStroops > 0n) {
    return {
      strategy: "cancel_and_refund",
      reason: `${stroopsToXlm(totalDustStroops)} XLM dust — cancel and return to sender`,
    };
  }
  return {
    strategy: "flag_only",
    reason: "Zero remaining balance — safe to archive",
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DustRecoveryService {
  /**
   * Scan all ACTIVE/PAUSED streams and identify those whose remaining balance
   * is below MIN_STREAMABLE_STROOPS (1 XLM). Groups them by sender + token
   * and emits one DustRecommendation per group.
   *
   * Uses cursor-based pagination to handle large datasets without loading
   * the full Stream table into memory.
   */
  async getRecommendations(): Promise<RecommendationsResult> {
    logger.info("[DustRecovery] Starting dust scan across all accounts");

    const dustMap = new Map<string, DustStreamInfo[]>();
    let scannedStreams = 0;
    let cursor: string | undefined;

    while (true) {
      const page = await prisma.stream.findMany({
        where: {
          status: { in: ["ACTIVE", "PAUSED"] },
          // Only streams using native XLM or no token (null = XLM)
          // Non-XLM tokens use different decimal scales; we focus on XLM dust
          tokenAddress: null,
        },
        select: {
          id: true,
          streamId: true,
          sender: true,
          receiver: true,
          tokenAddress: true,
          amount: true,
          withdrawn: true,
          status: true,
        },
        orderBy: { id: "asc" },
        take: SCAN_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (page.length === 0) break;

      scannedStreams += page.length;
      cursor = page[page.length - 1].id;

      for (const stream of page) {
        const remaining = remainingBalance(stream.amount, stream.withdrawn ?? "0");
        if (remaining >= MIN_STREAMABLE_STROOPS) continue;

        const groupKey = `${stream.sender}::${stream.tokenAddress ?? "native"}`;
        const info: DustStreamInfo = {
          streamDbId: stream.id,
          streamId: stream.streamId,
          sender: stream.sender,
          receiver: stream.receiver,
          tokenAddress: stream.tokenAddress,
          amount: stream.amount,
          withdrawn: stream.withdrawn ?? "0",
          remainingStroops: remaining.toString(),
          remainingXlm: stroopsToXlm(remaining),
          status: stream.status,
        };

        const existing = dustMap.get(groupKey) ?? [];
        existing.push(info);
        dustMap.set(groupKey, existing);
      }

      if (page.length < SCAN_PAGE_SIZE) break;
    }

    const recommendations: DustRecommendation[] = [];

    for (const [groupKey, streams] of dustMap) {
      const totalDust = streams.reduce(
        (acc, s) => acc + BigInt(s.remainingStroops),
        0n,
      );
      const { strategy, reason } = pickStrategy(streams, totalDust);
      const [sender, rawToken] = groupKey.split("::");

      recommendations.push({
        groupKey,
        sender,
        tokenAddress: rawToken === "native" ? null : rawToken,
        dustStreams: streams,
        totalDustStroops: totalDust.toString(),
        totalDustXlm: stroopsToXlm(totalDust),
        streamCount: streams.length,
        strategy,
        reason,
      });
    }

    // Sort by most recoverable dust first
    recommendations.sort((a, b) => {
      const diff = BigInt(b.totalDustStroops) - BigInt(a.totalDustStroops);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    const dustStreamsFound = recommendations.reduce((n, r) => n + r.streamCount, 0);
    const affectedAccounts = new Set(recommendations.map((r) => r.sender)).size;

    logger.info(
      `[DustRecovery] Scan complete — scanned=${scannedStreams} dustFound=${dustStreamsFound} accounts=${affectedAccounts}`,
    );

    return {
      scannedStreams,
      dustStreamsFound,
      affectedAccounts,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Execute dust recovery for the provided stream IDs.
   *
   * For each stream:
   *  1. Verify it is still ACTIVE or PAUSED and genuinely has dust balance.
   *  2. Mark it CANCELED in the DB (the on-chain cancellation must be handled
   *     by the client using the returned stream IDs; we only update local state).
   *  3. Log the recovery action for the audit trail.
   *
   * @param streamDbIds - Array of DB record `id` values (not contract stream IDs).
   * @param executedBy  - Stellar address of the operator requesting recovery.
   */
  async recoverDust(
    streamDbIds: string[],
    executedBy: string,
  ): Promise<RecoveryResult> {
    if (streamDbIds.length === 0) {
      return { recovered: 0, skipped: 0, errors: 0, details: [], executedAt: new Date().toISOString() };
    }

    logger.info(
      `[DustRecovery] Recovery requested for ${streamDbIds.length} streams by ${executedBy}`,
    );

    const result: RecoveryResult = {
      recovered: 0,
      skipped: 0,
      errors: 0,
      details: [],
      executedAt: new Date().toISOString(),
    };

    // Batch-fetch all candidate streams in one query
    const streams = await prisma.stream.findMany({
      where: { id: { in: streamDbIds } },
      select: {
        id: true,
        streamId: true,
        sender: true,
        amount: true,
        withdrawn: true,
        status: true,
        tokenAddress: true,
      },
    });

    const streamMap = new Map(streams.map((s) => [s.id, s]));

    for (const dbId of streamDbIds) {
      const stream = streamMap.get(dbId);

      if (!stream) {
        result.skipped++;
        result.details.push({ streamDbId: dbId, status: "skipped", reason: "Stream not found" });
        continue;
      }

      // Only recover streams that are still active/paused
      if (stream.status !== "ACTIVE" && stream.status !== "PAUSED") {
        result.skipped++;
        result.details.push({
          streamDbId: dbId,
          status: "skipped",
          reason: `Stream status is ${stream.status} — not eligible`,
        });
        continue;
      }

      const remaining = remainingBalance(stream.amount, stream.withdrawn ?? "0");
      if (remaining >= MIN_STREAMABLE_STROOPS) {
        result.skipped++;
        result.details.push({
          streamDbId: dbId,
          status: "skipped",
          reason: `Remaining balance ${stroopsToXlm(remaining)} XLM exceeds dust threshold`,
        });
        continue;
      }

      try {
        await prisma.stream.update({
          where: { id: dbId },
          data: { status: "CANCELED", isDust: true },
        });

        // Append to EventLog so the recovery is auditable
        await prisma.eventLog.create({
          data: {
            eventType: "dust_recovery",
            streamId: stream.streamId ?? dbId,
            txHash: `dust_recovery_${dbId}_${Date.now()}`,
            eventIndex: 0,
            ledger: 0,
            ledgerClosedAt: new Date().toISOString(),
            sender: stream.sender,
            amount: remaining,
            metadata: JSON.stringify({
              recoveredBy: executedBy,
              remainingStroops: remaining.toString(),
              remainingXlm: stroopsToXlm(remaining),
              tokenAddress: stream.tokenAddress,
            }),
          },
        });

        result.recovered++;
        result.details.push({ streamDbId: dbId, status: "recovered" });
      } catch (err) {
        logger.error(`[DustRecovery] Failed to recover stream ${dbId}`, err);
        result.errors++;
        result.details.push({
          streamDbId: dbId,
          status: "error",
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    logger.info(
      `[DustRecovery] Recovery complete — recovered=${result.recovered} skipped=${result.skipped} errors=${result.errors}`,
    );

    return result;
  }
}
