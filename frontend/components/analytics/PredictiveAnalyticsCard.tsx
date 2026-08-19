"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Sparkles, TrendingUp, ShieldCheck, AlertCircle } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface PredictiveAnalyticsCardProps {
  data: AnalyticsDashboardResponse["predictiveAnalytics"] | undefined;
}

export function PredictiveAnalyticsCard({ data }: PredictiveAnalyticsCardProps) {
  if (!data) return null;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-emerald-400">
            <Sparkles className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-wider">AI Predictive Analytics</p>
          </div>
          <h2 className="font-heading mt-1 text-xl font-bold text-white md:text-2xl">
            30-Day Predictive Forecasting
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Model Confidence: <strong className="text-emerald-400">{data.forecastConfidencePct}%</strong> • Projected Volume: <strong className="text-white">${data.forecastedVolume30d.toLocaleString()}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300">
            <TrendingUp className="h-4 w-4" />
            <span>Trend: {data.forecastTrend}</span>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs font-semibold text-indigo-300">
            <ShieldCheck className="h-4 w-4" />
            <span>Anomaly Risk: {data.anomalyRiskIndex}/100</span>
          </div>
        </div>
      </div>

      {/* Forecast Line Chart with Confidence Interval */}
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.forecastPoints} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} />
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
              itemStyle={{ color: "#10b981", fontSize: "12px" }}
              labelStyle={{ color: "#f8fafc", fontWeight: 600, fontSize: "12px" }}
              formatter={(val: any, name: any) => [
                `$${Number(val).toLocaleString()}`,
                name === "volumeUsd"
                  ? "Projected Volume"
                  : name === "upperBound"
                  ? "Upper Confidence Bound"
                  : "Lower Confidence Bound",
              ]}
            />
            <Area
              type="monotone"
              dataKey="upperBound"
              stroke="transparent"
              fill="#10b981"
              fillOpacity={0.1}
            />
            <Area
              type="monotone"
              dataKey="volumeUsd"
              stroke="#10b981"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#colorForecast)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Peak Window Notice */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{data.peakWindowNotice}</span>
      </div>
    </div>
  );
}
