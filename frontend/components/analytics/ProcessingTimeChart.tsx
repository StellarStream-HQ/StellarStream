"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Clock, Zap } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface ProcessingTimeChartProps {
  data: AnalyticsDashboardResponse["processingTimes"] | undefined;
}

export function ProcessingTimeChart({ data }: ProcessingTimeChartProps) {
  if (!data) return null;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-amber-400">
            <Clock className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-wider">Speed & Finality</p>
          </div>
          <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
            Average Processing Time & Latency
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Overall average settlement time: <strong className="text-amber-400">{data.overallAvgSec} seconds</strong>
          </p>
        </div>

        {/* Asset latency breakdown pill list */}
        <div className="flex flex-wrap gap-3">
          {data.byAsset.map((item) => (
            <div
              key={item.asset}
              className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2.5"
            >
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-white">{item.asset}</span>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Avg: <strong className="text-white">{item.avgTimeSec}s</strong> • P95: <span className="text-slate-400">{item.p95TimeSec}s</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Latency time series chart */}
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.latencyTimeSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={12} tickLine={false} />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              unit="s"
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#334155",
                borderRadius: "1rem",
                color: "#f8fafc",
              }}
              itemStyle={{ color: "#f59e0b", fontSize: "12px" }}
              labelStyle={{ color: "#f8fafc", fontWeight: 600, fontSize: "12px" }}
              formatter={(val: any, name: any) => [
                `${val}s`,
                name === "avgLatencySec" ? "Average Latency" : "P95 Latency",
              ]}
            />
            <Line
              type="monotone"
              dataKey="avgLatencySec"
              stroke="#f59e0b"
              strokeWidth={3}
              dot={{ r: 4, fill: "#f59e0b" }}
            />
            <Line
              type="monotone"
              dataKey="p95LatencySec"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3, fill: "#ef4444" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
