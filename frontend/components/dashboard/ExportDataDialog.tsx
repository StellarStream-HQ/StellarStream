"use client";

import { useState } from "react";

export type ExportFormat = "json" | "csv" | "xlsx" | "pdf" | "qif" | "ofx";

interface ExportDataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, options: ExportOptions) => Promise<void>;
  availableFormats?: ExportFormat[];
}

interface ExportOptions {
  includeMetadata: boolean;
  dateRange?: { from: string; to: string };
}

const FORMAT_INFO: Record<ExportFormat, { name: string; description: string; icon: string }> = {
  json: {
    name: "JSON",
    description: "Universal data format for development and integration",
    icon: "{ }",
  },
  csv: {
    name: "CSV",
    description: "Comma-separated values for spreadsheet applications",
    icon: "📊",
  },
  xlsx: {
    name: "Excel (.xlsx)",
    description: "Microsoft Excel format with formatting support",
    icon: "📈",
  },
  pdf: {
    name: "PDF Report",
    description: "Professional formatted report document",
    icon: "📄",
  },
  qif: {
    name: "QIF",
    description: "Quicken Interchange Format for accounting software",
    icon: "💰",
  },
  ofx: {
    name: "OFX",
    description: "Open Financial Exchange for banking applications",
    icon: "🏦",
  },
};

export function ExportDataDialog({
  isOpen,
  onClose,
  onExport,
  availableFormats = ["json", "csv", "xlsx", "pdf", "qif", "ofx"],
}: ExportDataDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("json");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const dateRange =
        dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined;

      await onExport(selectedFormat, {
        includeMetadata,
        dateRange,
      });

      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 backdrop-blur-xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white">Export Data</h2>
            <p className="text-sm text-white/50 mt-1">
              Choose your preferred format and configure export options
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/60 text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Format Selection */}
        <div className="mb-6">
          <label className="text-sm font-semibold text-white/80 block mb-3">
            Export Format
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availableFormats.map(format => {
              const info = FORMAT_INFO[format];
              return (
                <button
                  key={format}
                  onClick={() => setSelectedFormat(format)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    selectedFormat === format
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-white/10 bg-white/4 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{info.icon}</span>
                    <div>
                      <p className="font-semibold text-white">{info.name}</p>
                      <p className="text-xs text-white/40">{info.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Export Options */}
        <div className="mb-6 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={e => setIncludeMetadata(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-white/70">
              Include metadata (export date, record count)
            </span>
          </label>

          <div>
            <label className="text-sm font-semibold text-white/80 block mb-2">
              Date Range (Optional)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/30"
                placeholder="From"
              />
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/30"
                placeholder="To"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="flex-1 px-4 py-3 rounded-lg border border-white/10 bg-white/4 text-white/70 font-semibold hover:bg-white/6 disabled:opacity-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                ↓ Export {FORMAT_INFO[selectedFormat].name}
              </>
            )}
          </button>
        </div>

        {/* Info */}
        <div className="mt-6 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-xs text-blue-400">
            💡 Large exports may take a moment to process. A download will start automatically
            when ready.
          </p>
        </div>
      </div>
    </div>
  );
}
