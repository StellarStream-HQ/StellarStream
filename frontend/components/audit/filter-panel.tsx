"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, X, ChevronDown, Calendar, Search, SlidersHorizontal } from "lucide-react";

export type ActionType =
  | "all"
  | "stream_created"
  | "stream_cancelled"
  | "withdrawal"
  | "payment"
  | "split"
  | "admin_change"
  | "upgrade"
  | "pause"
  | "resume";

export type DateRange = "7d" | "30d" | "custom" | "all";

export interface AuditFilters {
  search: string;
  actionType: ActionType;
  dateRange: DateRange;
  customStart: string;
  customEnd: string;
  user: string;
  resource: string;
}

export const DEFAULT_FILTERS: AuditFilters = {
  search: "",
  actionType: "all",
  dateRange: "all",
  customStart: "",
  customEnd: "",
  user: "",
  resource: "",
};

interface FilterPanelProps {
  filters: AuditFilters;
  onChange: (filters: AuditFilters) => void;
  onReset: () => void;
  totalResults: number;
}

const ACTION_TYPES: { value: ActionType; label: string }[] = [
  { value: "all", label: "All Actions" },
  { value: "stream_created", label: "Stream Created" },
  { value: "stream_cancelled", label: "Stream Cancelled" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "payment", label: "Payment" },
  { value: "split", label: "Split" },
  { value: "admin_change", label: "Admin Change" },
  { value: "upgrade", label: "Upgrade" },
  { value: "pause", label: "Pause" },
  { value: "resume", label: "Resume" },
];

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
];

export function FilterPanel({ filters, onChange, onReset, totalResults }: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [actionDropdown, setActionDropdown] = useState(false);
  const [dateDropdown, setDateDropdown] = useState(false);

  const hasActiveFilters =
    filters.search !== "" ||
    filters.actionType !== "all" ||
    filters.dateRange !== "all" ||
    filters.user !== "" ||
    filters.resource !== "";

  const update = (partial: Partial<AuditFilters>) =>
    onChange({ ...filters, ...partial });

  return (
    <div className="rounded-2xl border border-[#7c3aed]/20 bg-[#1a1f27] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        aria-expanded={isOpen}
        aria-controls="filter-panel-body"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[#7c3aed]" />
          <span className="text-sm font-semibold text-[#f5f3ff]">Filters</span>
          {hasActiveFilters && (
            <span className="ml-1 rounded-full bg-[#7c3aed] px-2 py-0.5 text-xs text-white">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#a8adc1]">{totalResults} events</span>
          <ChevronDown
            className={`h-4 w-4 text-[#a8adc1] transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id="filter-panel-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-5 py-4 space-y-4">
              {/* Search */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">
                  Search
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#a8adc1]" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => update({ search: e.target.value })}
                    placeholder="Recipient, stream ID, email…"
                    className="w-full rounded-xl border border-white/10 bg-[#0f1419] pl-9 pr-4 py-2 text-sm text-[#f5f3ff] placeholder:text-[#a8adc1]/50 focus:border-[#7c3aed]/50 focus:outline-none focus:ring-1 focus:ring-[#7c3aed]/30"
                  />
                  {filters.search && (
                    <button
                      onClick={() => update({ search: "" })}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <X className="h-3.5 w-3.5 text-[#a8adc1] hover:text-white" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Action Type */}
                <div className="relative">
                  <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">
                    Action Type
                  </label>
                  <button
                    onClick={() => { setActionDropdown((v) => !v); setDateDropdown(false); }}
                    className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] focus:border-[#7c3aed]/50 focus:outline-none"
                    aria-haspopup="listbox"
                    aria-expanded={actionDropdown}
                  >
                    <span>{ACTION_TYPES.find((a) => a.value === filters.actionType)?.label}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-[#a8adc1] transition-transform ${actionDropdown ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {actionDropdown && (
                      <motion.ul
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.12 }}
                        role="listbox"
                        className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f27] py-1 shadow-xl"
                      >
                        {ACTION_TYPES.map((a) => (
                          <li key={a.value}>
                            <button
                              role="option"
                              aria-selected={filters.actionType === a.value}
                              onClick={() => { update({ actionType: a.value }); setActionDropdown(false); }}
                              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                filters.actionType === a.value
                                  ? "text-[#00d4ff] bg-[#7c3aed]/10"
                                  : "text-[#f5f3ff] hover:bg-white/5"
                              }`}
                            >
                              {a.label}
                            </button>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>

                {/* Date Range */}
                <div className="relative">
                  <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">
                    Date Range
                  </label>
                  <button
                    onClick={() => { setDateDropdown((v) => !v); setActionDropdown(false); }}
                    className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] focus:border-[#7c3aed]/50 focus:outline-none"
                    aria-haspopup="listbox"
                    aria-expanded={dateDropdown}
                  >
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 text-[#a8adc1]" />
                      <span>{DATE_RANGES.find((d) => d.value === filters.dateRange)?.label}</span>
                    </div>
                    <ChevronDown className={`h-3.5 w-3.5 text-[#a8adc1] transition-transform ${dateDropdown ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {dateDropdown && (
                      <motion.ul
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.12 }}
                        role="listbox"
                        className="absolute z-20 mt-1 w-full rounded-xl border border-white/10 bg-[#1a1f27] py-1 shadow-xl"
                      >
                        {DATE_RANGES.map((d) => (
                          <li key={d.value}>
                            <button
                              role="option"
                              aria-selected={filters.dateRange === d.value}
                              onClick={() => { update({ dateRange: d.value }); setDateDropdown(false); }}
                              className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                filters.dateRange === d.value
                                  ? "text-[#00d4ff] bg-[#7c3aed]/10"
                                  : "text-[#f5f3ff] hover:bg-white/5"
                              }`}
                            >
                              {d.label}
                            </button>
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Custom date range */}
              <AnimatePresence>
                {filters.dateRange === "custom" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="grid grid-cols-2 gap-3"
                  >
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">From</label>
                      <input
                        type="date"
                        value={filters.customStart}
                        onChange={(e) => update({ customStart: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] focus:border-[#7c3aed]/50 focus:outline-none [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">To</label>
                      <input
                        type="date"
                        value={filters.customEnd}
                        onChange={(e) => update({ customEnd: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] focus:border-[#7c3aed]/50 focus:outline-none [color-scheme:dark]"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* User */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">
                    User / Email
                  </label>
                  <input
                    type="text"
                    value={filters.user}
                    onChange={(e) => update({ user: e.target.value })}
                    placeholder="user@example.com"
                    className="w-full rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] placeholder:text-[#a8adc1]/50 focus:border-[#7c3aed]/50 focus:outline-none focus:ring-1 focus:ring-[#7c3aed]/30"
                  />
                </div>

                {/* Resource */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#a8adc1] uppercase tracking-wide">
                    Resource / Stream ID
                  </label>
                  <input
                    type="text"
                    value={filters.resource}
                    onChange={(e) => update({ resource: e.target.value })}
                    placeholder="Stream ID or contract…"
                    className="w-full rounded-xl border border-white/10 bg-[#0f1419] px-3 py-2 text-sm text-[#f5f3ff] placeholder:text-[#a8adc1]/50 focus:border-[#7c3aed]/50 focus:outline-none focus:ring-1 focus:ring-[#7c3aed]/30"
                  />
                </div>
              </div>

              {/* Reset */}
              {hasActiveFilters && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={onReset}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#a8adc1] hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Reset filters
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
