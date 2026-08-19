"use client";

import { useState } from "react";
import { Download, FileCode, FileSpreadsheet, FileText, X } from "lucide-react";
import type { AnalyticsDashboardResponse } from "@/lib/analytics/types";

interface AnalyticsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: AnalyticsDashboardResponse | null;
  range: string;
  asset: string;
}

export function AnalyticsExportModal({
  isOpen,
  onClose,
  data,
  range,
  asset,
}: AnalyticsExportModalProps) {
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  if (!isOpen || !data) return null;

  const handleExportCSV = () => {
    setExportingFormat("csv");
    try {
      const rows: string[][] = [
        ["METRIC / SECTION", "KEY", "VALUE", "DETAILS"],
        ["Summary", "Total Volume (USD)", data.summary.totalVolumeUsd.toString(), ""],
        ["Summary", "Success Rate (%)", data.summary.successRatePct.toString(), ""],
        ["Summary", "Avg Processing Time (s)", data.summary.avgProcessingTimeSec.toString(), ""],
        ["Summary", "Banking Fee Savings (USD)", data.summary.estimatedBankingSavingsUsd.toString(), ""],
        ["Summary", "Total Protocol Fees (USD)", data.summary.totalProtocolFeesUsd.toString(), ""],
        ["Summary", "Failure Rate (%)", data.summary.failureRatePct.toString(), ""],
        ["Summary", "Peak TPS", data.summary.peakTps.toString(), ""],
        ["Summary", "Projected 30D Volume (USD)", data.summary.projected30dVolumeUsd.toString(), ""],
        ["Summary", "Anomaly Risk Score", data.summary.anomalyRiskScore.toString(), data.summary.anomalyRiskLevel],
        ["Summary", "Top Corridor", data.summary.topCorridor, ""],
        ["Summary", "Avg Transaction Size (USD)", data.summary.avgTxSizeUsd.toString(), ""],
        ["Summary", "Active Streamers", data.summary.activeStreamers.toString(), ""],
        ...data.paymentTrends.map((pt) => [
          "Payment Trend",
          pt.label,
          pt.volumeUsd.toString(),
          `${pt.txCount} txs (${pt.completedCount} completed, ${pt.failedCount} failed)`,
        ]),
        ...data.statusBreakdown.map((sb) => [
          "Status Breakdown",
          sb.status,
          sb.count.toString(),
          `$${sb.volumeUsd.toLocaleString()} (${sb.percentage}%)`,
        ]),
        ...data.geographicDistribution.regions.map((reg) => [
          "Geographic Region",
          reg.region,
          `$${reg.volumeUsd.toLocaleString()}`,
          `${reg.txCount} txs (${reg.percentage}%, Growth: ${reg.growthPct}%)`,
        ]),
        ...data.costAnalysis.costByAsset.map((ca) => [
          "Cost By Asset",
          ca.asset,
          `$${ca.feeUsd}`,
          `${ca.txCount} txs, Avg: $${ca.avgFeeUsd}`,
        ]),
      ];

      const csvContent = rows
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stellarstream-analytics-${range}-${asset.toLowerCase()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportJSON = () => {
    setExportingFormat("json");
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        filterRange: range,
        filterAsset: asset,
        analytics: data,
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stellarstream-analytics-${range}-${asset.toLowerCase()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportPDF = async () => {
    setExportingFormat("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();

      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42);
      doc.text("StellarStream Executive Analytics Report", 14, 20);

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date().toLocaleString()} | Filter: ${range.toUpperCase()} | Asset: ${asset}`, 14, 28);
      doc.setDrawColor(226, 232, 240);
      doc.line(14, 32, 196, 32);

      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text("1. Executive Summary & KPIs", 14, 42);

      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      const metricsText = [
        `• Total Stream Volume: $${data.summary.totalVolumeUsd.toLocaleString()}`,
        `• Success Rate: ${data.summary.successRatePct}%`,
        `• Average Settlement Latency: ${data.summary.avgProcessingTimeSec}s`,
        `• Estimated Banking Wire Savings: $${data.summary.estimatedBankingSavingsUsd.toLocaleString()}`,
        `• Total Protocol & Gas Fees: $${data.summary.totalProtocolFeesUsd.toLocaleString()}`,
        `• Failure Rate: ${data.summary.failureRatePct}%`,
        `• Projected 30-Day Volume: $${data.summary.projected30dVolumeUsd.toLocaleString()}`,
        `• Anomaly Risk Score: ${data.summary.anomalyRiskScore}/100 (${data.summary.anomalyRiskLevel})`,
        `• Top Regional Corridor: ${data.summary.topCorridor}`,
        `• Average Transaction Size: $${data.summary.avgTxSizeUsd.toLocaleString()}`,
      ];

      metricsText.forEach((line, idx) => {
        doc.text(line, 18, 52 + idx * 7);
      });

      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text("2. Regional Payment Breakdown", 14, 130);

      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      data.geographicDistribution.regions.forEach((reg, idx) => {
        doc.text(
          `• ${reg.region}: $${reg.volumeUsd.toLocaleString()} (${reg.percentage}%) - ${reg.txCount} txs`,
          18,
          140 + idx * 7
        );
      });

      doc.save(`stellarstream-analytics-report-${range}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-heading text-lg font-semibold text-white">Export Analytics Data</h3>
            <p className="text-xs text-slate-400">Download report metrics ({range.toUpperCase()} • {asset})</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <button
            onClick={handleExportCSV}
            disabled={exportingFormat !== null}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/10"
          >
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-white">CSV Spreadsheet</p>
                <p className="text-xs text-slate-400">Raw dataset formatted for Excel, Google Sheets</p>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-400" />
          </button>

          <button
            onClick={handleExportJSON}
            disabled={exportingFormat !== null}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-indigo-500/50 hover:bg-indigo-500/10"
          >
            <div className="flex items-center gap-3">
              <FileCode className="h-5 w-5 text-indigo-400" />
              <div>
                <p className="text-sm font-medium text-white">JSON Dataset</p>
                <p className="text-xs text-slate-400">Complete structured schema payload</p>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-400" />
          </button>

          <button
            onClick={handleExportPDF}
            disabled={exportingFormat !== null}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-rose-500/50 hover:bg-rose-500/10"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-rose-400" />
              <div>
                <p className="text-sm font-medium text-white">Executive PDF Report</p>
                <p className="text-xs text-slate-400">Print-ready executive summary PDF</p>
              </div>
            </div>
            <Download className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
