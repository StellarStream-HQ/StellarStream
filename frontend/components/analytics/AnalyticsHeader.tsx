"use client";

import { useState } from "react";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import { AnalyticsExportModal } from "./AnalyticsExportModal";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface AnalyticsHeaderProps {
  range: string;
  onRangeChange: (range: string) => void;
  asset: string;
  onAssetChange: (asset: string) => void;
  onRefresh: () => void;
  loading: boolean;
  lastUpdated: string;
  data: AnalyticsDashboardResponse | null;
}

export function AnalyticsHeader({
  range,
  onRangeChange,
  asset,
  onAssetChange,
  onRefresh,
  loading,
  lastUpdated,
  data,
}: AnalyticsHeaderProps) {
  const [isExportOpen, setIsExportOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <Sparkles className="h-4 w-4" />
            <p className="font-body text-xs font-semibold uppercase tracking-[0.2em]">
              Real-Time Protocol Insights
            </p>
          </div>
          <h1 className="font-heading mt-1 text-3xl font-bold tracking-tight text-white md:text-4xl">
            Advanced Analytics Dashboard
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Payment trends, success rates, latency distributions, geographic corridors, cost efficiency, and predictive forecasting.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Last updated: {lastUpdated} • Auto-refresh active
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Asset Selector */}
          <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-900/60 p-1">
            {["ALL", "USDC", "XLM", "PYUSD"].map((item) => (
              <button
                key={item}
                onClick={() => onAssetChange(item)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  asset === item
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {/* Timeframe Range Selector */}
          <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-900/60 p-1">
            {[
              { id: "7d", label: "7D" },
              { id: "30d", label: "30D" },
              { id: "90d", label: "90D" },
              { id: "1y", label: "1Y" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => onRangeChange(item.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  range === item.id
                    ? "bg-purple-600/30 text-purple-300 border border-purple-500/40"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.12] disabled:opacity-50"
            title="Refresh Data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          {/* Export Button */}
          <button
            onClick={() => setIsExportOpen(true)}
            className="flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Data</span>
          </button>
        </div>
      </div>

      <AnalyticsExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={data}
        range={range}
        asset={asset}
      />
    </>
  );
}
