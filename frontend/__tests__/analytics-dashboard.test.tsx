import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnalyticsOverviewCards } from "@/components/analytics/AnalyticsOverviewCards";
import { AnalyticsHeader } from "@/components/analytics/AnalyticsHeader";
import { AnalyticsExportModal } from "@/components/analytics/AnalyticsExportModal";
import { SuccessFailureRatesChart } from "@/components/analytics/SuccessFailureRatesChart";
import { ProcessingTimeChart } from "@/components/analytics/ProcessingTimeChart";
import { GeographicDistributionChart } from "@/components/analytics/GeographicDistributionChart";
import { CostAnalysisChart } from "@/components/analytics/CostAnalysisChart";
import { PredictiveAnalyticsCard } from "@/components/analytics/PredictiveAnalyticsCard";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

// Mock recharts ResponsiveContainer to render children cleanly in test env
vi.mock("recharts", async () => {
  const original = await vi.importActual("recharts");
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  };
});

const mockSummary: AnalyticsDashboardResponse["summary"] = {
  totalVolumeUsd: 1485920,
  successRatePct: 98.24,
  avgProcessingTimeSec: 2.38,
  estimatedBankingSavingsUsd: 358000,
  totalProtocolFeesUsd: 2.15,
  failureRatePct: 0.52,
  peakTps: 1840,
  projected30dVolumeUsd: 1812822,
  anomalyRiskScore: 14,
  anomalyRiskLevel: "LOW",
  topCorridor: "North America → Europe",
  avgTxSizeUsd: 103.77,
  activeStreamers: 428,
  transactionCount: 14320,
};

const mockFullData: AnalyticsDashboardResponse = {
  summary: mockSummary,
  paymentTrends: [
    { label: "Jul 1", volumeUsd: 120000, txCount: 1100, completedCount: 1080, pendingCount: 12, failedCount: 8 },
    { label: "Jul 2", volumeUsd: 135000, txCount: 1250, completedCount: 1230, pendingCount: 15, failedCount: 5 },
  ],
  statusBreakdown: [
    { status: "COMPLETED", count: 14068, volumeUsd: 1459173, percentage: 98.24, color: "#10b981" },
    { status: "PENDING", count: 160, volumeUsd: 16345, percentage: 1.12, color: "#f59e0b" },
    { status: "FAILED", count: 74, volumeUsd: 7726, percentage: 0.52, color: "#ef4444" },
    { status: "REFUNDED", count: 18, volumeUsd: 2676, percentage: 0.12, color: "#6366f1" },
  ],
  failureReasons: [
    { reason: "Insufficient Trustline", count: 35, percentage: 48.0, description: "Missing trustline" },
    { reason: "Low Balance / Gas", count: 21, percentage: 28.0, description: "Insufficient funds" },
  ],
  processingTimes: {
    overallAvgSec: 2.38,
    byAsset: [
      { asset: "XLM", avgTimeSec: 1.84, p95TimeSec: 2.45, count: 5012 },
      { asset: "USDC", avgTimeSec: 2.21, p95TimeSec: 3.1, count: 7160 },
      { asset: "PYUSD", avgTimeSec: 3.42, p95TimeSec: 4.85, count: 2148 },
    ],
    latencyTimeSeries: [
      { timestamp: "Jul 1", avgLatencySec: 2.1, p95LatencySec: 3.2 },
    ],
  },
  geographicDistribution: {
    regions: [
      { region: "North America", code: "NA", volumeUsd: 653804, txCount: 6014, percentage: 44.0, growthPct: 18.4 },
      { region: "Europe", code: "EU", volumeUsd: 416057, txCount: 4296, percentage: 28.0, growthPct: 12.1 },
    ],
    topCorridors: [
      { corridor: "United States → Germany", volumeUsd: 267465, txCount: 2291 },
    ],
  },
  costAnalysis: {
    totalFeesUsd: 2.15,
    traditionalWireCostUsd: 358000,
    totalSavingsUsd: 357997.85,
    avgFeePerTxUsd: 0.00015,
    savingsPct: 99.99,
    costByAsset: [
      { asset: "USDC", feeUsd: 1.18, txCount: 7160, avgFeeUsd: 0.00015 },
      { asset: "XLM", feeUsd: 0.75, txCount: 5012, avgFeeUsd: 0.00012 },
    ],
  },
  predictiveAnalytics: {
    forecastedVolume30d: 1812822,
    forecastTrend: "UPWARD",
    forecastConfidencePct: 94.6,
    predictedFailureRatePct: 0.48,
    anomalyRiskIndex: 14,
    peakWindowNotice: "Expected volume surge between 14:00 - 17:00 UTC",
    forecastPoints: [
      { date: "Aug 1", volumeUsd: 226602, lowerBound: 208473, upperBound: 244730 },
    ],
  },
};

describe("AnalyticsOverviewCards", () => {
  it("renders 12 core KPI metric cards", () => {
    render(<AnalyticsOverviewCards summary={mockSummary} />);

    expect(screen.getByText("Total Stream Volume")).toBeInTheDocument();
    expect(screen.getByText("$1,485,920")).toBeInTheDocument();

    expect(screen.getByText("Success Rate")).toBeInTheDocument();
    expect(screen.getByText("98.24%")).toBeInTheDocument();

    expect(screen.getByText("Avg Settlement Latency")).toBeInTheDocument();
    expect(screen.getByText("2.38s")).toBeInTheDocument();

    expect(screen.getByText("Banking Wire Savings")).toBeInTheDocument();
    expect(screen.getByText("$358,000")).toBeInTheDocument();

    expect(screen.getByText("Total Protocol & Gas Fees")).toBeInTheDocument();
    expect(screen.getByText("$2.15")).toBeInTheDocument();

    expect(screen.getByText("Failure Rate")).toBeInTheDocument();
    expect(screen.getByText("0.52%")).toBeInTheDocument();

    expect(screen.getByText("Network Throughput")).toBeInTheDocument();
    expect(screen.getByText("1,840 TPS")).toBeInTheDocument();

    expect(screen.getByText("Projected 30D Volume")).toBeInTheDocument();
    expect(screen.getByText("$1,812,822")).toBeInTheDocument();

    expect(screen.getByText("Anomaly Risk Score")).toBeInTheDocument();
    expect(screen.getByText("14 / 100")).toBeInTheDocument();

    expect(screen.getByText("Top Regional Corridor")).toBeInTheDocument();
    expect(screen.getByText("North America → Europe")).toBeInTheDocument();

    expect(screen.getByText("Avg Transaction Size")).toBeInTheDocument();
    expect(screen.getByText("$103.77")).toBeInTheDocument();

    expect(screen.getByText("Active Streamers")).toBeInTheDocument();
    expect(screen.getByText("428")).toBeInTheDocument();
  });
});

describe("AnalyticsHeader & Controls", () => {
  it("renders dashboard title and triggers range / asset filters", () => {
    const onRangeChange = vi.fn();
    const onAssetChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <AnalyticsHeader
        range="30d"
        onRangeChange={onRangeChange}
        asset="ALL"
        onAssetChange={onAssetChange}
        onRefresh={onRefresh}
        loading={false}
        lastUpdated="12:00:00 PM"
        data={mockFullData}
      />
    );

    expect(screen.getByText("Advanced Analytics Dashboard")).toBeInTheDocument();

    fireEvent.click(screen.getByText("7D"));
    expect(onRangeChange).toHaveBeenCalledWith("7d");

    fireEvent.click(screen.getByText("USDC"));
    expect(onAssetChange).toHaveBeenCalledWith("USDC");

    fireEvent.click(screen.getByText("Refresh"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("opens export modal when Export Data button is clicked", () => {
    render(
      <AnalyticsHeader
        range="30d"
        onRangeChange={vi.fn()}
        asset="ALL"
        onAssetChange={vi.fn()}
        onRefresh={vi.fn()}
        loading={false}
        lastUpdated="12:00:00 PM"
        data={mockFullData}
      />
    );

    fireEvent.click(screen.getByText("Export Data"));
    expect(screen.getByText("Export Analytics Data")).toBeInTheDocument();
    expect(screen.getByText("CSV Spreadsheet")).toBeInTheDocument();
    expect(screen.getByText("JSON Dataset")).toBeInTheDocument();
    expect(screen.getByText("Executive PDF Report")).toBeInTheDocument();
  });
});

describe("AnalyticsExportModal", () => {
  it("renders export options and triggers CSV download", () => {
    const onClose = vi.fn();
    render(
      <AnalyticsExportModal
        isOpen={true}
        onClose={onClose}
        data={mockFullData}
        range="30d"
        asset="ALL"
      />
    );

    expect(screen.getByText("CSV Spreadsheet")).toBeInTheDocument();
    expect(screen.getByText("JSON Dataset")).toBeInTheDocument();

    const csvButton = screen.getByText("CSV Spreadsheet");
    expect(csvButton).toBeInTheDocument();
  });
});

describe("SuccessFailureRatesChart", () => {
  it("renders status breakdown and failure reasons", () => {
    render(
      <SuccessFailureRatesChart
        statusBreakdown={mockFullData.statusBreakdown}
        failureReasons={mockFullData.failureReasons}
      />
    );

    expect(screen.getByText("Success & Failure Rates")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("FAILED")).toBeInTheDocument();
    expect(screen.getByText("Insufficient Trustline")).toBeInTheDocument();
  });
});

describe("ProcessingTimeChart", () => {
  it("renders settlement latency by asset", () => {
    render(<ProcessingTimeChart data={mockFullData.processingTimes} />);

    expect(screen.getByText("Average Processing Time & Latency")).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("PYUSD")).toBeInTheDocument();
  });
});

describe("GeographicDistributionChart", () => {
  it("renders regional volume and top corridors", () => {
    render(<GeographicDistributionChart data={mockFullData.geographicDistribution} />);

    expect(screen.getByText("Geographic Distribution")).toBeInTheDocument();
    expect(screen.getByText("North America")).toBeInTheDocument();
    expect(screen.getByText("Europe")).toBeInTheDocument();
    expect(screen.getByText("United States → Germany")).toBeInTheDocument();
  });
});

describe("CostAnalysisChart", () => {
  it("renders fee savings analysis", () => {
    render(<CostAnalysisChart data={mockFullData.costAnalysis} />);

    expect(screen.getByText("Protocol Cost & Savings Analysis")).toBeInTheDocument();
    expect(screen.getByText("$357,997.85 (99.99%)")).toBeInTheDocument();
  });
});

describe("PredictiveAnalyticsCard", () => {
  it("renders 30-day forecast overview and peak notice", () => {
    render(<PredictiveAnalyticsCard data={mockFullData.predictiveAnalytics} />);

    expect(screen.getByText("30-Day Predictive Forecasting")).toBeInTheDocument();
    expect(screen.getByText("94.6%")).toBeInTheDocument();
    expect(screen.getByText("Expected volume surge between 14:00 - 17:00 UTC")).toBeInTheDocument();
  });
});
