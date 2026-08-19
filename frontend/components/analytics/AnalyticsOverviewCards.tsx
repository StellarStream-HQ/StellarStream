"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  DollarSign,
  Globe,
  PiggyBank,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface AnalyticsOverviewCardsProps {
  summary: AnalyticsDashboardResponse["summary"] | undefined;
}

export function AnalyticsOverviewCards({ summary }: AnalyticsOverviewCardsProps) {
  if (!summary) return null;

  const cards = [
    {
      title: "Total Stream Volume",
      value: `$${summary.totalVolumeUsd.toLocaleString()}`,
      change: "+14.2% vs prev period",
      isPositive: true,
      icon: DollarSign,
      color: "from-cyan-500/20 to-blue-500/10 border-cyan-500/30 text-cyan-400",
    },
    {
      title: "Success Rate",
      value: `${summary.successRatePct}%`,
      change: `+0.4% (${summary.transactionCount.toLocaleString()} total txs)`,
      isPositive: true,
      icon: CheckCircle2,
      color: "from-emerald-500/20 to-teal-500/10 border-emerald-500/30 text-emerald-400",
    },
    {
      title: "Avg Settlement Latency",
      value: `${summary.avgProcessingTimeSec}s`,
      change: "Sub-3s finality",
      isPositive: true,
      icon: Clock,
      color: "from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-400",
    },
    {
      title: "Banking Wire Savings",
      value: `$${summary.estimatedBankingSavingsUsd.toLocaleString()}`,
      change: "vs traditional bank fees ($25/tx)",
      isPositive: true,
      icon: PiggyBank,
      color: "from-purple-500/20 to-indigo-500/10 border-purple-500/30 text-purple-400",
    },
    {
      title: "Total Protocol & Gas Fees",
      value: `$${summary.totalProtocolFeesUsd.toLocaleString()}`,
      change: "Average $0.00015 / tx",
      isPositive: true,
      icon: Zap,
      color: "from-blue-500/20 to-cyan-500/10 border-blue-500/30 text-blue-400",
    },
    {
      title: "Failure Rate",
      value: `${summary.failureRatePct}%`,
      change: "-0.18% decrease",
      isPositive: true,
      icon: AlertTriangle,
      color: "from-rose-500/20 to-red-500/10 border-rose-500/30 text-rose-400",
    },
    {
      title: "Network Throughput",
      value: `${summary.peakTps.toLocaleString()} TPS`,
      change: "Peak transaction rate",
      isPositive: true,
      icon: Activity,
      color: "from-sky-500/20 to-indigo-500/10 border-sky-500/30 text-sky-400",
    },
    {
      title: "Projected 30D Volume",
      value: `$${summary.projected30dVolumeUsd.toLocaleString()}`,
      change: "+22.0% forecast growth",
      isPositive: true,
      icon: TrendingUp,
      color: "from-emerald-500/20 to-green-500/10 border-emerald-500/30 text-emerald-400",
    },
    {
      title: "Anomaly Risk Score",
      value: `${summary.anomalyRiskScore} / 100`,
      change: `Risk Level: ${summary.anomalyRiskLevel}`,
      isPositive: summary.anomalyRiskLevel === "LOW",
      icon: ShieldCheck,
      color: "from-indigo-500/20 to-violet-500/10 border-indigo-500/30 text-indigo-400",
    },
    {
      title: "Top Regional Corridor",
      value: summary.topCorridor,
      change: "Highest volume path",
      isPositive: true,
      icon: Globe,
      color: "from-teal-500/20 to-cyan-500/10 border-teal-500/30 text-teal-400",
    },
    {
      title: "Avg Transaction Size",
      value: `$${summary.avgTxSizeUsd.toLocaleString()}`,
      change: "Mean payment size",
      isPositive: true,
      icon: DollarSign,
      color: "from-violet-500/20 to-purple-500/10 border-violet-500/30 text-violet-400",
    },
    {
      title: "Active Streamers",
      value: summary.activeStreamers.toLocaleString(),
      change: "Active organization accounts",
      isPositive: true,
      icon: Users,
      color: "from-fuchsia-500/20 to-pink-500/10 border-fuchsia-500/30 text-fuchsia-400",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => {
        const IconComponent = card.icon;
        return (
          <div
            key={card.title}
            className={`group relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 backdrop-blur-xl transition hover:scale-[1.02] hover:shadow-xl ${card.color}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                {card.title}
              </span>
              <div className="rounded-2xl bg-white/10 p-2.5 backdrop-blur-md">
                <IconComponent className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-4">
              <h2 className="font-heading text-2xl font-bold tracking-tight text-white md:text-3xl">
                {card.value}
              </h2>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                <span>{card.change}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
