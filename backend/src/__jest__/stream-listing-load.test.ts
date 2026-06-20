import request from "supertest";
import express, { Express } from "express";

jest.mock("../lib/db.js", () => ({
  prisma: {
    stream: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    eventLog: {
      findMany: jest.fn(),
    },
  },
}));

// sanitize.ts uses `import.meta.url`, which ts-jest can't compile under the
// CommonJS transform this project's jest.config.js forces. Stub it out so
// importing streams.routes.ts (which depends on it) doesn't fail to compile.
jest.mock("../security/sanitize.js", () => ({
  sanitizeUnknown: (input: unknown) => input,
}));

import { prisma } from "../lib/db.js";
import streamsRouter from "../api/streams.routes.js";

const ADDRESS = "G" + "A".repeat(55);

function buildMockStream(index: number) {
  return {
    id: `stream_${index}`,
    streamId: `contract_${index}`,
    txHash: `tx_${index}`,
    sender: ADDRESS,
    receiver: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    tokenAddress: "CUSDC",
    amount: "1000000000",
    duration: 86400,
    status: "ACTIVE",
    withdrawn: "0",
    legacy: false,
    migrated: false,
    isPrivate: false,
    createdAt: new Date(),
  };
}

async function runExportFor(app: Express, streamCount: number): Promise<number> {
  jest.clearAllMocks();
  (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(
    Array.from({ length: streamCount }, (_, i) => buildMockStream(i)),
  );
  (prisma.eventLog.findMany as jest.Mock).mockResolvedValueOnce(
    Array.from({ length: streamCount }, (_, i) => ({
      streamId: `contract_${i}`,
      ledgerClosedAt: "2024-01-01T00:00:00Z",
      metadata: null,
    })),
  );

  const start = Date.now();
  const res = await request(app).get(`/api/v1/streams/export/${ADDRESS}`);
  const elapsed = Date.now() - start;

  expect(res.status).toBe(200);
  return elapsed;
}

describe("Stream listing load test (1000 streams)", () => {
  it("handles 1000 streams in a single bounded pass (no per-row DB round-trips)", async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api/v1", streamsRouter);

    // Warm up the JIT/route stack so timing reflects steady-state behavior.
    await runExportFor(app, 50);

    const elapsed = await runExportFor(app, 1000);

    // With DB I/O mocked out, processing 1000 rows is pure in-memory work.
    // A real N+1 (or any O(n^2) pass) would blow well past this budget;
    // a single-pass batched implementation finishes in low single-digit ms.
    expect(elapsed).toBeLessThan(500);

    expect(prisma.stream.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.eventLog.findMany).toHaveBeenCalledTimes(1);
  });

  it("query count for the export endpoint is identical at 50 and 1000 streams (linear scaling)", async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api/v1", streamsRouter);

    await runExportFor(app, 50);
    const callsAt50 =
      (prisma.stream.findMany as jest.Mock).mock.calls.length +
      (prisma.eventLog.findMany as jest.Mock).mock.calls.length;

    await runExportFor(app, 1000);
    const callsAt1000 =
      (prisma.stream.findMany as jest.Mock).mock.calls.length +
      (prisma.eventLog.findMany as jest.Mock).mock.calls.length;

    expect(callsAt1000).toBe(callsAt50);
  });
});
