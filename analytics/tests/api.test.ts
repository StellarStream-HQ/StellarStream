import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { AnalyticsDatabase } from "../src/db/storage.js";
import { createAnalyticsApp } from "../src/api/server.js";
import { EventIndexer } from "../src/indexer/event-indexer.js";

describe("Analytics REST API Endpoints", () => {
  let db: AnalyticsDatabase;
  let app: any;
  let indexer: EventIndexer;

  beforeEach(() => {
    db = new AnalyticsDatabase();
    indexer = new EventIndexer(db);
    const setup = createAnalyticsApp({ db, indexer });
    app = setup.app;

    // Ingest sample stream
    indexer.ingestDecodedEvent({
      eventId: "e_api_1",
      contractId: "C1",
      contractVersion: "V2",
      topicAction: "create",
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
      txHash: "tx_api_1",
      streamId: "stream_api_1",
      sender: "G_SENDER_1",
      receiver: "G_RECEIVER_1",
      tokenAddress: "native",
      tokenSymbol: "XLM",
      amount: "1000000000",
      amountFormatted: 100,
      durationSeconds: 86400,
      rawPayload: {},
    });
  });

  it("GET /health returns healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.service).toBe("stellarstream-analytics");
  });

  it("GET /api/v1/analytics/overview returns summary KPIs", async () => {
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary.totalStreamsCreated).toBe(1);
    expect(res.body.data.summary.activeTvlFormatted).toBe(100);
  });

  it("GET /api/v1/analytics/streams/volume returns time bucketed volume", async () => {
    const res = await request(app).get("/api/v1/analytics/streams/volume?timeframe=day");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalStreams).toBe(1);
    expect(res.body.data.buckets.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/analytics/tvl returns token TVL breakdown", async () => {
    const res = await request(app).get("/api/v1/analytics/tvl");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currentTotalTvlFormatted).toBe(100);
    expect(res.body.data.tokens[0].tokenSymbol).toBe("XLM");
  });

  it("GET /api/v1/analytics/streams/duration returns duration distribution", async () => {
    const res = await request(app).get("/api/v1/analytics/streams/duration");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.averageDurationSeconds).toBe(86400);
  });

  it("GET /api/v1/analytics/streams/amounts returns amount percentiles", async () => {
    const res = await request(app).get("/api/v1/analytics/streams/amounts");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.averageAmountFormatted).toBe(100);
  });

  it("GET /api/v1/analytics/withdrawals returns withdrawal patterns", async () => {
    const res = await request(app).get("/api/v1/analytics/withdrawals");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("timingDistribution");
    expect(res.body.data).toHaveProperty("sizeDistribution");
  });

  it("GET /api/v1/analytics/cancellations returns cancellation rate", async () => {
    const res = await request(app).get("/api/v1/analytics/cancellations");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cancellationRatePercent).toBe(0);
  });

  it("GET /api/v1/analytics/retention returns cohort retention metrics", async () => {
    const res = await request(app).get("/api/v1/analytics/retention");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalSenders).toBe(1);
  });

  it("GET /api/v1/analytics/gas returns gas & fee metrics", async () => {
    const res = await request(app).get("/api/v1/analytics/gas");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("totalCpuInstructions");
  });

  it("GET /api/v1/analytics/features returns feature usage statistics", async () => {
    const res = await request(app).get("/api/v1/analytics/features");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.versionAdoption.V2).toBe(1);
  });

  it("GET /api/v1/analytics/export returns CSV file download", async () => {
    const res = await request(app).get("/api/v1/analytics/export?type=streams&format=csv");
    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toContain("text/csv");
    expect(res.text).toContain("StreamID,ContractVersion,Status");
  });

  it("GET /api/v1/analytics/export returns JSON file download", async () => {
    const res = await request(app).get("/api/v1/analytics/export?type=streams&format=json");
    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toContain("application/json");
    const json = JSON.parse(res.text);
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(1);
  });
});
