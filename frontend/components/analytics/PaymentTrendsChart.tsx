"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface PaymentTrendsChartProps {
  data: AnalyticsDashboardResponse["paymentTrends"] | undefined;
}

export function PaymentTrendsChart({ data }: PaymentTrendsChartProps) {
  const [viewMode, setViewMode] = useState<"volume" | "count">("volume");

  if (!data || data.length === 0) return null;

  const formatTooltipValue = (value: number) => {
    if (viewMode === "volume") {
      return `$${value.toLocaleString()}`;
    }
    return `${value.toLocaleString()} txs`;
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400">
            <TrendingUp className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-wider">Payment Volume & Activity</p>
          </div>
          <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
            Payment Trends Over Time
          </h2>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 p-1">
          <button
            onClick={() => setViewMode("volume")}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "volume"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Volume ($)
          </button>
          <button
            onClick={() => setViewMode("count")}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "count"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Tx Count
          </button>
        </div>
      </div>

      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) =>
                viewMode === "volume"
                  ? val >= 1_000_000
                    ? `$${(val / 1_000_000).toFixed(1)}M`
                    : `$${(val / 1_000).toFixed(0)}K`
                  : val.toString()
              }
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#334155",
                borderRadius: "1rem",
                color: "#f8fafc",
              }}
              itemStyle={{ color: "#38bdf8", fontSize: "12px" }}
              labelStyle={{ color: "#f8fafc", fontWeight: 600, fontSize: "12px" }}
              formatter={(val: any) => [formatTooltipValue(Number(val)), viewMode === "volume" ? "Volume" : "Transactions"]}
            />
            <Area
              type="monotone"
              dataKey={viewMode === "volume" ? "volumeUsd" : "txCount"}
              stroke={viewMode === "volume" ? "#06b6d4" : "#a855f7"}
              strokeWidth={3}
              fillOpacity={1}
              fill={`url(#${viewMode === "volume" ? "colorVolume" : "colorCount"})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
