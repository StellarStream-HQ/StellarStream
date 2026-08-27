import { describe, it, expect, beforeEach } from "vitest";
import { AnalyticsDatabase } from "../src/db/storage.js";
import { EventIndexer } from "../src/indexer/event-indexer.js";
import { RetentionCohortAnalyzer } from "../src/processor/retention-cohorts.js";
import { RetentionManager } from "../src/db/retention.js";

describe("Retention & Historical Data Policies", () => {
  let db: AnalyticsDatabase;
  let indexer: EventIndexer;
  let analyzer: RetentionCohortAnalyzer;
  let retentionManager: RetentionManager;

  beforeEach(() => {
    db = new AnalyticsDatabase();
    indexer = new EventIndexer(db);
    analyzer = new RetentionCohortAnalyzer(db);
    retentionManager = new RetentionManager(db, { rawEventsDays: 30, gasRecordsDays: 30 });
  });

  it("calculates repeat streamer retention and cohorts", () => {
    // User 1 creates two streams (repeat user)
    indexer.ingestDecodedEvent({
      eventId: "e1",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 100,
      ledgerClosedAt: "2026-08-01T10:00:00.000Z",
      txHash: "tx1",
      streamId: "s1",
      sender: "G_REPEAT_USER",
      receiver: "G_REC1",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amountFormatted: 100,
      rawPayload: {},
    });

    indexer.ingestDecodedEvent({
      eventId: "e2",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 200,
      ledgerClosedAt: "2026-08-09T10:00:00.000Z",
      txHash: "tx2",
      streamId: "s2",
      sender: "G_REPEAT_USER",
      receiver: "G_REC2",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amountFormatted: 150,
      rawPayload: {},
    });

    // User 2 creates one stream
    indexer.ingestDecodedEvent({
      eventId: "e3",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 150,
      ledgerClosedAt: "2026-08-05T10:00:00.000Z",
      txHash: "tx3",
      streamId: "s3",
      sender: "G_SINGLE_USER",
      receiver: "G_REC3",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amountFormatted: 80,
      rawPayload: {},
    });

    const retention = analyzer.getRetentionMetrics();
    expect(retention.totalSenders).toBe(2);
    expect(retention.totalUniqueUsers).toBe(5); // 2 senders + 3 receivers
    expect(retention.overallRepeatRatePercent).toBe(50); // 1 out of 2 senders repeated
    expect(retention.cohorts.length).toBe(1);
    expect(retention.cohorts[0].cohortMonth).toBe("2026-08");
    expect(retention.cohorts[0].day7).toBe(50);
  });

  it("prunes old raw events according to retention policy while keeping streams intact", () => {
    // Old event from 60 days ago
    const oldDate = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
    indexer.ingestDecodedEvent({
      eventId: "e_old",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 50,
      ledgerClosedAt: oldDate,
      txHash: "tx_old",
      streamId: "s_old",
      sender: "G_OLD_USER",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amountFormatted: 500,
      rawPayload: { big_debug_info: "abc".repeat(100) },
    });

    // Recent event
    indexer.ingestDecodedEvent({
      eventId: "e_recent",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 500,
      ledgerClosedAt: new Date().toISOString(),
      txHash: "tx_recent",
      streamId: "s_recent",
      sender: "G_NEW_USER",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amountFormatted: 200,
      rawPayload: {},
    });

    expect(db.getEvents().total).toBe(2);
    expect(db.getStreams().length).toBe(2);

    const runResult = retentionManager.executeRetentionPolicy();
    expect(runResult.prunedRawEvents).toBe(1);
    expect(db.getEvents().total).toBe(1); // 1 pruned
    expect(db.getStreams().length).toBe(2); // stream lifecycle state still preserved!
  });
});
