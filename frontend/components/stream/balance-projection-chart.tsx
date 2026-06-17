"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { StreamData } from "@/components/view-stream-client";

interface BalanceProjectionChartProps {
  stream: StreamData;
}

/**
 * Balance Projection Chart — animated Recharts area chart showing streamed amount
 * over time with projection into the future. Color shifts based on progress.
 */
export function BalanceProjectionChart({ stream }: BalanceProjectionChartProps) {
  const percentComplete = (stream.streamed / stream.totalAmount) * 100;

  // Determine chart color based on progress
  const chartColor =
    percentComplete < 50
      ? "#34d399" // green
      : percentComplete < 80
        ? "#fbbf24" // yellow
        : "#f87171"; // red

  const chartGradientId = "balanceGradient";

  // Generate chart data points
  const chartData = useMemo(() => {
    const startTime = new Date(stream.startTime).getTime();
    const endTime = new Date(stream.endTime).getTime();
    const now = Date.now();
    const totalDuration = endTime - startTime;
    type ChartPoint = {
      time: string;
      timeMs: number;
      streamed: number | null;
      projected: number | null;
    };
    const points: ChartPoint[] = [];

    // Generate ~12 time points across the stream duration
    const intervals = 12;
    for (let i = 0; i <= intervals; i++) {
      const t = startTime + (totalDuration * i) / intervals;
      const elapsed = t - startTime;
      const expectedStreamed = Math.min(
        elapsed * stream.ratePerSecond,
        stream.totalAmount,
      );
      const isPast = t <= now;

      points.push({
        time: new Date(t).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        timeMs: t,
        streamed: isPast ? expectedStreamed : null,
        projected: !isPast ? expectedStreamed : null,
      });
    }

    // Add current point (always in the "past" so it renders on the streamed line)
    const currentElapsed = now - startTime;
    const currentStreamed = Math.min(
      currentElapsed * stream.ratePerSecond,
      stream.totalAmount,
    );

    points.push({
      time: "Now",
      timeMs: now,
      streamed: currentStreamed,
      projected: null,
    });

    // Sort by timestamp to ensure correct chronological order
    return points.sort((a, b) => a.timeMs - b.timeMs);
  }, [stream]);

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { value: number; name: string; color: string }[];
    label?: string;
  }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="rounded-lg border border-white/10 bg-[#0a0a14]/95 px-3 py-2 backdrop-blur-xl">
        <p className="font-body text-[10px] uppercase tracking-wider text-white/40">
          {label}
        </p>
        <p className="font-ticker text-sm font-bold text-white">
          {payload[0]?.value?.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {stream.token}
        </p>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="font-body text-[10px] uppercase tracking-widest text-white/35">
          Balance Projection
        </p>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#00f5ff]" />
            <span className="font-body text-[10px] text-white/30">Streamed</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-dashed border-[#8a00ff]/50 bg-transparent" />
            <span className="font-body text-[10px] text-white/30">Projected</span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id={chartGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
              tickFormatter={(val: number) =>
                val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)
              }
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="streamed"
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#${chartGradientId})`}
              isAnimationActive={true}
              animationDuration={1200}
              animationEasing="ease-out"
              dot={false}
              activeDot={{
                r: 4,
                fill: chartColor,
                stroke: "#0a0a14",
                strokeWidth: 2,
              }}
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke="#8a00ff"
              strokeWidth={2}
              strokeDasharray="6 3"
              fill="none"
              isAnimationActive={true}
              animationDuration={1200}
              animationEasing="ease-out"
              dot={false}
              activeDot={{
                r: 4,
                fill: "#8a00ff",
                stroke: "#0a0a14",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}