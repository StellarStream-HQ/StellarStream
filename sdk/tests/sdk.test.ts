import { describe, expect, test } from "vitest";
import {
  calculateAllStreamingRates,
  calculateClaimableAmount,
  calculateRatePerDay,
  calculateRatePerMonth,
  calculateRatePerSecond,
  calculateVestedAmount,
  InvalidAmountError,
  InvalidTimeRangeError,
  LimitExceededError,
  mapContractError,
  parseContractEvent,
  StellarStreamSDK,
  Stream,
  StreamNotFoundError,
  StreamState,
  ZeroDurationError,
} from "../src/index.js";

describe("StellarStream SDK", () => {
  const dummyStream: Stream = {
    id: 1n,
    sender: "GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA",
    receiver: "GCXFSWUSLTYBGYSQCST6AQNWHQW4G5T7R2H7ZHYK37B4K2L5N6Q6MH7W",
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    totalAmount: 10_000_000_000n, // 10,000 units (7 decimals or raw stroops)
    withdrawnAmount: 2_000_000_000n,
    startTime: 1000n,
    endTime: 2000n, // 1000s duration
    pausedDuration: 0n,
    lastPausedTime: 0n,
    state: StreamState.Active,
  };

  test("initializes client with network presets and overrides", () => {
    const sdk = new StellarStreamSDK({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      network: "TESTNET",
    });

    expect(sdk.config.contractId).toBe("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM");
    expect(sdk.config.networkPassphrase).toContain("Test SDF Network");
    expect(sdk.config.rpcUrl).toContain("soroban-testnet");
  });

  test("validates createStream input parameters", () => {
    const sdk = new StellarStreamSDK({ contractId: "CA..." });

    // Valid params
    expect(() =>
      sdk.validateCreateStreamParams({
        sender: dummyStream.sender,
        receiver: dummyStream.receiver,
        token: dummyStream.token,
        totalAmount: 1000n,
        startTime: 100n,
        endTime: 200n,
      }),
    ).not.toThrow();

    // Invalid amount <= 0
    expect(() =>
      sdk.validateCreateStreamParams({
        sender: dummyStream.sender,
        receiver: dummyStream.receiver,
        token: dummyStream.token,
        totalAmount: 0n,
        startTime: 100n,
        endTime: 200n,
      }),
    ).toThrow(InvalidAmountError);

    // Invalid time range
    expect(() =>
      sdk.validateCreateStreamParams({
        sender: dummyStream.sender,
        receiver: dummyStream.receiver,
        token: dummyStream.token,
        totalAmount: 1000n,
        startTime: 200n,
        endTime: 100n,
      }),
    ).toThrow(InvalidTimeRangeError);
  });

  test("computes linear vesting accurately at any point in time", () => {
    // Before start time
    expect(calculateVestedAmount(dummyStream, 900n)).toBe(0n);
    // At start time
    expect(calculateVestedAmount(dummyStream, 1000n)).toBe(0n);
    // Halfway (timestamp = 1500, elapsed = 500 / 1000)
    expect(calculateVestedAmount(dummyStream, 1500n)).toBe(5_000_000_000n);
    // Three quarters (timestamp = 1750, elapsed = 750 / 1000)
    expect(calculateVestedAmount(dummyStream, 1750n)).toBe(7_500_000_000n);
    // At end time
    expect(calculateVestedAmount(dummyStream, 2000n)).toBe(10_000_000_000n);
    // Past end time
    expect(calculateVestedAmount(dummyStream, 3000n)).toBe(10_000_000_000n);
  });

  test("computes claimable amount deducting withdrawn amounts", () => {
    // At timestamp 1500, vested = 5,000,000,000, withdrawn = 2,000,000,000 -> claimable = 3,000,000,000
    expect(calculateClaimableAmount(dummyStream, 1500n)).toBe(3_000_000_000n);

    // At timestamp 1100, vested = 1,000,000,000 <= withdrawn 2,000,000,000 -> claimable = 0
    expect(calculateClaimableAmount(dummyStream, 1100n)).toBe(0n);
  });

  test("calculates streaming rates per second, day, and month", () => {
    const totalAmount = 86_400_000n;
    const startTime = 0n;
    const endTime = 86_400n; // exactly 1 day duration

    expect(calculateRatePerSecond(totalAmount, startTime, endTime)).toBe(1000n);
    expect(calculateRatePerDay(totalAmount, startTime, endTime)).toBe(86_400_000n);
    expect(calculateRatePerMonth(totalAmount, startTime, endTime)).toBe(86_400_000n * 30n);

    const rates = calculateAllStreamingRates({
      ...dummyStream,
      totalAmount,
      startTime,
      endTime,
    });
    expect(rates.ratePerSecond).toBe(1000n);
    expect(rates.ratePerDay).toBe(86_400_000n);
    expect(rates.ratePerMonth).toBe(86_400_000n * 30n);
  });

  test("filters streams by token, state, amount, and time bounds", () => {
    const sdk = new StellarStreamSDK({ contractId: "CA..." });

    const stream2: Stream = {
      ...dummyStream,
      id: 2n,
      token: "CUSDC...",
      totalAmount: 50_000n,
      state: StreamState.Completed,
    };

    const stream3: Stream = {
      ...dummyStream,
      id: 3n,
      totalAmount: 5_000n,
      state: StreamState.Active,
    };

    const streams = [dummyStream, stream2, stream3];

    // Filter by state
    const activeStreams = sdk.applyFilter(streams, { state: StreamState.Active });
    expect(activeStreams.map((s) => s.id)).toEqual([1n, 3n]);

    // Filter by minAmount
    const highValue = sdk.applyFilter(streams, { minAmount: 10_000_000_000n });
    expect(highValue.map((s) => s.id)).toEqual([1n]);

    // Limit exceeded check
    expect(() => sdk.applyFilter(streams, {}, 0, 51)).toThrow(LimitExceededError);
  });

  test("computes protocol TVL across multiple tokens", () => {
    const sdk = new StellarStreamSDK({ contractId: "CA..." });

    const stream1: Stream = {
      ...dummyStream,
      token: "TOKEN_A",
      totalAmount: 1000n,
      withdrawnAmount: 200n,
      state: StreamState.Active,
    };
    const stream2: Stream = {
      ...dummyStream,
      token: "TOKEN_A",
      totalAmount: 500n,
      withdrawnAmount: 100n,
      state: StreamState.Paused,
    };
    const stream3: Stream = {
      ...dummyStream,
      token: "TOKEN_B",
      totalAmount: 2000n,
      withdrawnAmount: 500n,
      state: StreamState.Active,
    };
    const streamCancelled: Stream = {
      ...dummyStream,
      token: "TOKEN_B",
      totalAmount: 3000n,
      withdrawnAmount: 1000n,
      state: StreamState.Cancelled,
    };

    const tvl = sdk.computeTVL([stream1, stream2, stream3, streamCancelled]);
    // TOKEN_A: (1000-200) + (500-100) = 800 + 400 = 1200
    expect(tvl.get("TOKEN_A")).toBe(1200n);
    // TOKEN_B: (2000-500) = 1500 (cancelled excluded)
    expect(tvl.get("TOKEN_B")).toBe(1500n);
  });

  test("maps contract error codes to specific error classes", () => {
    expect(mapContractError(1).name).toBe("NotInitializedError");
    expect(mapContractError(3).name).toBe("UnauthorizedError");
    expect(mapContractError(4)).toBeInstanceOf(StreamNotFoundError);
    expect(mapContractError(8)).toBeInstanceOf(InvalidTimeRangeError);
    expect(mapContractError(9)).toBeInstanceOf(InvalidAmountError);
    expect(mapContractError(10)).toBeInstanceOf(ZeroDurationError);
  });

  test("parses raw contract event logs into typed StreamEvent objects", () => {
    const rawEvent = {
      contractId: "CA12345",
      ledger: 123456,
      topic: ["stream_created", "42"],
      value: { amount: 10000 },
    };

    const parsed = parseContractEvent(rawEvent);
    expect(parsed.type).toBe("StreamCreated");
    expect(parsed.streamId).toBe(42n);
    expect(parsed.contractId).toBe("CA12345");
    expect(parsed.ledger).toBe(123456);
  });

  test("computes protocol health check and aggregate analytics metrics", () => {
    const sdk = new StellarStreamSDK({ contractId: "CA..." });

    const sActive: Stream = { ...dummyStream, id: 1n, state: StreamState.Active, totalAmount: 1000n, withdrawnAmount: 200n };
    const sPaused: Stream = { ...dummyStream, id: 2n, state: StreamState.Paused, totalAmount: 500n, withdrawnAmount: 100n };
    const sDone: Stream = { ...dummyStream, id: 3n, state: StreamState.Completed, totalAmount: 2000n, withdrawnAmount: 2000n };
    const sCancelled: Stream = { ...dummyStream, id: 4n, state: StreamState.Cancelled, totalAmount: 1500n, withdrawnAmount: 500n };

    const streams = [sActive, sPaused, sDone, sCancelled];

    const health = sdk.computeHealthCheck(streams, false, 1700000000n);
    expect(health.isPaused).toBe(false);
    expect(health.activeStreams).toBe(1n);
    expect(health.totalStreams).toBe(4n);
    expect(health.lastActivityTime).toBe(1700000000n);
    expect(health.version).toBe(1);

    const metrics = sdk.computeMetrics(streams);
    expect(metrics.totalStreams).toBe(4n);
    expect(metrics.activeStreams).toBe(2n); // active + paused
    expect(metrics.completedStreams).toBe(1n);
    expect(metrics.cancelledStreams).toBe(1n);
    expect(metrics.totalVolumeStreamed).toBe(5000n);
    expect(metrics.totalWithdrawnVolume).toBe(2800n);
  });
});
