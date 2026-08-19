"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Globe, ArrowRight } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface GeographicDistributionChartProps {
  data: AnalyticsDashboardResponse["geographicDistribution"] | undefined;
}

const REGION_COLORS = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#ec4899"];

export function GeographicDistributionChart({ data }: GeographicDistributionChartProps) {
  if (!data) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Regional Volume Bar Chart & Breakdown */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <div className="flex items-center gap-2 text-teal-400">
          <Globe className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-wider">Global Reach</p>
        </div>
        <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
          Geographic Distribution
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Payment volume and transaction density by global region
        </p>

        <div className="mt-6 h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.regions}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 30, bottom: 0 }}
            >
              <XAxis type="number" stroke="#94a3b8" fontSize={11} tickFormatter={(val) => `$${(val / 1000).toFixed(0)}K`} />
              <YAxis dataKey="code" type="category" stroke="#94a3b8" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "1rem",
                  color: "#f8fafc",
                }}
                itemStyle={{ color: "#38bdf8", fontSize: "12px" }}
                labelStyle={{ color: "#f8fafc", fontWeight: 600, fontSize: "12px" }}
                formatter={(val: any, name: any, item: any) => [
                  `$${Number(val).toLocaleString()} (${item.payload.percentage}%)`,
                  item.payload.region,
                ]}
              />
              <Bar dataKey="volumeUsd" radius={[0, 8, 8, 0]}>
                {data.regions.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={REGION_COLORS[index % REGION_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Region Progress Bars */}
        <div className="mt-4 space-y-3">
          {data.regions.map((reg, idx) => (
            <div key={reg.region} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white">{reg.region}</span>
                <span className="text-slate-300">
                  ${reg.volumeUsd.toLocaleString()} ({reg.percentage}%) •{" "}
                  <span className="text-emerald-400">+{reg.growthPct}%</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${reg.percentage}%`,
                    backgroundColor: REGION_COLORS[idx % REGION_COLORS.length],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Cross-Border Corridors */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <div className="flex items-center gap-2 text-cyan-400">
          <ArrowRight className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-wider">Cross-Border Flows</p>
        </div>
        <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
          Top Payment Corridors
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Highest volume origin-to-destination corridors
        </p>

        <div className="mt-6 space-y-3">
          {data.topCorridors.map((corridor, idx) => (
            <div
              key={corridor.corridor}
              className="flex items-center justify-between rounded-2xl border border-white/5 bg-slate-900/60 p-4 transition hover:border-cyan-500/30 hover:bg-slate-900/80"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10 text-xs font-bold text-cyan-400 border border-cyan-500/20">
                  #{idx + 1}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{corridor.corridor}</p>
                  <p className="text-xs text-slate-400">{corridor.txCount.toLocaleString()} transactions</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-cyan-300">${corridor.volumeUsd.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
