import { EventEmitter } from "events";
import { AnalyticsDatabase } from "../db/storage.js";
import {
  ContractVersion,
  RawContractEvent,
  StreamRecord,
  StreamWithdrawal,
} from "../db/types.js";
import { SorobanEventDecoder } from "./event-decoder.js";
import { GasTracker } from "./gas-tracker.js";
import { StellarClient } from "./stellar-client.js";
import { DecodedContractEvent, IndexerConfig, SorobanEventRaw } from "./types.js";

export class EventIndexer extends EventEmitter {
  private db: AnalyticsDatabase;
  private config: IndexerConfig;
  private client: StellarClient;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private cursor?: string;

  constructor(db: AnalyticsDatabase, config?: Partial<IndexerConfig>) {
    super();
    this.db = db;
    this.config = {
      rpcUrl: config?.rpcUrl || process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
      network: (config?.network || (process.env.STELLAR_NETWORK as any) || "testnet"),
      contractAddresses: config?.contractAddresses || {
        V1: process.env.V1_CONTRACT_ID ? [process.env.V1_CONTRACT_ID] : [],
        V2: process.env.V2_CONTRACT_ID ? [process.env.V2_CONTRACT_ID] : [],
        V3: [],
      },
      pollIntervalMs: config?.pollIntervalMs || parseInt(process.env.INDEXER_POLL_INTERVAL_MS || "3000", 10),
      batchSize: config?.batchSize || parseInt(process.env.INDEXER_BATCH_SIZE || "100", 10),
      startLedger: config?.startLedger || parseInt(process.env.START_LEDGER || "0", 10),
    };

    this.client = new StellarClient({ rpcUrl: this.config.rpcUrl });
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const state = this.db.getIndexerState();
    if (this.config.startLedger === 0 && state.lastLedger > 0) {
      this.config.startLedger = state.lastLedger;
    }

    this.db.updateIndexerState({ status: "RUNNING" });
    this.emit("started", { startLedger: this.config.startLedger });

    await this.poll();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.db.updateIndexerState({ status: "IDLE" });
    this.emit("stopped");
  }

  public getStatus() {
    return {
      isRunning: this.isRunning,
      indexerState: this.db.getIndexerState(),
      config: {
        rpcUrl: this.config.rpcUrl,
        network: this.config.network,
        pollIntervalMs: this.config.pollIntervalMs,
        batchSize: this.config.batchSize,
      },
    };
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.processNextBatch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.updateIndexerState({ errorMessage: msg });
      this.emit("error", err);
    } finally {
      if (this.isRunning) {
        this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
      }
    }
  }

  public async processNextBatch(): Promise<number> {
    const currentState = this.db.getIndexerState();
    const startLedger = Math.max(currentState.lastLedger, this.config.startLedger);

    const contractIds = [
      ...this.config.contractAddresses.V1,
      ...this.config.contractAddresses.V2,
      ...this.config.contractAddresses.V3,
    ].filter(Boolean);

    try {
      const filters = contractIds.length > 0
        ? [{ contractIds, type: "contract" as const }]
        : undefined;

      const result = await this.client.getContractEvents({
        startLedger,
        filters,
        limit: this.config.batchSize,
        cursor: this.cursor,
      });

      let processedCount = 0;
      for (const raw of result.events) {
        const decoded = SorobanEventDecoder.decode(raw, this.inferVersion(raw.contractId));
        if (decoded) {
          this.ingestDecodedEvent(decoded);
          processedCount++;
        }
      }

      this.cursor = result.cursor;
      this.db.updateIndexerState({
        lastLedger: Math.max(result.latestLedger, startLedger),
        totalEventsProcessed: currentState.totalEventsProcessed + processedCount,
        status: "RUNNING",
        errorMessage: undefined,
      });

      return processedCount;
    } catch (err) {
      // In offline/mock mode or if RPC fails, handle gracefully without crashing
      this.emit("rpc_error", err);
      return 0;
    }
  }

  /**
   * Process and ingest an already decoded or simulated contract event
   */
  public ingestDecodedEvent(event: DecodedContractEvent): boolean {
    const rawEvent: RawContractEvent = {
      id: `evt_${event.txHash}_${event.eventId}`,
      eventId: event.eventId,
      contractId: event.contractId,
      contractVersion: event.contractVersion,
      topicAction: event.topicAction,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      sender: event.sender,
      receiver: event.receiver,
      tokenAddress: event.tokenAddress,
      tokenSymbol: event.tokenSymbol,
      amount: event.amount,
      amountFormatted: event.amountFormatted,
      startTime: event.startTime,
      endTime: event.endTime,
      durationSeconds: event.durationSeconds,
      gasConsumed: event.gasConsumed,
      feeChargedStroops: event.feeChargedStroops,
      memoryBytes: event.memoryBytes,
      rawPayload: event.rawPayload,
      createdAt: new Date().toISOString(),
    };

    const inserted = this.db.insertEvent(rawEvent);
    if (!inserted) return false;

    // Track gas
    const gasRecord = GasTracker.extractGasUsage(event);
    this.db.insertGasUsage(gasRecord);

    // Track Feature usage
    const isNewUser = Boolean(
      event.sender && this.db.getStreams({ sender: event.sender }).length === 0
    );
    this.db.recordFeatureUsage(
      `contract_${event.topicAction}`,
      event.contractVersion,
      event.amountFormatted || 0,
      isNewUser
    );

    // Update Stream state
    if (event.streamId) {
      this.updateStreamLifecycle(event);
    }

    this.emit("event", rawEvent);
    return true;
  }

  /**
   * Ingest a batch of simulated or raw events directly
   */
  public ingestRawEvents(rawEvents: SorobanEventRaw[]): number {
    let count = 0;
    for (const raw of rawEvents) {
      const decoded = SorobanEventDecoder.decode(raw, this.inferVersion(raw.contractId));
      if (decoded && this.ingestDecodedEvent(decoded)) {
        count++;
      }
    }
    const state = this.db.getIndexerState();
    this.db.updateIndexerState({
      totalEventsProcessed: state.totalEventsProcessed + count,
    });
    return count;
  }

  private updateStreamLifecycle(event: DecodedContractEvent): void {
    const streamId = event.streamId!;
    const existing = this.db.getStream(streamId);

    if (event.topicAction === "create") {
      const durationSeconds = event.durationSeconds || (event.startTime && event.endTime ? event.endTime - event.startTime : 86400);
      const totalAmountFormatted = event.amountFormatted || 0;
      const ratePerSecond = durationSeconds > 0 ? totalAmountFormatted / durationSeconds : 0;

      const newStream: StreamRecord = {
        streamId,
        contractId: event.contractId,
        contractVersion: event.contractVersion,
        sender: event.sender || "unknown_sender",
        receiver: event.receiver || "unknown_receiver",
        tokenAddress: event.tokenAddress,
        tokenSymbol: event.tokenSymbol,
        totalAmount: event.amount || "0",
        totalAmountFormatted,
        withdrawnAmount: "0",
        withdrawnAmountFormatted: 0,
        status: "ACTIVE",
        createdAtLedger: event.ledger,
        createdAtTime: event.ledgerClosedAt,
        startTime: event.startTime || Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
        endTime: event.endTime || Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000) + durationSeconds,
        durationSeconds,
        ratePerSecondFormatted: ratePerSecond,
        withdrawalCount: 0,
      };
      this.db.upsertStream(newStream);
    } else if (event.topicAction === "withdraw") {
      const amountFormatted = event.amountFormatted || 0;
      const prevWithdrawn = existing ? existing.withdrawnAmountFormatted : 0;
      const newWithdrawn = prevWithdrawn + amountFormatted;
      const total = existing ? existing.totalAmountFormatted : amountFormatted;

      if (existing) {
        const isFullyWithdrawn = newWithdrawn >= total && total > 0;
        this.db.upsertStream({
          ...existing,
          withdrawnAmountFormatted: newWithdrawn,
          withdrawnAmount: String(BigInt(existing.withdrawnAmount || "0") + BigInt(event.amount || "0")),
          status: isFullyWithdrawn ? "COMPLETED" : "ACTIVE",
          lastWithdrawnAt: event.ledgerClosedAt,
          withdrawalCount: (existing.withdrawalCount || 0) + 1,
        });
      }

      const elapsed = existing
        ? Math.max(0, Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000) - existing.startTime)
        : 0;

      const withdrawalRecord: StreamWithdrawal = {
        id: `wd_${event.txHash}_${event.eventId}`,
        streamId,
        contractId: event.contractId,
        txHash: event.txHash,
        receiver: event.receiver || existing?.receiver || "unknown",
        tokenAddress: event.tokenAddress,
        tokenSymbol: event.tokenSymbol,
        amount: event.amount || "0",
        amountFormatted,
        elapsedSeconds: elapsed,
        percentageWithdrawn: total > 0 ? Math.min(100, Math.round((newWithdrawn / total) * 10000) / 100) : 100,
        gasCost: event.gasConsumed || 150000,
        feeStroops: event.feeChargedStroops || 100,
        withdrawnAt: event.ledgerClosedAt,
      };
      this.db.insertWithdrawal(withdrawalRecord);
    } else if (event.topicAction === "cancel") {
      if (existing) {
        this.db.upsertStream({
          ...existing,
          status: "CANCELLED",
          cancelledAtTime: event.ledgerClosedAt,
          refundAmount: event.refundAmount,
          refundAmountFormatted: event.refundAmountFormatted,
        });
      }
    } else if (event.topicAction === "pause") {
      if (existing) {
        this.db.upsertStream({ ...existing, status: "PAUSED" });
      }
    } else if (event.topicAction === "resume") {
      if (existing) {
        this.db.upsertStream({ ...existing, status: "ACTIVE" });
      }
    }
  }

  private inferVersion(contractId: string): ContractVersion {
    if (this.config.contractAddresses.V1.includes(contractId)) return "V1";
    if (this.config.contractAddresses.V3.includes(contractId)) return "V3";
    return "V2";
  }
}
