import { prisma } from '../lib/db.js';
import { redis } from '../lib/redis.js';

const BACKFILL_PROGRESS_KEY = 'backfill:progress:';
const BACKFILL_LOCK_KEY = 'backfill:lock:';
const BACKFILL_LOCK_TTL = 3600; // 1 hour

export interface BackfillProgress {
  contractId: string;
  startLedger: number;
  endLedger: number;
  currentLedger: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  processedTransactions: number;
  failedTransactions: number;
  lastUpdated: number;
}

export class HistoricalDataBackfillService {
  /**
   * Start a backfill job for a contract.
   */
  async startBackfill(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<BackfillProgress> {
    const lockKey = `${BACKFILL_LOCK_KEY}${contractId}`;
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;

    // Check if already running
    const existingLock = await redis.get(lockKey);
    if (existingLock) {
      throw new Error(`Backfill already in progress for contract ${contractId}`);
    }

    // Acquire lock
    await redis.setex(lockKey, BACKFILL_LOCK_TTL, '1');

    const progress: BackfillProgress = {
      contractId,
      startLedger,
      endLedger,
      currentLedger: startLedger,
      status: 'in_progress',
      processedTransactions: 0,
      failedTransactions: 0,
      lastUpdated: Date.now(),
    };

    await redis.setex(progressKey, BACKFILL_LOCK_TTL, JSON.stringify(progress));

    return progress;
  }

  /**
   * Process a batch of ledgers.
   */
  async processBatch(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<{ processed: number; failed: number }> {
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;
    let processed = 0;
    let failed = 0;

    try {
      // Fetch events from Horizon for the ledger range
      const events = await this.fetchEventsFromHorizon(contractId, startLedger, endLedger);

      for (const event of events) {
        try {
          // Upsert event into database using ContractEvent model
          await prisma.contractEvent.upsert({
            where: { eventId: event.eventId },
            create: {
              eventId: event.eventId,
              contractId,
              txHash: event.txHash || 'unknown',
              eventType: event.type,
              eventIndex: 0,
              ledgerSequence: event.ledger,
              ledgerClosedAt: event.timestamp,
              topicXdr: [],
              valueXdr: JSON.stringify(event.data),
              decodedJson: event.data,
            },
            update: {
              decodedJson: event.data,
              ledgerClosedAt: event.timestamp,
            },
          });
          processed++;
        } catch (error) {
          console.error(`[Backfill] Failed to process event ${event.eventId}:`, error);
          failed++;
        }
      }

      // Update progress
      const progress = await this.getProgress(contractId);
      if (progress) {
        progress.currentLedger = endLedger;
        progress.processedTransactions += processed;
        progress.failedTransactions += failed;
        progress.lastUpdated = Date.now();
        await redis.setex(progressKey, BACKFILL_LOCK_TTL, JSON.stringify(progress));
      }
    } catch (error) {
      console.error(`[Backfill] Batch processing failed:`, error);
      failed++;
    }

    return { processed, failed };
  }

  /**
   * Complete a backfill job.
   */
  async completeBackfill(contractId: string): Promise<BackfillProgress | null> {
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;
    const lockKey = `${BACKFILL_LOCK_KEY}${contractId}`;

    const progress = await this.getProgress(contractId);
    if (progress) {
      progress.status = 'completed';
      progress.lastUpdated = Date.now();
      await redis.setex(progressKey, 86400, JSON.stringify(progress)); // Keep for 24 hours
    }

    await redis.del(lockKey);
    return progress;
  }

  /**
   * Fail a backfill job.
   */
  async failBackfill(contractId: string, _error: string): Promise<BackfillProgress | null> {
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;
    const lockKey = `${BACKFILL_LOCK_KEY}${contractId}`;

    const progress = await this.getProgress(contractId);
    if (progress) {
      progress.status = 'failed';
      progress.lastUpdated = Date.now();
      await redis.setex(progressKey, 86400, JSON.stringify(progress));
    }

    await redis.del(lockKey);
    return progress;
  }

  /**
   * Get backfill progress.
   */
  async getProgress(contractId: string): Promise<BackfillProgress | null> {
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;
    const data = await redis.get(progressKey);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Fetch events from Horizon API.
   */
  private async fetchEventsFromHorizon(
    contractId: string,
    startLedger: number,
    endLedger: number,
  ): Promise<
    Array<{
      eventId: string;
      ledger: number;
      type: string;
      data: any;
      timestamp: string;
      txHash: string;
    }>
  > {
    const events = [];

    try {
      // Use Horizon /effects endpoint to find contract events
      const url = new URL('https://horizon.stellar.org/effects');
      url.searchParams.set('limit', '200');
      url.searchParams.set('order', 'asc');

      const response = await fetch(url.toString());
      const data = (await response.json()) as any;

      if (data._embedded && data._embedded.records) {
        for (const record of data._embedded.records) {
          // Filter for contract events in ledger range
          if (
            record.type === 'contract_created' ||
            record.type === 'contract_invoked'
          ) {
            const ledger = parseInt(record.paging_token.split('-')[0]);
            if (ledger >= startLedger && ledger <= endLedger) {
              events.push({
                eventId: `${contractId}-${record.id}`,
                ledger,
                type: record.type,
                data: record,
                timestamp: record.created_at,
                txHash: record.transaction_hash || 'unknown',
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[Backfill] Failed to fetch from Horizon:', error);
    }

    return events;
  }

  /**
   * Cancel a backfill job.
   */
  async cancelBackfill(contractId: string): Promise<void> {
    const progressKey = `${BACKFILL_PROGRESS_KEY}${contractId}`;
    const lockKey = `${BACKFILL_LOCK_KEY}${contractId}`;

    await redis.del(progressKey);
    await redis.del(lockKey);
  }

  /**
   * Get all active backfill jobs.
   */
  async getActiveBackfills(): Promise<BackfillProgress[]> {
    const keys = await redis.keys(`${BACKFILL_PROGRESS_KEY}*`);
    const backfills: BackfillProgress[] = [];

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const progress = JSON.parse(data);
        if (progress.status === 'in_progress') {
          backfills.push(progress);
        }
      }
    }

    return backfills;
  }
}

export const historicalDataBackfillService = new HistoricalDataBackfillService();
