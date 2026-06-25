import { PrismaClient } from "../generated/client/client.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const url = process.env["DATABASE_URL"] ?? "file:./dev.db";
const adapter = new PrismaLibSql({ url });
const prisma = new PrismaClient({ adapter });

const SINGLETON_ID = 'singleton';

/**
 * Returns the last successfully processed ledger sequence from the DB.
 * Returns 0 on first run (no checkpoint saved yet), so the indexer
 * starts from the beginning of time exactly once.
 */
export async function getLastLedgerSequence(): Promise<number> {
  try {
    const record = await prisma.syncMetadata.findUnique({
      where: { id: SINGLETON_ID },
    });
    return record?.lastLedgerSequence ?? 0;
  } catch (err) {
    console.error('[SyncMetadata] Failed to read checkpoint:', err);
    throw err;
  }
}

/**
 * Persists the last successfully processed ledger sequence.
 * Uses upsert so it works seamlessly on both first run and all
 * subsequent runs without any manual DB seeding required.
 *
 * IMPORTANT: Call this ONLY after a batch has been fully processed
 * and written to the DB. Never checkpoint before processing is done.
 */
export async function saveLastLedgerSequence(ledgerSequence: number): Promise<void> {
  try {
    await prisma.syncMetadata.upsert({
      where: { id: SINGLETON_ID },
      update: { lastLedgerSequence: ledgerSequence },
      create: {
        id: SINGLETON_ID,
        lastLedgerSequence: ledgerSequence,
      },
    });
    console.log(`[SyncMetadata] Checkpoint saved at ledger ${ledgerSequence}`);
  } catch (err) {
    console.error('[SyncMetadata] Failed to save checkpoint:', err);
    throw err;
  }
}