"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PiggyBank, Sparkles, Zap } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface CostAnalysisChartProps {
  data: AnalyticsDashboardResponse["costAnalysis"] | undefined;
}

export function CostAnalysisChart({ data }: CostAnalysisChartProps) {
  if (!data) return null;

  const comparisonData = [
    {
      name: "StellarStream Gas Fees",
      cost: data.totalFeesUsd,
      fill: "#06b6d4",
    },
    {
      name: "Traditional Wire Fees",
      cost: data.traditionalWireCostUsd,
      fill: "#ef4444",
    },
  ];

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-purple-400">
            <PiggyBank className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-wider">Fee Savings & Efficiency</p>
          </div>
          <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
            Protocol Cost & Savings Analysis
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Comparing StellarStream micro-gas execution against standard banking wire fees
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-purple-300">
          <Sparkles className="h-5 w-5 text-purple-400" />
          <div>
            <p className="text-xs font-semibold">Total Cost Savings</p>
            <p className="font-heading text-lg font-bold text-white">
              ${data.totalSavingsUsd.toLocaleString()} ({data.savingsPct}%)
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cost Comparison Bar Chart */}
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} />
              <YAxis
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}K`}
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
                formatter={(val: any) => [`$${Number(val).toLocaleString()}`, "Estimated Total Fee"]}
              />
              <Bar dataKey="cost" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Asset Cost Distribution List */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Fee Breakdown by Asset
          </p>
          {data.costByAsset.map((asset) => (
            <div
              key={asset.asset}
              className="flex items-center justify-between rounded-2xl border border-white/5 bg-slate-900/60 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{asset.asset}</p>
                  <p className="text-xs text-slate-400">{asset.txCount.toLocaleString()} transactions</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-purple-300">${asset.feeUsd.toFixed(2)} total fee</p>
                <p className="text-xs text-slate-400">Avg ${asset.avgFeeUsd} / tx</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
