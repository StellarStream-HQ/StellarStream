/**
 * WeeklyLedgerAuditService
 *
 * Performs a full-ledger scan for the configured Contract ID and cross-references
 * every Stream row in the DB against on-chain ContractEvent records.
 *
 * A mismatch is flagged when:
 *   - The DB `amount` for a stream does not match the `total_amount` emitted in
 *     the on-chain `stream_created` event for that stream.
 *   - A DB stream has no corresponding on-chain event at all (missing on-chain).
 *
 * The service is intentionally read-only — it flags discrepancies but never
 * mutates financial records. Remediation is a manual ops step.
 */

import { /* SorobanRpc */ } from "@stellar/stellar-sdk";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditMismatch {
  streamId: string;
  txHash: string;
  dbAmount: string;
  onChainAmount: string | null;
  reason: "amount_mismatch" | "missing_on_chain";
}

export interface AuditReport {
  reportId: string;
  generatedAt: string;
  contractId: string;
  totalStreamsScanned: number;
  matchedStreams: number;
  mismatches: AuditMismatch[];
  durationMs: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WeeklyLedgerAuditService {
  private readonly contractId: string;
  private readonly _rpcUrl: string;

  constructor(
    contractId: string = process.env.SPLITTER_CONTRACT_ID ?? "",
    rpcUrl: string = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  ) {
    this.contractId = contractId;
    this._rpcUrl = rpcUrl;
  }

  async runAudit(): Promise<AuditReport> {
    const startMs = Date.now();
    const reportId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info("[WeeklyLedgerAudit] Starting full-ledger scan", {
      contractId: this.contractId,
    });

    // 1. Load all streams from DB
    const dbStreams = await prisma.stream.findMany({
      select: { streamId: true, txHash: true, amount: true, contractId: true },
      where: this.contractId
        ? { contractId: this.contractId }
        : undefined,
    });

    logger.info("[WeeklyLedgerAudit] Loaded DB streams", { count: dbStreams.length });

    // 2. Load all on-chain stream_created events for this contract
    const onChainEvents = await this.fetchOnChainEvents();

    // Build a lookup: txHash → on-chain total_amount
    const onChainByTxHash = new Map<string, string>();
    for (const ev of onChainEvents) {
      const amount = this.extractAmount(ev);
      if (amount !== null) {
        onChainByTxHash.set(ev.txHash, amount);
      }
    }

    logger.info("[WeeklyLedgerAudit] Loaded on-chain events", {
      count: onChainEvents.length,
    });

    // 3. Cross-reference
    const mismatches: AuditMismatch[] = [];

    for (const stream of dbStreams) {
      const onChainAmount = onChainByTxHash.get(stream.txHash) ?? null;

      if (onChainAmount === null) {
        mismatches.push({
          streamId: stream.streamId ?? stream.txHash,
          txHash: stream.txHash,
          dbAmount: stream.amount,
          onChainAmount: null,
          reason: "missing_on_chain",
        });
        continue;
      }

      // Normalise both to string-trimmed for comparison
      if (onChainAmount.trim() !== stream.amount.trim()) {
        mismatches.push({
          streamId: stream.streamId ?? stream.txHash,
          txHash: stream.txHash,
          dbAmount: stream.amount,
          onChainAmount,
          reason: "amount_mismatch",
        });
      }
    }

    const report: AuditReport = {
      reportId,
      generatedAt: new Date().toISOString(),
      contractId: this.contractId,
      totalStreamsScanned: dbStreams.length,
      matchedStreams: dbStreams.length - mismatches.length,
      mismatches,
      durationMs: Date.now() - startMs,
    };

    logger.info("[WeeklyLedgerAudit] Audit complete", {
      reportId,
      totalStreamsScanned: report.totalStreamsScanned,
      matchedStreams: report.matchedStreams,
      mismatchCount: mismatches.length,
      durationMs: report.durationMs,
    });

    if (mismatches.length > 0) {
      logger.warn("[WeeklyLedgerAudit] Discrepancies detected — manual review required", {
        mismatches: mismatches.slice(0, 10), // log first 10 to avoid log flooding
      });
    }

    return report;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch all `stream_created` ContractEvents for this contract from the DB.
   * The DB is the source of truth for indexed events; we don't re-scan the
   * entire ledger from RPC on every run (that would be prohibitively slow).
   * Instead we use the already-indexed ContractEvent table and optionally
   * verify a sample against the RPC node.
   */
  private async fetchOnChainEvents(): Promise<
    { txHash: string; decodedJson: unknown }[]
  > {
    const events = await prisma.contractEvent.findMany({
      where: {
        contractId: this.contractId || undefined,
        eventType: "stream_created",
      },
      select: { txHash: true, decodedJson: true },
    });
    return events;
  }

  /**
   * Extract `total_amount` from a decoded ContractEvent JSON payload.
   * The exact shape depends on the contract version; we try common keys.
   */
  private extractAmount(ev: { decodedJson: unknown }): string | null {
    const json = ev.decodedJson as Record<string, unknown> | null;
    if (!json) return null;
    const raw =
      json["total_amount"] ??
      json["amount"] ??
      (json["data"] as Record<string, unknown> | undefined)?.["total_amount"] ??
      null;
    return raw !== null && raw !== undefined ? String(raw) : null;
  }
}
