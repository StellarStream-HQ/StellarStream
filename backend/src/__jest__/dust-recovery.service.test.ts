/**
 * Tests for DustRecoveryService (Issue #1182)
 *
 * Validates:
 *  - Dust detection (< 1 XLM remaining balance)
 *  - Recommendation grouping and strategy assignment
 *  - Pagination across 1 000 accounts
 *  - Recovery execution (cancel + audit log)
 *  - Edge cases: zero balance, exact threshold, already-canceled, non-existent
 */

import { DustRecoveryService } from "../services/dust-recovery.service.js";

// ── Mock prisma ────────────────────────────────────────────────────────────────

const STROOPS = 10_000_000n;

// In-memory store mimicking the Stream and EventLog tables
type FakeStream = {
  id: string;
  streamId: string | null;
  sender: string;
  receiver: string;
  tokenAddress: string | null;
  amount: string;
  withdrawn: string;
  status: string;
  isDust: boolean;
};

type FakeEventLog = {
  id: string;
  eventType: string;
  streamId: string;
  txHash: string;
  eventIndex: number;
  ledger: number;
  ledgerClosedAt: string;
  sender: string | null;
  amount: bigint | null;
  metadata: string | null;
  parentHash: string | null;
  entryHash: string | null;
  createdAt: Date;
};

let fakeStreams: FakeStream[] = [];
let fakeEventLogs: FakeEventLog[] = [];
let idSeq = 1;

function nextId() {
  return `id_${idSeq++}`;
}

function makeStream(overrides: Partial<FakeStream> = {}): FakeStream {
  return {
    id: nextId(),
    streamId: null,
    sender: `G${"A".repeat(55)}`,
    receiver: `G${"B".repeat(55)}`,
    tokenAddress: null,
    amount: (5n * STROOPS).toString(),
    withdrawn: "0",
    status: "ACTIVE",
    isDust: false,
    ...overrides,
  };
}

// Build the prisma mock before importing the service
jest.mock("../lib/db.js", () => ({
  prisma: {
    stream: {
      findMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        let rows = [...fakeStreams];

        // Filter by status
        if (where.status?.in) {
          const allowed = new Set(where.status.in);
          rows = rows.filter((r) => allowed.has(r.status));
        }

        // Filter by tokenAddress: null means native XLM only
        if ("tokenAddress" in where && where.tokenAddress === null) {
          rows = rows.filter((r) => r.tokenAddress === null);
        }

        // id in filter (for recoverDust batch fetch)
        if (where.id?.in) {
          const ids = new Set(where.id.in);
          rows = rows.filter((r) => ids.has(r.id));
        }

        // Cursor-based pagination
        if (args?.cursor?.id) {
          const cursorIdx = rows.findIndex((r) => r.id === args.cursor.id);
          if (cursorIdx !== -1) rows = rows.slice(cursorIdx + 1);
          if (args.skip) rows = rows.slice(args.skip);
        }

        // take
        if (typeof args?.take === "number") rows = rows.slice(0, args.take);

        return rows.map((r) => ({
          id: r.id,
          streamId: r.streamId,
          sender: r.sender,
          receiver: r.receiver,
          tokenAddress: r.tokenAddress,
          amount: r.amount,
          withdrawn: r.withdrawn,
          status: r.status,
        }));
      }),
      update: jest.fn(async (args: any) => {
        const id = args.where?.id;
        const stream = fakeStreams.find((s) => s.id === id);
        if (!stream) throw new Error(`Stream ${id} not found`);
        Object.assign(stream, args.data);
        return stream;
      }),
    },
    eventLog: {
      create: jest.fn(async (args: any) => {
        const row: FakeEventLog = {
          id: nextId(),
          eventType: args.data.eventType,
          streamId: args.data.streamId,
          txHash: args.data.txHash,
          eventIndex: args.data.eventIndex ?? 0,
          ledger: args.data.ledger ?? 0,
          ledgerClosedAt: args.data.ledgerClosedAt ?? "",
          sender: args.data.sender ?? null,
          amount: args.data.amount ?? null,
          metadata: args.data.metadata ?? null,
          parentHash: null,
          entryHash: null,
          createdAt: new Date(),
        };
        fakeEventLogs.push(row);
        return row;
      }),
    },
  },
}));

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  fakeStreams = [];
  fakeEventLogs = [];
  idSeq = 1;
  jest.clearAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

const SENDER_A = `G${"A".repeat(55)}`;
const SENDER_B = `G${"B".repeat(55)}`;
const RECEIVER = `G${"C".repeat(55)}`;
const EXECUTOR = `G${"D".repeat(55)}`;

function xlmStroops(xlm: number) {
  return (BigInt(xlm) * STROOPS).toString();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DustRecoveryService", () => {
  const service = new DustRecoveryService();

  // ── getRecommendations ──────────────────────────────────────────────────────

  describe("getRecommendations", () => {
    it("returns empty recommendations when no streams exist", async () => {
      const result = await service.getRecommendations();
      expect(result.scannedStreams).toBe(0);
      expect(result.dustStreamsFound).toBe(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it("does not flag a stream with exactly 1 XLM remaining as dust", async () => {
      // 2 XLM total, 1 XLM withdrawn → exactly 1 XLM remaining (not dust)
      fakeStreams.push(makeStream({ amount: xlmStroops(2), withdrawn: xlmStroops(1) }));
      const result = await service.getRecommendations();
      expect(result.dustStreamsFound).toBe(0);
    });

    it("flags a stream with 0.5 XLM remaining as dust", async () => {
      // 1 XLM total, 0.5 XLM withdrawn → 0.5 XLM remaining (dust)
      fakeStreams.push(
        makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS / 2n).toString() }),
      );
      const result = await service.getRecommendations();
      expect(result.dustStreamsFound).toBe(1);
      expect(result.recommendations).toHaveLength(1);
    });

    it("flags a stream with zero remaining balance as dust", async () => {
      fakeStreams.push(makeStream({ amount: xlmStroops(1), withdrawn: xlmStroops(1) }));
      const result = await service.getRecommendations();
      expect(result.dustStreamsFound).toBe(1);
      const rec = result.recommendations[0];
      expect(rec.strategy).toBe("flag_only");
    });

    it("assigns cancel_and_refund for a single dust stream with positive balance", async () => {
      fakeStreams.push(makeStream({ amount: xlmStroops(1), withdrawn: xlmStroops(1) - 100n }));

      const result = await service.getRecommendations();
      expect(result.recommendations[0].strategy).toBe("cancel_and_refund");
    });

    it("assigns merge_and_reopen when multiple dust streams sum to >= 1 XLM", async () => {
      // Two streams, each with 0.6 XLM dust → total 1.2 XLM ≥ 1 XLM
      const dust = (BigInt(6) * STROOPS) / 10n;
      fakeStreams.push(
        makeStream({ sender: SENDER_A, amount: xlmStroops(1), withdrawn: (STROOPS - dust).toString() }),
        makeStream({ sender: SENDER_A, amount: xlmStroops(1), withdrawn: (STROOPS - dust).toString() }),
      );

      const result = await service.getRecommendations();
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0].strategy).toBe("merge_and_reopen");
    });

    it("skips PAUSED streams (only ACTIVE/PAUSED allowed by query)", async () => {
      // PAUSED is still included per spec
      fakeStreams.push(makeStream({ status: "PAUSED", amount: xlmStroops(1), withdrawn: xlmStroops(1) }));
      const result = await service.getRecommendations();
      expect(result.dustStreamsFound).toBe(1);
    });

    it("skips COMPLETED and CANCELED streams", async () => {
      fakeStreams.push(
        makeStream({ status: "COMPLETED", amount: xlmStroops(1), withdrawn: xlmStroops(1) }),
        makeStream({ status: "CANCELED", amount: xlmStroops(1), withdrawn: xlmStroops(1) }),
      );
      const result = await service.getRecommendations();
      // The mock filters by status.in: [ACTIVE, PAUSED]
      expect(result.dustStreamsFound).toBe(0);
    });

    it("ignores non-XLM (non-null tokenAddress) streams", async () => {
      fakeStreams.push(
        makeStream({ tokenAddress: "USDC:GABCD", amount: xlmStroops(1), withdrawn: xlmStroops(1) }),
      );
      const result = await service.getRecommendations();
      expect(result.dustStreamsFound).toBe(0);
    });

    it("groups streams by sender correctly", async () => {
      const dustWithdrawn = (STROOPS - 100n).toString();
      fakeStreams.push(
        makeStream({ sender: SENDER_A, amount: xlmStroops(1), withdrawn: dustWithdrawn }),
        makeStream({ sender: SENDER_A, amount: xlmStroops(1), withdrawn: dustWithdrawn }),
        makeStream({ sender: SENDER_B, amount: xlmStroops(1), withdrawn: dustWithdrawn }),
      );
      const result = await service.getRecommendations();
      expect(result.recommendations).toHaveLength(2);
      expect(result.affectedAccounts).toBe(2);
    });

    it("sorts recommendations by most recoverable dust first", async () => {
      const smallDust = 100n;
      const bigDust = 5_000_000n; // 0.5 XLM
      fakeStreams.push(
        makeStream({ sender: SENDER_A, amount: xlmStroops(1), withdrawn: (STROOPS - smallDust).toString() }),
        makeStream({ sender: SENDER_B, amount: xlmStroops(1), withdrawn: (STROOPS - bigDust).toString() }),
      );
      const result = await service.getRecommendations();
      expect(result.recommendations[0].sender).toBe(SENDER_B);
    });

    // ── 1 000 accounts scale test ───────────────────────────────────────────

    it("handles 1 000 accounts with dust correctly", async () => {
      const ACCOUNTS = 1_000;
      const dustWithdrawn = (STROOPS - 500_000n).toString(); // 0.05 XLM dust each

      for (let i = 0; i < ACCOUNTS; i++) {
        const sender = `G${String(i).padStart(55, "0")}`;
        fakeStreams.push(
          makeStream({ sender, receiver: RECEIVER, amount: xlmStroops(1), withdrawn: dustWithdrawn }),
        );
      }

      const result = await service.getRecommendations();
      expect(result.scannedStreams).toBe(ACCOUNTS);
      expect(result.dustStreamsFound).toBe(ACCOUNTS);
      expect(result.affectedAccounts).toBe(ACCOUNTS);
      expect(result.recommendations).toHaveLength(ACCOUNTS);
      // All single-stream groups with < 1 XLM → cancel_and_refund
      for (const rec of result.recommendations) {
        expect(rec.strategy).toBe("cancel_and_refund");
        expect(rec.streamCount).toBe(1);
      }
    });

    it("handles 1 000 accounts where half have non-dust streams", async () => {
      for (let i = 0; i < 1_000; i++) {
        const sender = `G${String(i).padStart(55, "0")}`;
        const isDust = i % 2 === 0;
        fakeStreams.push(
          makeStream({
            sender,
            amount: xlmStroops(2),
            // Dust: 0.05 XLM remaining; clean: 1.5 XLM remaining
            withdrawn: isDust ? (STROOPS * 2n - 500_000n).toString() : xlmStroops(1) + "500000",
          }),
        );
      }

      const result = await service.getRecommendations();
      expect(result.scannedStreams).toBe(1_000);
      expect(result.dustStreamsFound).toBe(500);
    });
  });

  // ── recoverDust ─────────────────────────────────────────────────────────────

  describe("recoverDust", () => {
    it("returns empty result when given no IDs", async () => {
      const result = await service.recoverDust([], EXECUTOR);
      expect(result.recovered).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it("marks an eligible dust stream as CANCELED", async () => {
      const stream = makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS - 100n).toString() });
      fakeStreams.push(stream);

      const result = await service.recoverDust([stream.id], EXECUTOR);
      expect(result.recovered).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      const updated = fakeStreams.find((s) => s.id === stream.id);
      expect(updated?.status).toBe("CANCELED");
      expect(updated?.isDust).toBe(true);
    });

    it("creates an audit EventLog entry for each recovered stream", async () => {
      const stream = makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS - 100n).toString() });
      fakeStreams.push(stream);

      await service.recoverDust([stream.id], EXECUTOR);

      expect(fakeEventLogs).toHaveLength(1);
      const log = fakeEventLogs[0];
      expect(log.eventType).toBe("dust_recovery");
      expect(log.sender).toBe(stream.sender);
    });

    it("skips a stream that no longer has dust (balance >= 1 XLM)", async () => {
      const stream = makeStream({ amount: xlmStroops(2), withdrawn: "0" });
      fakeStreams.push(stream);

      const result = await service.recoverDust([stream.id], EXECUTOR);
      expect(result.skipped).toBe(1);
      expect(result.recovered).toBe(0);

      const unchanged = fakeStreams.find((s) => s.id === stream.id);
      expect(unchanged?.status).toBe("ACTIVE");
    });

    it("skips a stream that is already CANCELED", async () => {
      const stream = makeStream({ status: "CANCELED", amount: xlmStroops(1), withdrawn: xlmStroops(1) });
      fakeStreams.push(stream);

      const result = await service.recoverDust([stream.id], EXECUTOR);
      expect(result.skipped).toBe(1);
      expect(result.details[0].reason).toMatch(/CANCELED/);
    });

    it("skips a stream ID that does not exist", async () => {
      const result = await service.recoverDust(["nonexistent_id"], EXECUTOR);
      expect(result.skipped).toBe(1);
      expect(result.details[0].reason).toMatch(/not found/i);
    });

    it("processes mixed bag: some recovered, some skipped", async () => {
      const dustStream = makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS - 100n).toString() });
      const cleanStream = makeStream({ amount: xlmStroops(5), withdrawn: "0" });
      fakeStreams.push(dustStream, cleanStream);

      const result = await service.recoverDust([dustStream.id, cleanStream.id], EXECUTOR);
      expect(result.recovered).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("includes executedBy in audit log metadata", async () => {
      const stream = makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS - 200n).toString() });
      fakeStreams.push(stream);

      await service.recoverDust([stream.id], EXECUTOR);

      const log = fakeEventLogs[0];
      const meta = JSON.parse(log.metadata!);
      expect(meta.recoveredBy).toBe(EXECUTOR);
    });

    it("bulk-recovers 1 000 dust streams", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 1_000; i++) {
        const s = makeStream({ amount: xlmStroops(1), withdrawn: (STROOPS - 100n).toString() });
        fakeStreams.push(s);
        ids.push(s.id);
      }

      const result = await service.recoverDust(ids, EXECUTOR);
      expect(result.recovered).toBe(1_000);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(fakeEventLogs).toHaveLength(1_000);
    });
  });
});
