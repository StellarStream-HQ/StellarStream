/**
 * Core event watcher service for Stellar blockchain
 */

import { SorobanRpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { EventWatcherConfig, WatcherState, ParsedContractEvent } from "./types";
import { logger } from "./logger";
import { parseContractEvent, extractEventType } from "./event-parser";
import { PrismaClient } from "./generated/client/client.js";
import { StreamLifecycleService, toObjectOrNull, toBigIntOrNull } from "./services/stream-lifecycle-service.js";

// @ts-expect-error Prisma Client may not be generated yet
const prisma = new PrismaClient();

export class EventWatcher {
  private server: SorobanRpc.Server;
  private config: EventWatcherConfig;
  private state: WatcherState;
  private isShuttingDown: boolean = false;
  private pollTimeout?: NodeJS.Timeout;
  private streamLifecycleService: StreamLifecycleService;

  constructor(config: EventWatcherConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });

    this.state = {
      lastProcessedLedger: 0,
      isRunning: false,
      errorCount: 0,
    };
    this.streamLifecycleService = new StreamLifecycleService();

    logger.info("EventWatcher initialized", {
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      pollInterval: config.pollIntervalMs,
    });
  }

  /**
   * Start the event watcher loop
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      logger.warn("EventWatcher is already running");
      return;
    }

    this.state.isRunning = true;
    this.isShuttingDown = false;
    logger.info("EventWatcher started");

    // Get initial ledger position
    await this.initializeCursor();

    // Start polling loop
    await this.pollLoop();
  }

  /**
   * Stop the event watcher gracefully
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return Promise.resolve();
    }

    logger.info("Stopping EventWatcher...");
    this.isShuttingDown = true;
    this.state.isRunning = false;

    if (this.pollTimeout !== undefined) {
      clearTimeout(this.pollTimeout);
    }

    logger.info("EventWatcher stopped", {
      lastProcessedLedger: this.state.lastProcessedLedger,
      totalErrors: this.state.errorCount,
    });

    return Promise.resolve();
  }

  /**
   * Initialize cursor to latest ledger
   */
  private async initializeCursor(): Promise<void> {
    try {
      const latestLedger = await this.server.getLatestLedger();
      this.state.lastProcessedLedger = latestLedger.sequence;
      logger.info("Cursor initialized", {
        startingLedger: this.state.lastProcessedLedger,
      });
    } catch (error) {
      logger.error("Failed to initialize cursor", error);
      // Start from 0 if we can't get latest ledger
      this.state.lastProcessedLedger = 0;
    }
  }

  /**
   * Main polling loop with error handling and backoff
   */
  private async pollLoop(): Promise<void> {
    while (this.state.isRunning && !this.isShuttingDown) {
      try {
        await this.fetchAndProcessEvents();
        this.state.errorCount = 0; // Reset error count on success

        // Wait before next poll
        await this.sleep(this.config.pollIntervalMs);
      } catch (error) {
        this.state.errorCount++;
        this.state.lastError = error instanceof Error ? error : new Error(String(error));

        logger.error("Error in poll loop", error, {
          errorCount: this.state.errorCount,
          lastProcessedLedger: this.state.lastProcessedLedger,
        });

        // Exponential backoff on errors
        const backoffDelay = Math.min(
          this.config.retryDelayMs * Math.pow(2, this.state.errorCount - 1),
          30000 // Max 30 seconds
        );

        logger.info(`Retrying in ${backoffDelay}ms...`);
        await this.sleep(backoffDelay);

        // Stop if too many consecutive errors
        if (this.state.errorCount >= this.config.maxRetries) {
          logger.error("Max retries exceeded, stopping watcher");
          await this.stop();
        }
      }
    }
  }

  /**
   * Fetch events from Stellar RPC and process them
   */
  private async fetchAndProcessEvents(): Promise<void> {
    const startLedger = this.state.lastProcessedLedger + 1;

    logger.debug("Fetching events", { startLedger });

    const response = await this.server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [this.config.contractId],
        },
      ],
      limit: 100, // Process up to 100 events per poll
    });

    if (response.events === undefined || response.events.length === 0) {
      logger.debug("No new events found");

      // Update cursor to latest ledger even if no events
      const latestLedger = await this.server.getLatestLedger();
      this.state.lastProcessedLedger = latestLedger.sequence;
      return;
    }

    logger.info(`Found ${response.events.length} new events`);

    // Process each event
    for (const event of response.events) {
      await this.processEvent(event);

      // Update cursor after each event
      if (event.ledger > this.state.lastProcessedLedger) {
        this.state.lastProcessedLedger = event.ledger;
      }
    }

    logger.debug("Events processed", {
      count: response.events.length,
      lastProcessedLedger: this.state.lastProcessedLedger,
    });
  }

  /**
   * Process a single event
   */
  private async processEvent(event: SorobanRpc.Api.EventResponse): Promise<void> {
    const parsed = parseContractEvent(event);

    if (!parsed) {
      logger.warn("Skipping unparseable event", { eventId: event.id });
      return;
    }

    const eventType = extractEventType(parsed.topics);

    // Log the raw event to console (as per acceptance criteria)
    logger.event(eventType, {
      id: parsed.id,
      type: parsed.type,
      ledger: parsed.ledger,
      ledgerClosedAt: parsed.ledgerClosedAt,
      contractId: parsed.contractId,
      txHash: parsed.txHash,
      topics: parsed.topics,
      value: parsed.value,
      inSuccessfulContractCall: parsed.inSuccessfulContractCall,
    });

    // Here you can add custom handlers for specific event types
    await this.handleEventByType(eventType, parsed);
  }

  /**
   * Handle events based on their type
   * Extend this method to add custom business logic
   */
  private async handleEventByType(
    eventType: string,
    event: ParsedContractEvent
  ): Promise<void> {
    const eventData = toObjectOrNull(event.value);
    if (!eventData) {
      logger.debug("Event payload is not an object; skipping lifecycle indexing", {
        eventType,
        txHash: event.txHash,
      });
      return;
    }

    const normalizedEventType = eventType.toLowerCase();

    switch (eventType) {
      case "create":
      case "stream_created":
        await this.handleStreamCreated(event, eventData);
        logger.info("Stream created event detected", {
          txHash: event.txHash,
          ledger: event.ledger,
        });

        try {
          let sender = "";
          let receiver = "";
          let amount = "0";
          let duration = 0;
          let streamId = "";

          // Attempt to extract from Topics (using requested fromXdr and scValToNative)
          if (event.topics !== undefined && event.topics.length > 1) {
            const senderVal = xdr.ScVal.fromXDR(event.topics[1], "base64");
            sender = String(scValToNative(senderVal));
          }

          // Extract further data from the parsed value
          const data = event.value;
          if (Array.isArray(data)) {
            // Assume [receiver, amount, duration] or similar
            receiver = data[0] !== undefined ? String(data[0]) : "";
            amount = data[1] !== undefined ? String(data[1]) : "0";
            duration = data[2] !== undefined ? Number(data[2]) : 0;
            // streamId might not be trivially in an array, but leave empty if not found
          } else if (typeof data === "object" && data !== null) {
            const dataObj = data as Record<string, string | number>;
            // Assume named fields struct
            receiver = dataObj.receiver !== undefined ? String(dataObj.receiver) : "";
            amount = dataObj.amount !== undefined ? String(dataObj.amount) : "0";
            duration = dataObj.duration !== undefined ? Number(dataObj.duration) : 0;
            streamId = dataObj.stream_id !== undefined ? String(dataObj.stream_id) : "";
            if (sender === "" && dataObj.sender !== undefined) {
              sender = String(dataObj.sender);
            }
          }

          await prisma.stream.create({
            data: {
              txHash: event.txHash,
              streamId: streamId || null,
              sender,
              receiver,
              amount,
              duration,
            },
          });
          logger.info("Stream successfully saved to Prisma DB", { txHash: event.txHash });
        } catch (error) {
          logger.error("Failed to decode or save StreamCreated event", error);
        }
        break;

      case "claim":
      case "stream_withdrawn":
        await this.handleStreamWithdrawn(event, eventData);
        logger.info("Withdrawal event detected", {
          txHash: event.txHash,
          ledger: event.ledger,
        });

        try {
          const data = event.value;
          if (data !== undefined && typeof data === "object" && data !== null) {
            const dataObj = data as Record<string, string | number>;
            const withdrawStreamId = dataObj.stream_id !== undefined ? String(dataObj.stream_id) : "";
            const amountWithdrawn = dataObj.amount !== undefined ? String(dataObj.amount) : "0";

            if (withdrawStreamId !== "") {
              const stream = await prisma.stream.findUnique({
                where: { streamId: withdrawStreamId },
              });

              if (stream) {
                const currentWithdrawn = BigInt(stream.withdrawn || "0");
                const newWithdrawn = BigInt(amountWithdrawn);
                const totalWithdrawn = (currentWithdrawn + newWithdrawn).toString();

                await prisma.stream.update({
                  where: { id: stream.id },
                  data: { withdrawn: totalWithdrawn },
                });
                logger.info("Stream withdrawn amount updated", {
                  streamId: withdrawStreamId,
                  amountWithdrawn,
                  totalWithdrawn,
                  txHash: event.txHash,
                });
              } else {
                logger.warn("Stream not found for withdrawal", { streamId: withdrawStreamId });
              }
            } else {
              logger.warn("Withdrawal event missing stream_id", { eventId: event.id });
            }
          }
        } catch (error) {
          logger.error("Failed to process stream_withdrawn event", error);
        }
        break;

      case "cancel":
      case "cancelled":
      case "stream_cancelled":
        await this.handleStreamCancelled(event, eventData);
        logger.info("Cancellation event detected", {
          txHash: event.txHash,
          ledger: event.ledger,
        });
        break;

      default:
        logger.debug("Unhandled event type", { eventType: normalizedEventType });
    }
  }

  private async handleStreamCreated(
    event: ParsedContractEvent,
    eventData: Record<string, unknown>
  ): Promise<void> {
    const streamId = this.readStreamId(eventData);
    const totalAmount =
      toBigIntOrNull(eventData.total_amount) ?? toBigIntOrNull(eventData.amount);
    const sender = this.readStringOrUnknown(eventData.sender);
    const receiver = this.readStringOrUnknown(eventData.receiver);

    if (streamId === null || streamId.length === 0 || totalAmount === null) {
      logger.warn("Unable to index stream_created event due to missing fields", {
        txHash: event.txHash,
        streamId,
        hasTotalAmount: totalAmount !== null,
      });
      return;
    }

    await this.streamLifecycleService.upsertCreatedStream({
      streamId,
      txHash: event.txHash,
      sender,
      receiver,
      totalAmount,
      createdAtIso: this.resolveEventTimestampIso(eventData.timestamp, event.ledgerClosedAt),
      ledger: event.ledger,
    });
  }

  private async handleStreamWithdrawn(
    event: ParsedContractEvent,
    eventData: Record<string, unknown>
  ): Promise<void> {
    const streamId = this.readStreamId(eventData);
    const amount = toBigIntOrNull(eventData.amount);
    if (streamId === null || streamId.length === 0 || amount === null) {
      logger.warn("Unable to index stream_withdrawn event due to missing fields", {
        txHash: event.txHash,
        streamId,
        hasAmount: amount !== null,
      });
      return;
    }

    await this.streamLifecycleService.registerWithdrawal({
      streamId,
      amount,
      ledger: event.ledger,
    });
  }

  private async handleStreamCancelled(
    event: ParsedContractEvent,
    eventData: Record<string, unknown>
  ): Promise<void> {
    const streamId = this.readStreamId(eventData);
    const toReceiver = toBigIntOrNull(eventData.to_receiver);
    const toSender = toBigIntOrNull(eventData.to_sender);
    if (streamId === null || streamId.length === 0 || toReceiver === null || toSender === null) {
      logger.warn("Unable to index stream_cancelled event due to missing fields", {
        txHash: event.txHash,
        streamId,
        hasToReceiver: toReceiver !== null,
        hasToSender: toSender !== null,
      });
      return;
    }

    const closedAtIso = this.resolveEventTimestampIso(eventData.timestamp, event.ledgerClosedAt);
    const summary = await this.streamLifecycleService.cancelStream({
      streamId,
      toReceiver,
      toSender,
      closedAtIso,
      ledger: event.ledger,
    });

    logger.info("Stream cancellation persisted", {
      stream_id: summary.streamId,
      status: "CANCELED",
      closed_at: summary.closedAtIso,
      final_streamed_amount: summary.finalStreamedAmount.toString(),
      original_total_amount: summary.originalTotalAmount.toString(),
      remaining_unstreamed_amount: summary.remainingUnstreamedAmount.toString(),
    });
  }

  private readStreamId(eventData: Record<string, unknown>): string | null {
    const streamId = toBigIntOrNull(eventData.stream_id);
    return streamId === null ? null : streamId.toString();
  }

  private readStringOrUnknown(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value : "unknown";
  }

  private resolveEventTimestampIso(
    eventTimestamp: unknown,
    fallbackIso: string
  ): string {
    const timestampSeconds = toBigIntOrNull(eventTimestamp);
    if (timestampSeconds === null) {
      return fallbackIso;
    }
    const timestampMs = Number(timestampSeconds) * 1000;
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return fallbackIso;
    }
    return new Date(timestampMs).toISOString();
  }

  /**
   * Get current watcher state
   */
  getState(): Readonly<WatcherState> {
    return { ...this.state };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollTimeout = setTimeout(resolve, ms);
    });
  }
}
