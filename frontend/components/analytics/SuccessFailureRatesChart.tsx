"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface SuccessFailureRatesChartProps {
  statusBreakdown: AnalyticsDashboardResponse["statusBreakdown"] | undefined;
  failureReasons: AnalyticsDashboardResponse["failureReasons"] | undefined;
}

export function SuccessFailureRatesChart({
  statusBreakdown,
  failureReasons,
}: SuccessFailureRatesChartProps) {
  if (!statusBreakdown || statusBreakdown.length === 0) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Status Distribution Donut */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-wider">Settlement Reliability</p>
        </div>
        <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
          Success & Failure Rates
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Status distribution of all processed payments in selected range
        </p>

        <div className="mt-6 flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="h-[220px] w-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="count"
                >
                  {statusBreakdown.map((entry) => (
                    <Cell key={entry.status} fill={entry.color} stroke="#0f172a" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "1rem",
                    color: "#f8fafc",
                  }}
                  itemStyle={{ color: "#f8fafc", fontSize: "12px" }}
                  labelStyle={{ color: "#f8fafc", fontWeight: 600, fontSize: "12px" }}
                  formatter={(val: any, name: any, item: any) => [
                    `${val.toLocaleString()} txs (${item.payload.percentage}%)`,
                    item.payload.status,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="w-full flex-1 space-y-3">
            {statusBreakdown.map((item) => (
              <div
                key={item.status}
                className="flex items-center justify-between rounded-2xl border border-white/5 bg-slate-900/50 p-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <div>
                    <p className="text-xs font-semibold text-white">{item.status}</p>
                    <p className="text-[11px] text-slate-400">{item.percentage}% of total</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-white">{item.count.toLocaleString()}</p>
                  <p className="text-[11px] text-slate-400">${item.volumeUsd.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Failure Reason Analysis */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
        <div className="flex items-center gap-2 text-rose-400">
          <ShieldAlert className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-wider">Root Cause Diagnostics</p>
        </div>
        <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
          Failure Reason Breakdown
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Categorized diagnostics for failed or rejected transactions
        </p>

        <div className="mt-6 space-y-3">
          {failureReasons?.map((item) => (
            <div
              key={item.reason}
              className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-4 transition hover:bg-rose-500/[0.08]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-rose-300">{item.reason}</span>
                <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-300">
                  {item.percentage}% ({item.count} txs)
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300">{item.description}</p>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${item.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
