"use client";

import { useEffect, useState, useCallback } from "react";
import { AnalyticsHeader } from "@/components/analytics/AnalyticsHeader";
import { AnalyticsOverviewCards } from "@/components/analytics/AnalyticsOverviewCards";
import { PaymentTrendsChart } from "@/components/analytics/PaymentTrendsChart";
import { SuccessFailureRatesChart } from "@/components/analytics/SuccessFailureRatesChart";
import { ProcessingTimeChart } from "@/components/analytics/ProcessingTimeChart";
import { GeographicDistributionChart } from "@/components/analytics/GeographicDistributionChart";
import { CostAnalysisChart } from "@/components/analytics/CostAnalysisChart";
import { PredictiveAnalyticsCard } from "@/components/analytics/PredictiveAnalyticsCard";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

export default function AnalyticsDashboardPage() {
  const [data, setData] = useState<AnalyticsDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("30d");
  const [asset, setAsset] = useState("ALL");
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleTimeString());

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/analytics/dashboard?range=${range}&asset=${asset}`);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setError(json.error || "Failed to load analytics data");
      }
    } catch {
      setError("Unable to connect to analytics service");
    } finally {
      setLoading(false);
    }
  }, [range, asset]);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 30_000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <AnalyticsHeader
        range={range}
        onRangeChange={setRange}
        asset={asset}
        onAssetChange={setAsset}
        onRefresh={fetchAnalytics}
        loading={loading}
        lastUpdated={lastUpdated}
        data={data}
      />

      {loading && !data && (
        <div className="flex h-64 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center backdrop-blur-xl">
          <div className="space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent mx-auto" />
            <p className="text-sm font-medium text-slate-300">Loading comprehensive analytics insights...</p>
          </div>
        </div>
      )}

      {error && !data && (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/[0.05] p-6 text-center text-rose-300 backdrop-blur-xl">
          <p className="font-semibold">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="mt-3 rounded-2xl bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30"
          >
            Retry Loading
          </button>
        </div>
      )}

      {data && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* 12 Core KPI Cards */}
          <AnalyticsOverviewCards summary={data.summary} />

          {/* Payment Trends Area Chart */}
          <PaymentTrendsChart data={data.paymentTrends} />

          {/* Success & Failure Rates + Failure Reasons */}
          <SuccessFailureRatesChart
            statusBreakdown={data.statusBreakdown}
            failureReasons={data.failureReasons}
          />

          {/* Average Processing Time & Latency Trends */}
          <ProcessingTimeChart data={data.processingTimes} />

          {/* Geographic Distribution & Top Corridors */}
          <GeographicDistributionChart data={data.geographicDistribution} />

          {/* Cost Analysis & Banking Fee Savings */}
          <CostAnalysisChart data={data.costAnalysis} />

          {/* AI Predictive Analytics & 30-Day Forecast */}
          <PredictiveAnalyticsCard data={data.predictiveAnalytics} />
        </div>
      )}
    </div>
  );
}
