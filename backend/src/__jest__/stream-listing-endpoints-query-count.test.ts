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
import v2StreamsRouter from "../api/v2/streams.routes.js";
import v3HistoryRouter from "../api/v3/history.routes.js";
import { getSearch } from "../api/public.js";

const ADDRESS = "G" + "A".repeat(55);
const MAX_ALLOWED_QUERIES = 5;

function buildMockStream(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `stream_${Math.random().toString(36).slice(2)}`,
    streamId: `contract_${Math.random().toString(36).slice(2)}`,
    txHash: `tx_${Math.random().toString(36).slice(2)}`,
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
    ...overrides,
  };
}

function totalMockCalls(): number {
  return (
    (prisma.stream.findMany as jest.Mock).mock.calls.length +
    (prisma.stream.count as jest.Mock).mock.calls.length +
    (prisma.eventLog.findMany as jest.Mock).mock.calls.length
  );
}

describe("Stream listing endpoints stay below the N+1 query budget", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each([50, 1000])("with %d streams", (count) => {
    const mockStreams = () =>
      Array.from({ length: count }, () => buildMockStream());

    it("GET /api/v1/streams/:address", async () => {
      const app: Express = express();
      app.use(express.json());
      app.use("/api/v1", streamsRouter);

      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(mockStreams());

      const res = await request(app).get(`/api/v1/streams/${ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(count);
      expect(totalMockCalls()).toBeLessThan(MAX_ALLOWED_QUERIES);
    });

    it("GET /api/v1/streams/export/:address", async () => {
      const app: Express = express();
      app.use(express.json());
      app.use("/api/v1", streamsRouter);

      const streams = mockStreams();
      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(streams);
      (prisma.eventLog.findMany as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(app).get(`/api/v1/streams/export/${ADDRESS}`);

      expect(res.status).toBe(200);
      expect(totalMockCalls()).toBeLessThan(MAX_ALLOWED_QUERIES);
    });

    it("GET /api/v2/streams/:address", async () => {
      const app: Express = express();
      app.use(express.json());
      app.use("/api/v2/streams", v2StreamsRouter);

      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(mockStreams());

      const res = await request(app).get(`/api/v2/streams/${ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.v1).toHaveLength(count);
      expect(totalMockCalls()).toBeLessThan(MAX_ALLOWED_QUERIES);
    });

    it("GET /api/v3/history/:address", async () => {
      const app: Express = express();
      app.use(express.json());
      app.use("/api/v3", v3HistoryRouter);

      (prisma.stream.count as jest.Mock).mockResolvedValueOnce(count);
      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(
        mockStreams().slice(0, 50),
      );

      const res = await request(app).get(`/api/v3/history/${ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(count);
      expect(totalMockCalls()).toBeLessThan(MAX_ALLOWED_QUERIES);
    });

    it("GET /api/v1/search", async () => {
      const app: Express = express();
      app.use(express.json());
      app.get("/api/v1/search", getSearch);

      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(
        mockStreams().slice(0, 20),
      );
      (prisma.stream.count as jest.Mock).mockResolvedValueOnce(count);

      const res = await request(app).get("/api/v1/search");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(count);
      expect(totalMockCalls()).toBeLessThan(MAX_ALLOWED_QUERIES);
    });
  });

  it("query count for 1000 streams is identical to the query count for 50 streams (no per-row queries)", async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api/v1", streamsRouter);

    (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 50 }, () => buildMockStream()),
    );
    await request(app).get(`/api/v1/streams/${ADDRESS}`);
    const callsAt50 = totalMockCalls();

    jest.clearAllMocks();

    (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(
      Array.from({ length: 1000 }, () => buildMockStream()),
    );
    await request(app).get(`/api/v1/streams/${ADDRESS}`);
    const callsAt1000 = totalMockCalls();

    expect(callsAt1000).toBe(callsAt50);
  });
});
