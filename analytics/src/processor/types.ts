export interface VolumeBucket {
  period: string; // e.g. "2026-08-20" or "2026-W34" or "2026-08"
  count: number;
  totalVolumeFormatted: number;
  withdrawnVolumeFormatted: number;
  uniqueSenders: number;
  uniqueReceivers: number;
}

export interface VolumeMetricsResponse {
  timeframe: "day" | "week" | "month";
  totalStreams: number;
  totalVolumeFormatted: number;
  averageStreamSizeFormatted: number;
  buckets: VolumeBucket[];
  growthRatePercent: number;
}

export interface TokenTvlDetail {
  tokenAddress: string;
  tokenSymbol: string;
  activeTvlFormatted: number;
  totalDepositedFormatted: number;
  totalWithdrawnFormatted: number;
  activeStreamCount: number;
  tvlSharePercent: number;
  change24hPercent: number;
  change7dPercent: number;
}

export interface TvlTimeSeriesPoint {
  timestamp: string;
  totalTvlUsdEstimated: number;
  byToken: Record<string, number>;
}

export interface TvlMetricsResponse {
  currentTotalTvlFormatted: number;
  totalActiveStreams: number;
  tokens: TokenTvlDetail[];
  timeSeries: TvlTimeSeriesPoint[];
}

export interface DurationMetricsResponse {
  averageDurationSeconds: number;
  medianDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  formattedAvgDuration: string; // e.g., "14 days, 6 hours"
  distribution: {
    under1Day: number;
    day1To7: number;
    day7To30: number;
    month1To3: number;
    over3Months: number;
  };
}

export interface AmountMetricsResponse {
  averageAmountFormatted: number;
  medianAmountFormatted: number;
  minAmountFormatted: number;
  maxAmountFormatted: number;
  totalVolumeFormatted: number;
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p99: number;
  };
  distribution: {
    microStreams: number; // < 10 units
    smallStreams: number; // 10 - 100 units
    mediumStreams: number; // 100 - 1,000 units
    largeStreams: number; // 1,000 - 10,000 units
    whaleStreams: number; // > 10,000 units
  };
}

export interface WithdrawalPatternMetrics {
  totalWithdrawals: number;
  totalWithdrawnFormatted: number;
  averageWithdrawalAmountFormatted: number;
  averageWithdrawalsPerStream: number;
  timingDistribution: {
    firstQuarter: number; // Withdrawn within first 25% of stream duration
    secondQuarter: number; // 25% - 50%
    thirdQuarter: number; // 50% - 75%
    fourthQuarter: number; // 75% - 100%
    afterCompletion: number; // 100%+
  };
  sizeDistribution: {
    micro: number; // < 10% of stream total
    partial: number; // 10% - 50%
    majority: number; // 50% - 90%
    lumpSum: number; // > 90% (single withdrawal)
  };
  hourlyFrequency: Record<number, number>; // 0 to 23 hour distribution
}

export interface CancellationMetricsResponse {
  totalStreamsCreated: number;
  totalCancelled: number;
  cancellationRatePercent: number;
  avgLifespanBeforeCancelSeconds: number;
  formattedAvgLifespan: string;
  totalRefundedFormatted: number;
  cancellationsOverTime: Array<{
    period: string;
    cancelledCount: number;
    ratePercent: number;
  }>;
}

export interface UserRetentionMetricsResponse {
  overallRepeatRatePercent: number;
  totalUniqueUsers: number;
  totalSenders: number;
  totalReceivers: number;
  senderToReceiverRatio: number;
  cohorts: Array<{
    cohortMonth: string;
    cohortSize: number;
    day1: number;
    day7: number;
    day14: number;
    day30: number;
    day60: number;
    day90: number;
    repeatRate: number;
    avgStreamsPerUser: number;
  }>;
}

export interface GasMetricsResponse {
  totalCpuInstructions: number;
  totalMemoryBytes: number;
  totalFeeStroops: number;
  totalFeeXlmFormatted: number;
  avgCpuPerTx: number;
  avgFeeStroopsPerTx: number;
  byAction: Record<
    string,
    {
      txCount: number;
      avgCpu: number;
      avgFeeStroops: number;
      totalCpu: number;
      totalFeeStroops: number;
    }
  >;
  timeSeries: Array<{
    date: string;
    totalTransactions: number;
    avgCpu: number;
    avgFeeStroops: number;
    totalFeeStroops: number;
  }>;
}

export interface FeatureUsageMetricsResponse {
  totalFeatureInvocations: number;
  features: Array<{
    featureName: string;
    contractVersion: string;
    callCount: number;
    sharePercent: number;
    uniqueUsers: number;
    totalVolumeFormatted: number;
    lastUsedAt: string;
  }>;
  versionAdoption: {
    V1: number;
    V2: number;
    V3: number;
  };
}

export interface AnalyticsOverviewResponse {
  summary: {
    totalVolumeFormatted: number;
    activeTvlFormatted: number;
    totalStreamsCreated: number;
    activeStreamsCount: number;
    completedStreamsCount: number;
    cancelledStreamsCount: number;
    cancellationRatePercent: number;
    uniqueUsersCount: number;
    averageStreamAmountFormatted: number;
    averageDurationFormatted: string;
    totalGasFeesXlmFormatted: number;
    volumeChange24hPercent: number;
    tvlChange24hPercent: number;
  };
  tokenTvlList: TokenTvlDetail[];
  recentActivity: Array<{
    action: string;
    txHash: string;
    tokenSymbol: string;
    amountFormatted: number;
    timestamp: string;
    sender?: string;
    receiver?: string;
  }>;
}
