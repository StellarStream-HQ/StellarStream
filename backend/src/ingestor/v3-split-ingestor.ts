/**
 * V3 Split Ingestor
 *
 * Extends the Warp Indexer to listen for V3 splitter-v3 contract events:
 *   - "SplitExecuted"  → creates a Disbursement header row
 *   - "PaymentSent"    → creates SplitRecipient rows linked to the parent Disbursement
 *
 * Idempotency: each event is keyed by txHash so re-processing a ledger is safe.
 */

import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { PrismaClient } from "../generated/client/index.js";
import { getLastLedgerSequence, saveLastLedgerSequence } from "../services/syncMetadata.service.js";
import { WebhookDispatcherService } from "../services/webhook-dispatcher.service.js";
import { AnomalyDetectionService } from "../services/anomaly-detection.service.js";
import { logger } from "../logger.js";

const prisma = new PrismaClient();
const webhookDispatcher = new WebhookDispatcherService();

const RPC_URL = process.env.STELLAR_RPC_URL ?? "";
const V3_CONTRACT_ID = process.env.V3_CONTRACT_ID ?? "";

const SPLIT_EXECUTED_TOPIC = "SplitExecuted";
const PAYMENT_SENT_TOPIC   = "PaymentSent";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SplitExecutedPayload {
  split_id?: unknown;
  sender?: unknown;
  total_amount?: unknown;
  asset?: unknown;
}

interface PaymentSentPayload {
  split_id?: unknown;
  recipient?: unknown;
  amount?: unknown;
}

// ── Ingestor ──────────────────────────────────────────────────────────────────

export class V3SplitIngestor {
  private server: SorobanRpc.Server;
  private running = false;
  private pollTimeout?: NodeJS.Timeout;

  constructor(rpcUrl = RPC_URL) {
    if (!V3_CONTRACT_ID) throw new Error("V3_CONTRACT_ID is not set");
    this.server = new SorobanRpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("[V3SplitIngestor] Starting", { contractId: V3_CONTRACT_ID });
    await this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    logger.info("[V3SplitIngestor] Stopped");
  }

  // ── Poll loop ───────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      await this.fetchAndProcess();
    } catch (err) {
      logger.error("[V3SplitIngestor] Poll error", { err });
    }
    this.pollTimeout = setTimeout(() => this.poll(), 2000);
  }

  private async fetchAndProcess(): Promise<void> {
    const startLedger = await getLastLedgerSequence();

    const response = await this.server.getEvents({
      startLedger: startLedger === 0 ? undefined : startLedger + 1,
      filters: [
        {
          type: "contract",
          contractIds: [V3_CONTRACT_ID],
          topics: [[SPLIT_EXECUTED_TOPIC], [PAYMENT_SENT_TOPIC]],
        },
      ],
    });

    const events = response.events ?? [];
    if (events.length === 0) return;

    let latestLedger = startLedger;

    for (const event of events) {
      if (event.ledger > latestLedger) latestLedger = event.ledger;
      await this.handleEvent(event);
    }

    await saveLastLedgerSequence(latestLedger);
    logger.info(`[V3SplitIngestor] Processed ${events.length} event(s)`, { latestLedger });
  }

  // ── Event dispatch ──────────────────────────────────────────────────────────

  private async handleEvent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const topic = this.extractTopic(event);
    if (!topic) return;

    try {
      if (topic === SPLIT_EXECUTED_TOPIC) {
        await this.handleSplitExecuted(event);
      } else if (topic === PAYMENT_SENT_TOPIC) {
        await this.handlePaymentSent(event);
      }
    } catch (err) {
      logger.error("[V3SplitIngestor] Event handling error", { topic, txHash: event.txHash, err });
    }
  }

  /**
   * SplitExecuted → upsert a SplitLog entry and analyze for anomalies.
   * Idempotent: uses txHash as the unique key.
   */
  private async handleSplitExecuted(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const payload = this.decodePayload(event) as SplitExecutedPayload;
    const splitId = payload.split_id == null ? null : String(payload.split_id);
    const sender = String(payload.sender ?? "");
    const totalAmount = String(payload.total_amount ?? "0");
    const asset = String(payload.asset ?? "");

    // Create a SplitLog entry for this split
    const splitLog = await prisma.splitLog.upsert({
      where: { txHash: event.txHash },
      create: {
        streamId: splitId || "",
        asset,
        amount: totalAmount,
        sender,
        receiver: "", // Will be populated when we get PaymentSent events, or use a placeholder
        txHash: event.txHash,
        executedAt: new Date(),
      },
      update: {},
    });

    // Analyze the transaction for anomalies (using sender, amount, etc.)
    await AnomalyDetectionService.analyzeTransaction({
      amount: Number(totalAmount),
      senderAddress: sender,
      receiverAddress: "", // We'll update this when handling PaymentSent, but start with what we have
      timestamp: new Date(),
      streamId: splitId || undefined,
      disbursementId: splitLog.id,
    });

    await webhookDispatcher.dispatch({
      eventType: "split.completed",
      splitId,
      streamId: splitId,
      txHash: event.txHash,
      sender,
      totalAmount,
      asset,
      timestamp: new Date().toISOString(),
    });

    logger.debug("[V3SplitIngestor] Upserted SplitLog", { txHash: event.txHash });
  }

  /**
   * PaymentSent → log the event for now (since we don't have SplitRecipient model.
   */
  private async handlePaymentSent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const payload = this.decodePayload(event) as PaymentSentPayload;
    logger.debug("[V3SplitIngestor] Received PaymentSent", { payload, txHash: event.txHash });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private extractTopic(event: SorobanRpc.Api.EventResponse): string | null {
    try {
      const native = scValToNative(event.topic[0]);
      return typeof native === "string" ? native : null;
    } catch {
      return null;
    }
  }

  private decodePayload(event: SorobanRpc.Api.EventResponse): Record<string, unknown> {
    try {
      const native = scValToNative(event.value);
      return typeof native === "object" && native !== null
        ? (native as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
