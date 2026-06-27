import { prisma } from "../lib/db.js";
import { computeEntryHash, type AuditHashInput } from "../lib/audit-hash-chain.js";
import { logger } from "../logger.js";
import { InternalError } from "../lib/app-error.js";

export interface ChainVerificationResult {
  totalEntries: number;
  verifiedEntries: number;
  brokenLinks: Array<{
    id: string;
    expectedHash: string;
    actualHash: string | null;
    position: number;
  }>;
  isIntact: boolean;
  verifiedAt: string;
}

export class AuditChainVerificationService {
  async verifyChain(limit?: number): Promise<ChainVerificationResult> {
    let entries: Awaited<ReturnType<typeof prisma.eventLog.findMany>>;
    try {
      entries = await prisma.eventLog.findMany({
        orderBy: { createdAt: "asc" },
        ...(limit ? { take: limit } : {}),
      });
    } catch (cause) {
      logger.error("Failed to verify audit log chain", cause);
      throw new InternalError("Failed to verify audit log chain", { cause });
    }

    const brokenLinks: ChainVerificationResult["brokenLinks"] = [];
    let previousHash: string | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (!entry.entryHash) {
        continue;
      }

      const input: AuditHashInput = {
        eventType: entry.eventType,
        streamId: entry.streamId,
        txHash: entry.txHash,
        eventIndex: entry.eventIndex,
        ledger: entry.ledger,
        ledgerClosedAt: entry.ledgerClosedAt,
        sender: entry.sender,
        receiver: entry.receiver,
        amount: entry.amount?.toString() ?? null,
        metadata: entry.metadata,
      };

      const expectedHash = computeEntryHash(input, previousHash);

      if (expectedHash !== entry.entryHash) {
        brokenLinks.push({
          id: entry.id,
          expectedHash,
          actualHash: entry.entryHash,
          position: i,
        });
      }

      previousHash = entry.entryHash;
    }

    const result: ChainVerificationResult = {
      totalEntries: entries.length,
      verifiedEntries: entries.filter((entry) => entry.entryHash).length,
      brokenLinks,
      isIntact: brokenLinks.length === 0,
      verifiedAt: new Date().toISOString(),
    };

    logger.info("[AuditChainVerification] Chain verification complete", {
      totalEntries: result.totalEntries,
      verifiedEntries: result.verifiedEntries,
      brokenLinks: result.brokenLinks.length,
      isIntact: result.isIntact,
    });

    return result;
  }
}
