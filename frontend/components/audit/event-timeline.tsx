"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, ArrowDownLeft, ArrowUpRight, Settings, Shield,
  Zap, PauseCircle, PlayCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import type { ActionType } from "./filter-panel";

export interface AuditEvent {
  id: string;
  actionType: ActionType;
  title: string;
  description?: string;
  timestamp: string;
  user?: string;
  resource?: string;
  txHash?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

interface EventTimelineProps {
  events: AuditEvent[];
  selectedId: string | null;
  onSelect: (event: AuditEvent) => void;
  page: number;
  pageSize: number;
}

const ACTION_META: Record<
  ActionType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  all: { icon: Activity, color: "text-[#a8adc1]", bg: "bg-[#a8adc1]/10" },
  stream_created: { icon: ArrowUpRight, color: "text-emerald-400", bg: "bg-emerald-400/10" },
  stream_cancelled: { icon: ArrowDownLeft, color: "text-rose-400", bg: "bg-rose-400/10" },
  withdrawal: { icon: ArrowDownLeft, color: "text-[#00d4ff]", bg: "bg-[#00d4ff]/10" },
  payment: { icon: Zap, color: "text-amber-400", bg: "bg-amber-400/10" },
  split: { icon: Activity, color: "text-violet-400", bg: "bg-violet-400/10" },
  admin_change: { icon: Settings, color: "text-orange-400", bg: "bg-orange-400/10" },
  upgrade: { icon: Shield, color: "text-[#7c3aed]", bg: "bg-[#7c3aed]/10" },
  pause: { icon: PauseCircle, color: "text-amber-400", bg: "bg-amber-400/10" },
  resume: { icon: PlayCircle, color: "text-emerald-400", bg: "bg-emerald-400/10" },
};

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  const utc = d.toUTCString().replace(" GMT", " UTC");
  const local = d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  return { utc, local };
}

function TimelineItem({
  event,
  isLast,
  isSelected,
  onSelect,
}: {
  event: AuditEvent;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meta = ACTION_META[event.actionType] ?? ACTION_META.all;
  const Icon = meta.icon;
  const { utc, local } = formatTimestamp(event.timestamp);

  return (
    <div className="relative flex gap-4">
      {/* Timeline spine */}
      {!isLast && (
        <div className="absolute left-[19px] top-10 h-full w-px bg-white/5" />
      )}

      {/* Icon */}
      <div className={`relative z-10 mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.bg} border border-white/10`}>
        <Icon className={`h-4 w-4 ${meta.color}`} />
      </div>

      {/* Card */}
      <motion.button
        onClick={onSelect}
        className={`mb-4 flex-1 rounded-xl border px-4 py-3 text-left transition-all ${
          isSelected
            ? "border-[#7c3aed]/50 bg-[#7c3aed]/10"
            : "border-white/5 bg-[#1a1f27] hover:border-white/10 hover:bg-white/[0.02]"
        }`}
        whileHover={{ x: 2 }}
        transition={{ duration: 0.1 }}
        aria-pressed={isSelected}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-xs font-medium uppercase tracking-wide ${meta.color}`}>
              {event.actionType.replace(/_/g, " ")}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[#f5f3ff] truncate">{event.title}</p>
            {event.description && (
              <p className="mt-0.5 text-xs text-[#a8adc1] line-clamp-1">{event.description}</p>
            )}
          </div>
          <ChevronRight className={`h-4 w-4 shrink-0 mt-0.5 transition-transform ${isSelected ? "rotate-90 text-[#7c3aed]" : "text-[#a8adc1]/40"}`} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-[#a8adc1]" title={utc}>{local}</span>
          {event.user && (
            <span className="text-xs text-[#a8adc1]/70 truncate max-w-[140px]">{event.user}</span>
          )}
          {event.resource && (
            <span className="font-mono text-xs text-[#a8adc1]/50 truncate max-w-[100px]">{event.resource.slice(0, 10)}…</span>
          )}
        </div>
      </motion.button>
    </div>
  );
}

export function EventTimeline({ events, selectedId, onSelect, page, pageSize }: EventTimelineProps) {
  const start = (page - 1) * pageSize;
  const slice = events.slice(start, start + pageSize);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-[#1a1f27] py-16">
        <Activity className="h-8 w-8 text-[#a8adc1]/30" />
        <p className="mt-3 text-sm text-[#a8adc1]">No events match your filters</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-[#0f1419] px-4 py-4">
      <AnimatePresence initial={false}>
        {slice.map((event, idx) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, delay: idx * 0.03 }}
          >
            <TimelineItem
              event={event}
              isLast={idx === slice.length - 1}
              isSelected={event.id === selectedId}
              onSelect={() => onSelect(event)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
