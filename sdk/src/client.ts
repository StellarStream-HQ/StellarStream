import {
  CreateStreamParams,
  NetworkConfig,
  NETWORKS,
  SDKConfig,
  Stream,
  StreamFilter,
  StreamingRates,
  StreamState,
} from "./types.js";
import {
  calculateAllStreamingRates,
  calculateClaimableAmount,
  calculateRatePerDay,
  calculateRatePerMonth,
  calculateRatePerSecond,
  calculateVestedAmount,
} from "./math.js";
import {
  InvalidAmountError,
  InvalidTimeRangeError,
  LimitExceededError,
  mapContractError,
  StellarStreamError,
  StreamNotFoundError,
} from "./errors.js";

export class StellarStreamSDK {
  public readonly config: NetworkConfig;

  constructor(config: SDKConfig) {
    if (!config.contractId) {
      throw new StellarStreamError("contractId is required in SDKConfig");
    }

    let networkPassphrase = config.networkPassphrase;
    let rpcUrl = config.rpcUrl;

    if (config.network && NETWORKS[config.network]) {
      networkPassphrase = networkPassphrase ?? NETWORKS[config.network].networkPassphrase;
      rpcUrl = rpcUrl ?? NETWORKS[config.network].rpcUrl;
    }

    this.config = {
      contractId: config.contractId,
      networkPassphrase: networkPassphrase ?? NETWORKS.TESTNET.networkPassphrase,
      rpcUrl: rpcUrl ?? NETWORKS.TESTNET.rpcUrl,
    };
  }

  /**
   * Validates parameters for creating a new stream.
   */
  public validateCreateStreamParams(params: CreateStreamParams): void {
    const totalAmount = BigInt(params.totalAmount);
    const startTime = BigInt(params.startTime);
    const endTime = BigInt(params.endTime);

    if (totalAmount <= 0n) {
      throw new InvalidAmountError();
    }
    if (endTime <= startTime) {
      throw new InvalidTimeRangeError();
    }
    if (!params.sender || !params.receiver || !params.token) {
      throw new StellarStreamError("sender, receiver, and token addresses are required");
    }
  }

  /**
   * Calculates real-time vested token amount for a stream.
   */
  public calculateVestedAmount(stream: Stream, timestamp?: bigint | number): bigint {
    const now = timestamp !== undefined ? BigInt(timestamp) : BigInt(Math.floor(Date.now() / 1000));
    return calculateVestedAmount(stream, now);
  }

  /**
   * Calculates claimable token amount for a stream.
   */
  public calculateClaimableAmount(stream: Stream, timestamp?: bigint | number): bigint {
    const now = timestamp !== undefined ? BigInt(timestamp) : BigInt(Math.floor(Date.now() / 1000));
    return calculateClaimableAmount(stream, now);
  }

  /**
   * Computes rate per second for a stream.
   */
  public getStreamRatePerSecond(stream: Stream): bigint {
    return calculateRatePerSecond(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration);
  }

  /**
   * Computes rate per day for a stream.
   */
  public getStreamRatePerDay(stream: Stream): bigint {
    return calculateRatePerDay(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration);
  }

  /**
   * Computes rate per month for a stream.
   */
  public getStreamRatePerMonth(stream: Stream): bigint {
    return calculateRatePerMonth(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration);
  }

  /**
   * Computes all streaming rates (second, day, month) for a stream.
   */
  public calculateStreamingRates(stream: Stream): StreamingRates {
    return calculateAllStreamingRates(stream);
  }

  /**
   * Filters a stream against multi-criteria StreamFilter options.
   */
  public matchesFilter(stream: Stream, filter: StreamFilter): boolean {
    if (filter.token && stream.token !== filter.token) {
      return false;
    }
    if (filter.state !== undefined && stream.state !== filter.state) {
      return false;
    }
    if (filter.minAmount !== undefined && stream.totalAmount < BigInt(filter.minAmount)) {
      return false;
    }
    if (filter.maxAmount !== undefined && stream.totalAmount > BigInt(filter.maxAmount)) {
      return false;
    }
    if (filter.startTimeAfter !== undefined && stream.startTime < BigInt(filter.startTimeAfter)) {
      return false;
    }
    if (filter.endTimeBefore !== undefined && stream.endTime > BigInt(filter.endTimeBefore)) {
      return false;
    }
    return true;
  }

  /**
   * Filters and paginates a local or queried array of streams.
   */
  public applyFilter(streams: Stream[], filter: StreamFilter, offset: number = 0, limit: number = 50): Stream[] {
    if (limit > 50) {
      throw new LimitExceededError();
    }
    const filtered = streams.filter((s) => this.matchesFilter(s, filter));
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Computes Total Value Locked (TVL) breakdown per token across an array of active streams.
   */
  public computeTVL(streams: Stream[]): Map<string, bigint> {
    const tvlMap = new Map<string, bigint>();
    for (const stream of streams) {
      if (stream.state === StreamState.Active || stream.state === StreamState.Paused) {
        const remaining = stream.totalAmount - stream.withdrawnAmount;
        const current = tvlMap.get(stream.token) ?? 0n;
        tvlMap.set(stream.token, current + remaining);
      }
    }
    return tvlMap;
  }

  /**
   * Computes protocol health indicators across a set of streams.
   */
  public computeHealthCheck(streams: Stream[], isPaused: boolean = false, lastActivityTime: bigint = 0n): ContractHealth {
    let activeStreams = 0n;
    for (const s of streams) {
      if (s.state === StreamState.Active) {
        activeStreams++;
      }
    }

    return {
      isPaused,
      activeStreams,
      totalStreams: BigInt(streams.length),
      lastActivityTime,
      version: 1,
    };
  }

  /**
   * Aggregates real-time protocol metrics across all streams.
   */
  public computeMetrics(streams: Stream[]): ContractMetrics {
    let activeStreams = 0n;
    let completedStreams = 0n;
    let cancelledStreams = 0n;
    let totalVolumeStreamed = 0n;
    let totalWithdrawnVolume = 0n;

    for (const s of streams) {
      if (s.state === StreamState.Active || s.state === StreamState.Paused) activeStreams++;
      else if (s.state === StreamState.Completed) completedStreams++;
      else if (s.state === StreamState.Cancelled) cancelledStreams++;

      totalVolumeStreamed += s.totalAmount;
      totalWithdrawnVolume += s.withdrawnAmount;
    }

    return {
      totalStreams: BigInt(streams.length),
      activeStreams,
      completedStreams,
      cancelledStreams,
      totalVolumeStreamed,
      totalWithdrawnVolume,
    };
  }

  /**
   * Formats on-chain error code into typed exception.
   */
  public handleError(code: number): StellarStreamError {
    return mapContractError(code);
  }
}
