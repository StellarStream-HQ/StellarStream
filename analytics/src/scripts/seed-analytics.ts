import { getDatabase } from "../db/storage.js";
import { MetricsProcessor } from "../processor/metrics-processor.js";
import { DecodedContractEvent } from "../indexer/types.js";
import { EventIndexer } from "../indexer/event-indexer.js";

export function seedAnalyticsData(db = getDatabase()) {
  db.clear();
  const processor = new MetricsProcessor(db);
  const indexer = new EventIndexer(db);

  console.log("[Seed] Generating synthetic contract analytics data...");

  const tokens = [
    { symbol: "XLM", address: "native", decimals: 7, baseTvl: 125000 },
    { symbol: "USDC", address: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWUIE3USSTHZX5FS6HG", decimals: 7, baseTvl: 85000 },
    { symbol: "EURC", address: "CBBHX32D37OQZ4F2Z5UPNUGT76FZEQ3NCSJ6D7324P2B37U5FS742EUZ", decimals: 7, baseTvl: 24000 },
  ];

  const senders = [
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP54J2ALDSTTRFUFF4L2L3HAKFPO",
    "GCOGNITIVE3457KJDH73JDJDF84729384729384729384729384729384",
    "GDRN45678JHDYETUWOALDJFHE7382910485729104857291048572910",
    "GEXAMPLER6789KJHDYE7381902847591028374910283749102837491",
  ];

  const receivers = [
    "GCSTREAMEE1234567890ABCDEF1234567890ABCDEF1234567890ABCD",
    "GDRECEIVER2345678901ABCDEF2345678901ABCDEF2345678901ABCDE",
    "GEBENEFICIARY3456789012ABCDEF3456789012ABCDEF3456789012AB",
    "GFEMPLOYEE4567890123ABCDEF4567890123ABCDEF4567890123ABCD",
    "GGCONTRACTOR5678901234ABCDEF5678901234ABCDEF5678901234ABC",
  ];

  const now = Date.now();
  let baseLedger = 620000;

  // Generate 60 days of historical events & streams
  for (let dayOffset = 60; dayOffset >= 0; dayOffset--) {
    const dayDate = new Date(now - dayOffset * 24 * 3600 * 1000);
    const dayStr = dayDate.toISOString().split("T")[0];
    const streamsToday = Math.floor(8 + Math.random() * 12);

    for (let i = 0; i < streamsToday; i++) {
      baseLedger += Math.floor(1 + Math.random() * 5);
      const token = tokens[Math.floor(Math.random() * tokens.length)];
      const sender = senders[Math.floor(Math.random() * senders.length)];
      const receiver = receivers[Math.floor(Math.random() * receivers.length)];
      const streamId = `stream_${dayOffset}_${i}`;

      const amountFormatted = Math.floor(50 + Math.random() * 2500);
      const amountStroops = String(BigInt(amountFormatted) * 10000000n);
      const durationSeconds = [86400, 7 * 86400, 14 * 86400, 30 * 86400, 90 * 86400][Math.floor(Math.random() * 5)];
      const startTime = Math.floor(dayDate.getTime() / 1000);
      const endTime = startTime + durationSeconds;

      const txHash = `tx_${baseLedger}_${Math.random().toString(36).substring(2, 9)}`;

      // 1. Create Stream Event
      const createEvent: DecodedContractEvent = {
        eventId: `evt_create_${streamId}`,
        contractId: "CC8H3XAKTESTNETCONTRACTV2",
        contractVersion: Math.random() > 0.15 ? "V2" : "V1",
        topicAction: "create",
        ledger: baseLedger,
        ledgerClosedAt: dayDate.toISOString(),
        txHash,
        streamId,
        sender,
        receiver,
        tokenAddress: token.address,
        tokenSymbol: token.symbol,
        amount: amountStroops,
        amountFormatted,
        startTime,
        endTime,
        durationSeconds,
        gasConsumed: Math.floor(160000 + Math.random() * 40000),
        feeChargedStroops: 100,
        memoryBytes: Math.floor(42000 + Math.random() * 8000),
        rawPayload: { stream_id: streamId, sender, receiver, amount: amountStroops },
      };
      indexer.ingestDecodedEvent(createEvent);

      // 2. Withdrawals
      if (dayOffset > 5 && Math.random() > 0.3) {
        const withdrawAmount = Math.floor(amountFormatted * (0.2 + Math.random() * 0.7));
        const withdrawStroops = String(BigInt(withdrawAmount) * 10000000n);
        const withdrawTime = new Date(dayDate.getTime() + (durationSeconds * 0.4 * 1000));

        const withdrawEvent: DecodedContractEvent = {
          eventId: `evt_wd_${streamId}`,
          contractId: "CC8H3XAKTESTNETCONTRACTV2",
          contractVersion: "V2",
          topicAction: "withdraw",
          ledger: baseLedger + 20,
          ledgerClosedAt: withdrawTime.toISOString(),
          txHash: `tx_wd_${streamId}`,
          streamId,
          receiver,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          amount: withdrawStroops,
          amountFormatted: withdrawAmount,
          gasConsumed: Math.floor(140000 + Math.random() * 30000),
          feeChargedStroops: 100,
          memoryBytes: 38000,
          rawPayload: { stream_id: streamId, amount: withdrawStroops },
        };
        indexer.ingestDecodedEvent(withdrawEvent);
      }

      // 3. Cancellations (about 6% cancellation rate)
      if (dayOffset > 10 && Math.random() < 0.06) {
        const cancelTime = new Date(dayDate.getTime() + 86400 * 3000);
        const refundFormatted = Math.floor(amountFormatted * 0.6);
        const refundStroops = String(BigInt(refundFormatted) * 10000000n);

        const cancelEvent: DecodedContractEvent = {
          eventId: `evt_cancel_${streamId}`,
          contractId: "CC8H3XAKTESTNETCONTRACTV2",
          contractVersion: "V2",
          topicAction: "cancel",
          ledger: baseLedger + 50,
          ledgerClosedAt: cancelTime.toISOString(),
          txHash: `tx_cancel_${streamId}`,
          streamId,
          sender,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          refundAmount: refundStroops,
          refundAmountFormatted: refundFormatted,
          gasConsumed: 180000,
          feeChargedStroops: 100,
          memoryBytes: 44000,
          rawPayload: { stream_id: streamId, refund_amount: refundStroops },
        };
        indexer.ingestDecodedEvent(cancelEvent);
      }
    }

    // Daily rollup
    processor.calculateDailyRollup(dayStr);

    // TVL snapshot
    for (const t of tokens) {
      db.insertTvlSnapshot({
        id: `snap_${dayStr}_${t.symbol}`,
        timestamp: `${dayStr}T23:59:59.000Z`,
        tokenAddress: t.address,
        tokenSymbol: t.symbol,
        totalDepositedFormatted: t.baseTvl * (1 + (60 - dayOffset) * 0.015),
        totalWithdrawnFormatted: t.baseTvl * 0.45 * (1 + (60 - dayOffset) * 0.012),
        activeTvlFormatted: t.baseTvl * 0.55 * (1 + (60 - dayOffset) * 0.018),
        activeStreamCount: Math.floor(15 + (60 - dayOffset) * 0.8),
      });
    }
  }

  // Monthly retention cohorts
  const cohortMonths = ["2026-06", "2026-07", "2026-08"];
  cohortMonths.forEach((m, idx) => {
    db.upsertRetentionCohort({
      cohortMonth: m,
      cohortSize: 45 + idx * 25,
      activeSenders: 38 + idx * 22,
      day1RetentionRate: 92.4,
      day7RetentionRate: 78.5,
      day14RetentionRate: 64.2,
      day30RetentionRate: 52.0 - idx * 2,
      day60RetentionRate: idx < 2 ? 44.5 : 0,
      day90RetentionRate: idx < 1 ? 38.0 : 0,
      repeatStreamerRate: 68.5 + idx * 3.2,
      avgStreamsPerUser: 3.4 + idx * 0.4,
    });
  });

  db.updateIndexerState({
    lastLedger: baseLedger,
    totalEventsProcessed: db.getEvents({ limit: 10000 }).total,
    status: "RUNNING",
  });

  console.log(`[Seed] Successfully seeded ${db.getStreams().length} streams, ${db.getEvents({ limit: 10000 }).total} events.`);
}

if (process.argv[1] && (process.argv[1].endsWith("seed-analytics.ts") || process.argv[1].endsWith("seed-analytics.js"))) {
  seedAnalyticsData();
}
