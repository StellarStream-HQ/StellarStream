"use client";

/**
 * Audit Trail Page — Issue #1196
 * Redesigned with moon theme, advanced filtering, timeline, diff view, export.
 */

import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck, Download, FileJson, FileText,
  ChevronLeft, ChevronRight, Info,
} from "lucide-react";
import { FilterPanel, DEFAULT_FILTERS, type AuditFilters, type ActionType } from "@/components/audit/filter-panel";
import { EventTimeline, type AuditEvent } from "@/components/audit/event-timeline";
import { EventDetails } from "@/components/audit/event-details";

// ── Mock data ────────────────────────────────────────────────────────────────
// Replace with real API call / SWR hook in production.

function makeMockEvents(): AuditEvent[] {
  const types: ActionType[] = [
    "stream_created", "stream_cancelled", "withdrawal", "payment",
    "split", "admin_change", "upgrade", "pause", "resume",
  ];
  const users = [
    "alice@stellar.org", "bob@example.com", "carol@defi.io",
    "dave@trustanchor.net", "eve@lumens.xyz",
  ];
  return Array.from({ length: 200 }, (_, i) => {
    const actionType = types[i % types.length];
    const daysAgo = Math.floor(i / 6);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(d.getHours() - (i % 24));
    return {
      id: `evt-${i.toString().padStart(4, "0")}`,
      actionType,
      title: `${actionType.replace(/_/g, " ")} #${1000 + i}`,
      description: i % 3 === 0 ? `Automated action triggered by protocol rule ${i}` : undefined,
      timestamp: d.toISOString(),
      user: users[i % users.length],
      resource: `stream-${(1000 + i).toString(16)}`,
      txHash: i % 2 === 0 ? `${"a".repeat(10)}${i.toString().padStart(6, "0")}${"b".repeat(48)}` : undefined,
      before: i % 4 === 0
        ? { status: "active", amount: `${100 + i} XLM`, fee_bps: 50 }
        : undefined,
      after: i % 4 === 0
        ? { status: actionType === "stream_cancelled" ? "cancelled" : "completed", amount: `${100 + i} XLM`, fee_bps: 75 }
        : undefined,
    };
  });
}

const ALL_EVENTS = makeMockEvents();

// ── Date range helper ────────────────────────────────────────────────────────
function isWithinRange(iso: string, dateRange: AuditFilters["dateRange"], customStart: string, customEnd: string): boolean {
  const d = new Date(iso).getTime();
  const now = Date.now();
  if (dateRange === "7d") return d >= now - 7 * 86_400_000;
  if (dateRange === "30d") return d >= now - 30 * 86_400_000;
  if (dateRange === "custom") {
    const s = customStart ? new Date(customStart).getTime() : -Infinity;
    const e = customEnd ? new Date(customEnd).getTime() + 86_400_000 : Infinity;
    return d >= s && d <= e;
  }
  return true;
}

const PAGE_SIZE = 50;

// ── Export helpers ───────────────────────────────────────────────────────────
function exportCSV(events: AuditEvent[]) {
  const headers = ["id", "actionType", "title", "timestamp", "user", "resource", "txHash"];
  const rows = events.map((e) =>
    headers.map((h) => {
      const v = (e as unknown as Record<string, unknown>)[h];
      return typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v ?? "";
    }).join(",")
  );
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-trail-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(events: AuditEvent[]) {
  const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-trail-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AuditTrailPage() {
  const [filters, setFilters] = useState<AuditFilters>(DEFAULT_FILTERS);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase();
    return ALL_EVENTS.filter((e) => {
      if (filters.actionType !== "all" && e.actionType !== filters.actionType) return false;
      if (!isWithinRange(e.timestamp, filters.dateRange, filters.customStart, filters.customEnd)) return false;
      if (filters.user && !e.user?.toLowerCase().includes(filters.user.toLowerCase())) return false;
      if (filters.resource && !e.resource?.toLowerCase().includes(filters.resource.toLowerCase())) return false;
      if (q) {
        return (
          e.title.toLowerCase().includes(q) ||
          e.user?.toLowerCase().includes(q) ||
          e.resource?.toLowerCase().includes(q) ||
          e.txHash?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const handleFilterChange = useCallback((f: AuditFilters) => {
    setFilters(f);
    setPage(1);
    setSelectedEvent(null);
  }, []);

  const handleReset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setSelectedEvent(null);
  }, []);

  return (
    <div className="min-h-screen bg-[#0f1419]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8 flex flex-wrap items-start justify-between gap-4"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7c3aed]/20">
                <ShieldCheck className="h-5 w-5 text-[#7c3aed]" />
              </div>
              <h1 className="text-2xl font-bold text-[#f5f3ff]">Audit Trail</h1>
            </div>
            <p className="text-sm text-[#a8adc1]">
              Hash-chained protocol event log · verified locally in your browser
            </p>
          </div>

          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV(filtered)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1a1f27] px-3 py-2 text-xs font-medium text-[#a8adc1] hover:border-[#7c3aed]/40 hover:text-white transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={() => exportJSON(filtered)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-[#1a1f27] px-3 py-2 text-xs font-medium text-[#a8adc1] hover:border-[#7c3aed]/40 hover:text-white transition-colors"
            >
              <FileJson className="h-3.5 w-3.5" />
              Export JSON
            </button>
          </div>
        </motion.div>

        {/* Info banner */}
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#00d4ff]/60" />
          <p className="text-xs text-[#a8adc1] leading-relaxed">
            Each entry is cryptographically linked to the previous one via SHA-256.
            A <span className="text-emerald-400">green</span> diff line indicates an added value;{" "}
            <span className="text-rose-400">red</span> indicates a removed value.
            Timestamps show both <strong className="text-[#f5f3ff]/70">UTC</strong> and your local timezone.
          </p>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr_360px]">

          {/* Left — Filter panel */}
          <div className="lg:col-span-1">
            <FilterPanel
              filters={filters}
              onChange={handleFilterChange}
              onReset={handleReset}
              totalResults={filtered.length}
            />
          </div>

          {/* Centre — Timeline */}
          <div className="min-w-0">
            <EventTimeline
              events={filtered}
              selectedId={selectedEvent?.id ?? null}
              onSelect={setSelectedEvent}
              page={page}
              pageSize={PAGE_SIZE}
            />

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-[#a8adc1]">
                  Page {page} of {totalPages} · {filtered.length} events
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1a1f27] text-[#a8adc1] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                          p === page
                            ? "bg-[#7c3aed] text-white"
                            : "border border-white/10 bg-[#1a1f27] text-[#a8adc1] hover:text-white"
                        }`}
                        aria-label={`Page ${p}`}
                        aria-current={p === page ? "page" : undefined}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#1a1f27] text-[#a8adc1] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right — Event details (desktop) */}
          <div className="hidden xl:block">
            {selectedEvent ? (
              <EventDetails
                event={selectedEvent}
                onClose={() => setSelectedEvent(null)}
              />
            ) : (
              <div className="rounded-2xl border border-white/5 bg-[#1a1f27] flex flex-col items-center justify-center py-16 text-center">
                <ShieldCheck className="h-8 w-8 text-[#7c3aed]/40" />
                <p className="mt-3 text-sm text-[#a8adc1]">Select an event to view details</p>
              </div>
            )}
          </div>
        </div>

        {/* Mobile details drawer */}
        {selectedEvent && (
          <div className="mt-6 xl:hidden">
            <EventDetails
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

