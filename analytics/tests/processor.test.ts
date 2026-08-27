import { describe, it, expect, beforeEach } from "vitest";
import { AnalyticsDatabase } from "../src/db/storage.js";
import { MetricsProcessor } from "../src/processor/metrics-processor.js";
import { EventIndexer } from "../src/indexer/event-indexer.js";

describe("MetricsProcessor & Aggregations", () => {
  let db: AnalyticsDatabase;
  let indexer: EventIndexer;
  let processor: MetricsProcessor;

  beforeEach(() => {
    db = new AnalyticsDatabase();
    indexer = new EventIndexer(db);
    processor = new MetricsProcessor(db);

    // Seed 3 test streams
    indexer.ingestDecodedEvent({
      eventId: "e1",
      contractId: "C_V2",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 100,
      ledgerClosedAt: "2026-08-20T10:00:00.000Z",
      txHash: "tx1",
      streamId: "s1",
      sender: "G_USER1",
      receiver: "G_REC1",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "1000000000",
      amountFormatted: 100,
      durationSeconds: 86400,
      rawPayload: {},
    });

    indexer.ingestDecodedEvent({
      eventId: "e2",
      contractId: "C_V2",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 110,
      ledgerClosedAt: "2026-08-20T11:00:00.000Z",
      txHash: "tx2",
      streamId: "s2",
      sender: "G_USER1",
      receiver: "G_REC2",
      tokenAddress: "C_USDC",
      tokenSymbol: "USDC",
      amount: "2000000000",
      amountFormatted: 200,
      durationSeconds: 7 * 86400,
      rawPayload: {},
    });

    indexer.ingestDecodedEvent({
      eventId: "e3",
      contractId: "C_V2",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 120,
      ledgerClosedAt: "2026-08-21T09:00:00.000Z",
      txHash: "tx3",
      streamId: "s3",
      sender: "G_USER2",
      receiver: "G_REC1",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "3000000000",
      amountFormatted: 300,
      durationSeconds: 30 * 86400,
      rawPayload: {},
    });

    // 1 withdrawal on s1 of 50 XLM
    indexer.ingestDecodedEvent({
      eventId: "e4",
      contractId: "C_V2",
      contractVersion: "V2",
      topicAction: "withdraw",
      ledger: 130,
      ledgerClosedAt: "2026-08-20T18:00:00.000Z",
      txHash: "tx4",
      streamId: "s1",
      receiver: "G_REC1",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "500000000",
      amountFormatted: 50,
      rawPayload: {},
    });
  });

  it("calculates accurate TVL over tokens", () => {
    const tvl = processor.getTvlMetrics();
    // s1 active tvl = 100 - 50 = 50 XLM
    // s3 active tvl = 300 XLM
    // total XLM TVL = 350
    // s2 active tvl = 200 USDC
    // Total active TVL = 550
    expect(tvl.currentTotalTvlFormatted).toBe(550);
    expect(tvl.tokens.length).toBe(2);

    const xlmToken = tvl.tokens.find((t) => t.tokenSymbol === "XLM");
    expect(xlmToken?.activeTvlFormatted).toBe(350);

    const usdcToken = tvl.tokens.find((t) => t.tokenSymbol === "USDC");
    expect(usdcToken?.activeTvlFormatted).toBe(200);
  });

  it("aggregates volume metrics by day and week", () => {
    const dailyVolume = processor.getVolumeMetrics("day");
    expect(dailyVolume.totalStreams).toBe(3);
    expect(dailyVolume.totalVolumeFormatted).toBe(600);
    expect(dailyVolume.averageStreamSizeFormatted).toBe(200);
    expect(dailyVolume.buckets.length).toBe(2); // 2026-08-20 and 2026-08-21
  });

  it("calculates duration metrics and distribution", () => {
    const duration = processor.getDurationMetrics();
    expect(duration.minDurationSeconds).toBe(86400);
    expect(duration.maxDurationSeconds).toBe(30 * 86400);
    expect(duration.distribution.under1Day).toBe(0);
    expect(duration.distribution.day1To7).toBe(2); // 1d and 7d
    expect(duration.distribution.day7To30).toBe(1); // 30d
  });

  it("calculates amount percentiles and size distribution", () => {
    const amounts = processor.getAmountMetrics();
    expect(amounts.totalVolumeFormatted).toBe(600);
    expect(amounts.averageAmountFormatted).toBe(200);
    expect(amounts.minAmountFormatted).toBe(100);
    expect(amounts.maxAmountFormatted).toBe(300);
  });

  it("calculates withdrawal patterns correctly", () => {
    const withdrawals = processor.getWithdrawalPatterns();
    expect(withdrawals.totalWithdrawals).toBe(1);
    expect(withdrawals.totalWithdrawnFormatted).toBe(50);
    expect(withdrawals.averageWithdrawalAmountFormatted).toBe(50);
  });
});
