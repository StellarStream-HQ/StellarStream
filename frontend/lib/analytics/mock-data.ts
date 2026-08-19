import type { AnalyticsDashboardResponse } from "./types";

export function generateMockAnalytics(
  range: string = "30d",
  asset: string = "ALL"
): AnalyticsDashboardResponse {
  const multiplier =
    range === "7d"
      ? 0.25
      : range === "30d"
      ? 1.0
      : range === "90d"
      ? 2.8
      : 10.5;

  const assetScale =
    asset === "ALL"
      ? 1.0
      : asset === "USDC"
      ? 0.65
      : asset === "XLM"
      ? 0.25
      : 0.1;

  const baseVolume = 1_485_920 * multiplier * assetScale;
  const baseTxCount = Math.round(14_320 * multiplier * assetScale);
  const completedCount = Math.round(baseTxCount * 0.982);
  const pendingCount = Math.round(baseTxCount * 0.011);
  const failedCount = Math.round(baseTxCount * 0.005);
  const refundedCount = Math.max(0, baseTxCount - completedCount - pendingCount - failedCount);

  // Time series generation
  const pointCount = range === "7d" ? 7 : range === "30d" ? 15 : range === "90d" ? 12 : 12;
  const paymentTrends = Array.from({ length: pointCount }).map((_, idx) => {
    const dayOffset = pointCount - 1 - idx;
    const date = new Date();
    date.setDate(
      date.getDate() -
        dayOffset * (range === "7d" ? 1 : range === "30d" ? 2 : range === "90d" ? 7 : 30)
    );

    const label = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const wave = 1 + Math.sin(idx * 0.6) * 0.18 + (idx / pointCount) * 0.12;
    const ptVolume = Math.round((baseVolume / pointCount) * wave);
    const ptTx = Math.round((baseTxCount / pointCount) * wave);
    const ptCompleted = Math.round(ptTx * 0.982);
    const ptPending = Math.round(ptTx * 0.011);
    const ptFailed = Math.max(0, ptTx - ptCompleted - ptPending);

    return {
      label,
      volumeUsd: ptVolume,
      txCount: ptTx,
      completedCount: ptCompleted,
      pendingCount: ptPending,
      failedCount: ptFailed,
      predictedVolumeUsd: Math.round(ptVolume * 1.08),
    };
  });

  const totalFees = Math.round(baseTxCount * 0.00015 * 100) / 100;
  const traditionalCost = Math.round(baseTxCount * 25.0);
  const savings = Math.round(traditionalCost - totalFees);

  return {
    summary: {
      totalVolumeUsd: Math.round(baseVolume),
      successRatePct: 98.24,
      avgProcessingTimeSec: 2.38,
      estimatedBankingSavingsUsd: savings,
      totalProtocolFeesUsd: totalFees,
      failureRatePct: 0.52,
      peakTps: 1840,
      projected30dVolumeUsd: Math.round(baseVolume * 1.22),
      anomalyRiskScore: 14,
      anomalyRiskLevel: "LOW",
      topCorridor: "North America → Europe",
      avgTxSizeUsd: Math.round((baseVolume / (baseTxCount || 1)) * 100) / 100,
      activeStreamers: 428,
      transactionCount: baseTxCount,
    },
    paymentTrends,
    statusBreakdown: [
      {
        status: "COMPLETED",
        count: completedCount,
        volumeUsd: Math.round(baseVolume * 0.982),
        percentage: 98.24,
        color: "#10b981", // emerald
      },
      {
        status: "PENDING",
        count: pendingCount,
        volumeUsd: Math.round(baseVolume * 0.011),
        percentage: 1.12,
        color: "#f59e0b", // amber
      },
      {
        status: "FAILED",
        count: failedCount,
        volumeUsd: Math.round(baseVolume * 0.005),
        percentage: 0.52,
        color: "#ef4444", // red
      },
      {
        status: "REFUNDED",
        count: refundedCount,
        volumeUsd: Math.round(baseVolume * 0.0018),
        percentage: 0.12,
        color: "#6366f1", // indigo
      },
    ],
    failureReasons: [
      {
        reason: "Insufficient Trustline",
        count: Math.round(failedCount * 0.48),
        percentage: 48.0,
        description: "Recipient wallet has not established a trustline for asset",
      },
      {
        reason: "Low Balance / Gas",
        count: Math.round(failedCount * 0.28),
        percentage: 28.0,
        description: "Sender wallet balance below minimum reserve requirement",
      },
      {
        reason: "Slippage / Exceeded Limit",
        count: Math.round(failedCount * 0.16),
        percentage: 16.0,
        description: "Path payment price movement exceeded max slippage threshold",
      },
      {
        reason: "Sequence / Rate Limit",
        count: Math.round(failedCount * 0.08),
        percentage: 8.0,
        description: "Transaction sequence number mismatch or burst limit exceeded",
      },
    ],
    processingTimes: {
      overallAvgSec: 2.38,
      byAsset: [
        { asset: "XLM", avgTimeSec: 1.84, p95TimeSec: 2.45, count: Math.round(baseTxCount * 0.35) },
        { asset: "USDC", avgTimeSec: 2.21, p95TimeSec: 3.1, count: Math.round(baseTxCount * 0.5) },
        { asset: "PYUSD", avgTimeSec: 3.42, p95TimeSec: 4.85, count: Math.round(baseTxCount * 0.15) },
      ],
      latencyTimeSeries: paymentTrends.map((pt) => ({
        timestamp: pt.label,
        avgLatencySec: Math.round((2.1 + Math.random() * 0.6) * 100) / 100,
        p95LatencySec: Math.round((3.2 + Math.random() * 0.9) * 100) / 100,
      })),
    },
    geographicDistribution: {
      regions: [
        {
          region: "North America",
          code: "NA",
          volumeUsd: Math.round(baseVolume * 0.44),
          txCount: Math.round(baseTxCount * 0.42),
          percentage: 44.0,
          growthPct: +18.4,
        },
        {
          region: "Europe",
          code: "EU",
          volumeUsd: Math.round(baseVolume * 0.28),
          txCount: Math.round(baseTxCount * 0.3),
          percentage: 28.0,
          growthPct: +12.1,
        },
        {
          region: "Asia Pacific",
          code: "APAC",
          volumeUsd: Math.round(baseVolume * 0.16),
          txCount: Math.round(baseTxCount * 0.15),
          percentage: 16.0,
          growthPct: +24.6,
        },
        {
          region: "Latin America",
          code: "LATAM",
          volumeUsd: Math.round(baseVolume * 0.08),
          txCount: Math.round(baseTxCount * 0.09),
          percentage: 8.0,
          growthPct: +31.2,
        },
        {
          region: "Africa & Middle East",
          code: "MEA",
          volumeUsd: Math.round(baseVolume * 0.04),
          txCount: Math.round(baseTxCount * 0.04),
          percentage: 4.0,
          growthPct: +15.0,
        },
      ],
      topCorridors: [
        {
          corridor: "United States → Germany",
          volumeUsd: Math.round(baseVolume * 0.18),
          txCount: Math.round(baseTxCount * 0.16),
        },
        {
          corridor: "United States → United Kingdom",
          volumeUsd: Math.round(baseVolume * 0.14),
          txCount: Math.round(baseTxCount * 0.14),
        },
        {
          corridor: "Singapore → Japan",
          volumeUsd: Math.round(baseVolume * 0.09),
          txCount: Math.round(baseTxCount * 0.08),
        },
        {
          corridor: "Brazil → United States",
          volumeUsd: Math.round(baseVolume * 0.06),
          txCount: Math.round(baseTxCount * 0.07),
        },
      ],
    },
    costAnalysis: {
      totalFeesUsd: totalFees,
      traditionalWireCostUsd: traditionalCost,
      totalSavingsUsd: savings,
      avgFeePerTxUsd: 0.00015,
      savingsPct: 99.99,
      costByAsset: [
        {
          asset: "USDC",
          feeUsd: Math.round(totalFees * 0.55 * 100) / 100,
          txCount: Math.round(baseTxCount * 0.5),
          avgFeeUsd: 0.00015,
        },
        {
          asset: "XLM",
          feeUsd: Math.round(totalFees * 0.35 * 100) / 100,
          txCount: Math.round(baseTxCount * 0.35),
          avgFeeUsd: 0.00012,
        },
        {
          asset: "PYUSD",
          feeUsd: Math.round(totalFees * 0.1 * 100) / 100,
          txCount: Math.round(baseTxCount * 0.15),
          avgFeeUsd: 0.00018,
        },
      ],
    },
    predictiveAnalytics: {
      forecastedVolume30d: Math.round(baseVolume * 1.22),
      forecastTrend: "UPWARD",
      forecastConfidencePct: 94.6,
      predictedFailureRatePct: 0.48,
      anomalyRiskIndex: 14,
      peakWindowNotice: "Expected volume surge between 14:00 - 17:00 UTC on Fridays",
      forecastPoints: Array.from({ length: 8 }).map((_, idx) => {
        const d = new Date();
        d.setDate(d.getDate() + (idx + 1) * 4);
        const baseFc = Math.round((baseVolume / 8) * (1 + idx * 0.04));
        return {
          date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          volumeUsd: baseFc,
          lowerBound: Math.round(baseFc * 0.92),
          upperBound: Math.round(baseFc * 1.08),
        };
      }),
    },
  };
}
