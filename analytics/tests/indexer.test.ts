import { describe, it, expect, beforeEach } from "vitest";
import { AnalyticsDatabase } from "../src/db/storage.js";
import { EventIndexer } from "../src/indexer/event-indexer.js";
import { SorobanEventDecoder } from "../src/indexer/event-decoder.js";
import { SorobanEventRaw } from "../src/indexer/types.js";

describe("EventIndexer & SorobanEventDecoder", () => {
  let db: AnalyticsDatabase;
  let indexer: EventIndexer;

  beforeEach(() => {
    db = new AnalyticsDatabase(); // In-memory
    indexer = new EventIndexer(db);
  });

  it("decodes and ingests a stream creation contract event", () => {
    const raw: SorobanEventRaw = {
      id: "evt_1",
      type: "contract",
      ledger: 1000,
      ledgerClosedAt: "2026-08-20T12:00:00.000Z",
      contractId: "CC8H3XAKV2CONTRACT",
      topic: ["create"],
      value: {
        stream_id: "stream_test_101",
        sender: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        receiver: "GCSTREAMEE1234567890ABCDEF1234567890ABCDEF1234567890ABCD",
        token: "native",
        amount: "5000000000", // 500 XLM
        start_time: 1787140800,
        end_time: 1787227200, // 86400s (1 day)
      },
      txInfo: {
        txHash: "tx_hash_create_1",
        cpuInstructions: 182000,
        feeCharged: 100,
      },
    };

    const decoded = SorobanEventDecoder.decode(raw, "V2");
    expect(decoded).not.toBeNull();
    expect(decoded?.topicAction).toBe("create");
    expect(decoded?.amountFormatted).toBe(500);
    expect(decoded?.durationSeconds).toBe(86400);

    const ingested = indexer.ingestDecodedEvent(decoded!);
    expect(ingested).toBe(true);

    const stream = db.getStream("stream_test_101");
    expect(stream).toBeDefined();
    expect(stream?.status).toBe("ACTIVE");
    expect(stream?.totalAmountFormatted).toBe(500);
    expect(stream?.durationSeconds).toBe(86400);
  });

  it("updates stream state when a withdrawal event occurs", () => {
    // 1. Create stream
    indexer.ingestDecodedEvent({
      eventId: "evt_c1",
      contractId: "CC8H3XAKV2CONTRACT",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 1000,
      ledgerClosedAt: "2026-08-20T12:00:00.000Z",
      txHash: "tx_1",
      streamId: "stream_wd_test",
      sender: "GA5ZSEJY...",
      receiver: "GCSTREAM...",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "10000000000", // 1000 XLM
      amountFormatted: 1000,
      durationSeconds: 86400,
      rawPayload: {},
    });

    // 2. Partial withdrawal of 400 XLM
    indexer.ingestDecodedEvent({
      eventId: "evt_w1",
      contractId: "CC8H3XAKV2CONTRACT",
      contractVersion: "V2",
      topicAction: "withdraw",
      ledger: 1050,
      ledgerClosedAt: "2026-08-20T18:00:00.000Z",
      txHash: "tx_wd_1",
      streamId: "stream_wd_test",
      receiver: "GCSTREAM...",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "4000000000",
      amountFormatted: 400,
      rawPayload: {},
    });

    const stream = db.getStream("stream_wd_test");
    expect(stream?.withdrawnAmountFormatted).toBe(400);
    expect(stream?.status).toBe("ACTIVE");

    const withdrawals = db.getWithdrawals({ streamId: "stream_wd_test" });
    expect(withdrawals.length).toBe(1);
    expect(withdrawals[0].amountFormatted).toBe(400);
  });

  it("marks stream CANCELLED and records refund on cancel event", () => {
    indexer.ingestDecodedEvent({
      eventId: "evt_c2",
      contractId: "CC8H3XAKV2CONTRACT",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 1000,
      ledgerClosedAt: "2026-08-20T12:00:00.000Z",
      txHash: "tx_2",
      streamId: "stream_cancel_test",
      sender: "GA5ZSEJY...",
      receiver: "GCSTREAM...",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "10000000000",
      amountFormatted: 1000,
      durationSeconds: 86400,
      rawPayload: {},
    });

    indexer.ingestDecodedEvent({
      eventId: "evt_cancel_1",
      contractId: "CC8H3XAKV2CONTRACT",
      contractVersion: "V2",
      topicAction: "cancel",
      ledger: 1020,
      ledgerClosedAt: "2026-08-20T14:00:00.000Z",
      txHash: "tx_cancel_1",
      streamId: "stream_cancel_test",
      sender: "GA5ZSEJY...",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      refundAmount: "8000000000",
      refundAmountFormatted: 800,
      rawPayload: {},
    });

    const stream = db.getStream("stream_cancel_test");
    expect(stream?.status).toBe("CANCELLED");
    expect(stream?.refundAmountFormatted).toBe(800);
  });
});
