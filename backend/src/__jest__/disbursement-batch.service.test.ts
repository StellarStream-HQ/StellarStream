import {
  runBatch,
  runBatches,
  exportBatchResultsCsv,
  getBatchProgress,
  clearBatchProgress,
  MAX_BATCH_SIZE,
  type DisbursementItem,
  type DisbursementProcessor,
  type BatchProgress,
} from "../services/disbursement-batch.service.js";

/** Build N valid-looking disbursement items. */
function makeItems(n: number, amount = "1000000"): DisbursementItem[] {
  return Array.from({ length: n }, (_, i) => ({
    recipientAddress: `GADDRESS${i.toString().padStart(48, "0")}`,
    amountStroops: amount,
    asset: "native",
    reference: `ref-${i}`,
  }));
}

/** A processor that always succeeds with a synthetic tx hash. */
const okProcessor: DisbursementProcessor = async (_item, ctx) => ({
  txHash: `tx-${ctx.index}`,
});

/** Common options: no real persistence, no webhooks, no backoff waiting. */
const baseOpts = {
  persist: false as const,
  notifyWebhooks: false as const,
  retryBaseDelayMs: 0,
};

describe("runBatch", () => {
  it("processes every item and reports COMPLETED when all succeed", async () => {
    const result = await runBatch(makeItems(5), {
      ...baseOpts,
      processor: okProcessor,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(5);
    expect(result.results.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(result.results.every((r) => r.txHash !== null)).toBe(true);
    // results preserve input order
    expect(result.results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.requiresCompensation).toHaveLength(0);
  });

  it("rejects batches larger than MAX_BATCH_SIZE", async () => {
    await expect(
      runBatch(makeItems(MAX_BATCH_SIZE + 1), {
        ...baseOpts,
        processor: okProcessor,
      }),
    ).rejects.toThrow(/exceeds the maximum/);
  });

  it("accepts exactly MAX_BATCH_SIZE items", async () => {
    const result = await runBatch(makeItems(MAX_BATCH_SIZE), {
      ...baseOpts,
      processor: okProcessor,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.succeeded).toBe(MAX_BATCH_SIZE);
  });

  it("handles an empty batch", async () => {
    const result = await runBatch([], { ...baseOpts, processor: okProcessor });
    expect(result.status).toBe("COMPLETED");
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("retry logic", () => {
  it("retries a flaky item and eventually succeeds", async () => {
    const attemptsByIndex = new Map<number, number>();
    const flaky: DisbursementProcessor = async (_item, ctx) => {
      const n = (attemptsByIndex.get(ctx.index) ?? 0) + 1;
      attemptsByIndex.set(ctx.index, n);
      if (n < 3) throw new Error("transient RPC error");
      return { txHash: `tx-${ctx.index}` };
    };

    const result = await runBatch(makeItems(1), {
      ...baseOpts,
      maxRetries: 3,
      processor: flaky,
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.results[0].attempts).toBe(3);
    expect(result.results[0].status).toBe("COMPLETED");
  });

  it("marks an item FAILED after exhausting retries", async () => {
    const alwaysFails: DisbursementProcessor = async () => {
      throw new Error("permanent failure");
    };

    const result = await runBatch(makeItems(1), {
      ...baseOpts,
      atomic: false,
      maxRetries: 2,
      processor: alwaysFails,
    });

    expect(result.results[0].status).toBe("FAILED");
    expect(result.results[0].attempts).toBe(3); // initial + 2 retries
    expect(result.results[0].error).toMatch(/permanent failure/);
    expect(result.status).toBe("FAILED");
  });
});

describe("atomic mode (all succeed or all fail)", () => {
  it("aborts remaining items once one permanently fails", async () => {
    const failAt = 3;
    const processor: DisbursementProcessor = async (_item, ctx) => {
      if (ctx.index === failAt) throw new Error("boom");
      return { txHash: `tx-${ctx.index}` };
    };

    const result = await runBatch(makeItems(10), {
      ...baseOpts,
      atomic: true,
      concurrency: 1,
      maxRetries: 0,
      processor,
    });

    expect(result.status).toBe("FAILED");
    expect(result.atomic).toBe(true);
    // index 3 failed; everything after it should be cancelled
    expect(result.results[failAt].status).toBe("FAILED");
    expect(result.results.slice(failAt + 1).every((r) => r.status === "CANCELLED")).toBe(true);
    // the items that already succeeded are flagged for compensation
    expect(result.requiresCompensation.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("best-effort (non-atomic) mode processes all items independently", async () => {
    const processor: DisbursementProcessor = async (_item, ctx) => {
      if (ctx.index % 2 === 0) throw new Error("even fails");
      return { txHash: `tx-${ctx.index}` };
    };

    const result = await runBatch(makeItems(10), {
      ...baseOpts,
      atomic: false,
      maxRetries: 0,
      processor,
    });

    expect(result.status).toBe("FAILED"); // some failed
    expect(result.cancelled).toBe(0); // nothing cancelled in best-effort mode
    expect(result.succeeded).toBe(5);
    expect(result.failed).toBe(5);
  });
});

describe("progress tracking", () => {
  it("emits monotonic progress and exposes a queryable snapshot", async () => {
    const snapshots: BatchProgress[] = [];
    const result = await runBatch(makeItems(20), {
      ...baseOpts,
      batchId: "progress-test",
      processor: okProcessor,
      onProgress: (p) => snapshots.push(p),
    });

    // processed count never decreases
    const processedSeq = snapshots.map((s) => s.processed);
    for (let i = 1; i < processedSeq.length; i++) {
      expect(processedSeq[i]).toBeGreaterThanOrEqual(processedSeq[i - 1]);
    }

    const final = getBatchProgress("progress-test");
    expect(final?.status).toBe("COMPLETED");
    expect(final?.processed).toBe(20);
    expect(result.completedAt).not.toBeNull();

    clearBatchProgress("progress-test");
    expect(getBatchProgress("progress-test")).toBeUndefined();
  });
});

describe("runBatches (chunking large inputs)", () => {
  it("splits 2500 items into 3 batches of <= MAX_BATCH_SIZE", async () => {
    const results = await runBatches(makeItems(2500), {
      ...baseOpts,
      batchId: "multi",
      concurrency: 16,
      processor: okProcessor,
    });

    expect(results).toHaveLength(3);
    expect(results[0].total).toBe(1000);
    expect(results[1].total).toBe(1000);
    expect(results[2].total).toBe(500);
    expect(results.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(results.map((r) => r.batchId)).toEqual([
      "multi-chunk0",
      "multi-chunk1",
      "multi-chunk2",
    ]);
  });
});

describe("CSV export", () => {
  it("includes a header and one row per result", async () => {
    const result = await runBatch(makeItems(3), {
      ...baseOpts,
      processor: okProcessor,
    });
    const csv = exportBatchResultsCsv(result);
    const lines = csv.trim().split("\n");

    expect(lines[0]).toBe(
      "batch_id,index,recipient_address,amount_stroops,asset,reference,status,attempts,tx_hash,error",
    );
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[1]).toContain("COMPLETED");
  });

  it("escapes cells containing commas and quotes", async () => {
    const failing: DisbursementProcessor = async () => {
      throw new Error('bad, value with "quotes"');
    };
    const result = await runBatch(makeItems(1), {
      ...baseOpts,
      atomic: false,
      maxRetries: 0,
      processor: failing,
    });
    const csv = exportBatchResultsCsv(result);
    expect(csv).toContain('"bad, value with ""quotes"""');
  });

  it("returns just a header for empty input", () => {
    const csv = exportBatchResultsCsv([]);
    expect(csv.trim().split("\n")).toHaveLength(1);
  });
});

describe("scale", () => {
  it(
    "processes 10,000 disbursements across batches",
    async () => {
      const TOTAL = 10_000;
      let processed = 0;
      const counting: DisbursementProcessor = async (_item, ctx) => {
        processed += 1;
        return { txHash: `tx-${ctx.index}` };
      };

      const results = await runBatches(makeItems(TOTAL), {
        ...baseOpts,
        batchId: "scale-10k",
        concurrency: 32,
        processor: counting,
      });

      expect(results).toHaveLength(Math.ceil(TOTAL / MAX_BATCH_SIZE)); // 10
      expect(processed).toBe(TOTAL);

      const totalSucceeded = results.reduce((sum, r) => sum + r.succeeded, 0);
      expect(totalSucceeded).toBe(TOTAL);
      expect(results.every((r) => r.status === "COMPLETED")).toBe(true);

      // CSV of the whole run has 10k rows + 1 header
      const csv = exportBatchResultsCsv(results);
      expect(csv.trim().split("\n")).toHaveLength(TOTAL + 1);
    },
    30_000,
  );
});
