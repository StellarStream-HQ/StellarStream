export interface SummaryMetrics {
  totalVolumeUsd: number;
  successRatePct: number;
  avgProcessingTimeSec: number;
  estimatedBankingSavingsUsd: number;
  totalProtocolFeesUsd: number;
  failureRatePct: number;
  peakTps: number;
  projected30dVolumeUsd: number;
  anomalyRiskScore: number; // 0-100
  anomalyRiskLevel: "LOW" | "MEDIUM" | "HIGH";
  topCorridor: string;
  avgTxSizeUsd: number;
  activeStreamers: number;
  transactionCount: number;
}

export interface PaymentTrendPoint {
  label: string;
  volumeUsd: number;
  txCount: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  predictedVolumeUsd?: number;
}

export interface StatusBreakdownItem {
  status: "COMPLETED" | "PENDING" | "FAILED" | "REFUNDED";
  count: number;
  volumeUsd: number;
  percentage: number;
  color: string;
}

export interface FailureReasonItem {
  reason: string;
  count: number;
  percentage: number;
  description: string;
}

export interface AssetProcessingTime {
  asset: string;
  avgTimeSec: number;
  p95TimeSec: number;
  count: number;
}

export interface LatencyPoint {
  timestamp: string;
  avgLatencySec: number;
  p95LatencySec: number;
}

export interface ProcessingTimesData {
  overallAvgSec: number;
  byAsset: AssetProcessingTime[];
  latencyTimeSeries: LatencyPoint[];
}

export interface RegionData {
  region: string;
  code: string;
  volumeUsd: number;
  txCount: number;
  percentage: number;
  growthPct: number;
}

export interface TopCorridorData {
  corridor: string;
  volumeUsd: number;
  txCount: number;
}

export interface GeographicDistributionData {
  regions: RegionData[];
  topCorridors: TopCorridorData[];
}

export interface AssetCostData {
  asset: string;
  feeUsd: number;
  txCount: number;
  avgFeeUsd: number;
}

export interface CostAnalysisData {
  totalFeesUsd: number;
  traditionalWireCostUsd: number;
  totalSavingsUsd: number;
  avgFeePerTxUsd: number;
  savingsPct: number;
  costByAsset: AssetCostData[];
}

export interface ForecastPoint {
  date: string;
  volumeUsd: number;
  lowerBound: number;
  upperBound: number;
}

export interface PredictiveAnalyticsData {
  forecastedVolume30d: number;
  forecastTrend: "UPWARD" | "STABLE" | "DOWNWARD";
  forecastConfidencePct: number;
  predictedFailureRatePct: number;
  anomalyRiskIndex: number;
  peakWindowNotice: string;
  forecastPoints: ForecastPoint[];
}

export interface AnalyticsDashboardResponse {
  summary: SummaryMetrics;
  paymentTrends: PaymentTrendPoint[];
  statusBreakdown: StatusBreakdownItem[];
  failureReasons: FailureReasonItem[];
  processingTimes: ProcessingTimesData;
  geographicDistribution: GeographicDistributionData;
  costAnalysis: CostAnalysisData;
  predictiveAnalytics: PredictiveAnalyticsData;
}
