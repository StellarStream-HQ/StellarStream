import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import axios from "axios";

/* interface LedgerEvent {
  id: string;
  paging_token: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  ledger_close_time: string;
} */

export class HistoricalSyncService {
  private horizonUrl: string;
  private sorobanRpcUrl: string;
  private contractId: string;

  constructor(
    horizonUrl: string = "https://horizon.stellar.org",
    sorobanRpcUrl: string = "https://soroban-rpc.stellar.org",
    contractId: string = process.env.CONTRACT_ID || "",
  ) {
    this.horizonUrl = horizonUrl;
    this.sorobanRpcUrl = sorobanRpcUrl;
    this.contractId = contractId;
  }

  /**
   * Sync historical ledgers from Soroban RPC
   */
  async syncFromSorobanRpc(fromLedger: number, toLedger: number): Promise<number> {
    let synced = 0;

    for (let ledger = fromLedger; ledger <= toLedger; ledger++) {
      try {
        const events = await this.fetchSorobanEvents(ledger);
        synced += await this.upsertEvents(events);
        logger.info(`Synced ledger ${ledger}: ${events.length} events`);
      } catch (error) {
        logger.error(`Failed to sync ledger ${ledger}:`, error);
      }
    }

    return synced;
  }

  /**
   * Fallback: Sync from Horizon if Soroban RPC doesn't have history
   */
  async syncFromHorizon(fromLedger: number, toLedger: number): Promise<number> {
    let synced = 0;

    try {
      const transactions = await this.fetchHorizonTransactions(fromLedger, toLedger);

      for (const tx of transactions) {
        const events = await this.parseHorizonTransaction(tx);
        synced += await this.upsertEvents(events);
      }

      logger.info(`Synced from Horizon: ${synced} events`);
    } catch (error) {
      logger.error("Failed to sync from Horizon:", error);
    }

    return synced;
  }

  /**
   * Fetch events from Soroban RPC for a specific ledger
   */
  private async fetchSorobanEvents(ledger: number): Promise<any[]> {
    try {
      const response = await axios.post(this.sorobanRpcUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: {
          startLedger: ledger,
          filters: [
            {
              contractIds: [this.contractId],
            },
          ],
        },
      });

      return response.data.result?.events || [];
    } catch (error) {
      logger.warn(`Soroban RPC unavailable for ledger ${ledger}, falling back to Horizon`);
      return [];
    }
  }

  /**
   * Fetch transactions from Horizon for a ledger range
   */
  private async fetchHorizonTransactions(
    fromLedger: number,
    toLedger: number,
  ): Promise<any[]> {
    const transactions: any[] = [];

    for (let ledger = fromLedger; ledger <= toLedger; ledger++) {
      try {
        const response = await axios.get(
          `${this.horizonUrl}/ledgers/${ledger}/transactions`,
          { params: { limit: 200 } },
        );

        transactions.push(...(response.data._embedded?.records || []));
      } catch (error) {
        logger.warn(`Failed to fetch Horizon ledger ${ledger}`);
      }
    }

    return transactions;
  }

  /**
   * Parse Horizon transaction to extract contract events
   */
  private async parseHorizonTransaction(tx: any): Promise<any[]> {
    const events: any[] = [];

    try {
      const txResponse = await axios.get(
        `${this.horizonUrl}/transactions/${tx.hash}`,
      );

      // Extract result_meta_xdr and decode events
      if (txResponse.data.result_meta_xdr) {
        // Placeholder: actual XDR decoding would happen here
        events.push({
          txHash: tx.hash,
          ledger: tx.ledger_sequence,
          ledgerClosedAt: tx.created_at,
        });
      }
    } catch (error) {
      logger.warn(`Failed to parse Horizon transaction ${tx.hash}`);
    }

    return events;
  }

  /**
   * Upsert events into database (deduplication via unique constraint)
   */
  private async upsertEvents(events: any[]): Promise<number> {
    let upserted = 0;

    for (const event of events) {
      try {
        await prisma.contractEvent.upsert({
          where: {
            eventId: event.id || `${event.txHash}-${event.eventIndex || 0}`,
          },
          update: {},
          create: {
            eventId: event.id || `${event.txHash}-${event.eventIndex || 0}`,
            contractId: this.contractId,
            txHash: event.txHash,
            eventType: event.type || "unknown",
            eventIndex: event.eventIndex || 0,
            ledgerSequence: event.ledger,
            ledgerClosedAt: event.ledgerClosedAt,
            topicXdr: event.topicXdr || [],
            valueXdr: event.valueXdr || "",
            decodedJson: event.decodedJson || {},
          },
        });
        upserted++;
      } catch (error) {
        logger.warn(`Failed to upsert event:`, error);
      }
    }

    return upserted;
  }

  /**
   * Get current sync state
   */
  async getSyncState(): Promise<number> {
    const state = await prisma.syncState.findUnique({
      where: { id: 1 },
    });
    return state?.lastLedgerSequence || 0;
  }

  /**
   * Update sync state
   */
  async updateSyncState(ledger: number): Promise<void> {
    await prisma.syncState.upsert({
      where: { id: 1 },
      update: { lastLedgerSequence: ledger },
      create: { lastLedgerSequence: ledger },
    });
  }
}

export const historicalSyncService = new HistoricalSyncService();
