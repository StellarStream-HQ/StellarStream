"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, ExternalLink, Clock, User, Hash, ChevronRight } from "lucide-react";
import type { AuditEvent } from "./event-timeline";

interface EventDetailsProps {
  event: AuditEvent | null;
  onClose: () => void;
}

function DiffLine({ type, content }: { type: "added" | "removed" | "unchanged"; content: string }) {
  const colors = {
    added: "bg-emerald-500/10 text-emerald-300 border-l-2 border-emerald-500",
    removed: "bg-rose-500/10 text-rose-300 border-l-2 border-rose-500",
    unchanged: "text-[#a8adc1]",
  };
  const prefix = { added: "+ ", removed: "- ", unchanged: "  " };
  return (
    <div className={`px-3 py-0.5 font-mono text-xs ${colors[type]}`}>
      {prefix[type]}{content}
    </div>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const utc = d.toUTCString().replace("GMT", "UTC");
  const local = d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return { utc, local };
}

export function EventDetails({ event, onClose }: EventDetailsProps) {
  if (!event) return null;
  const { utc, local } = formatDateTime(event.timestamp);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={{ duration: 0.2 }}
        className="rounded-2xl border border-[#7c3aed]/20 bg-[#1a1f27] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#7c3aed]">
              {event.actionType.replace(/_/g, " ")}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[#f5f3ff]">{event.title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#a8adc1] hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Close details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Timestamps */}
          <div className="rounded-xl border border-white/5 bg-[#0f1419] px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-[#a8adc1]">
              <Clock className="h-3.5 w-3.5 text-[#7c3aed]" />
              <span className="font-medium text-[#f5f3ff]">UTC:</span>
              <span>{utc}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#a8adc1]">
              <Clock className="h-3.5 w-3.5 text-[#00d4ff]" />
              <span className="font-medium text-[#f5f3ff]">Local:</span>
              <span>{local}</span>
            </div>
          </div>

          {/* Meta */}
          <div className="space-y-2.5">
            {event.user && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-3.5 w-3.5 shrink-0 text-[#a8adc1]" />
                <span className="text-[#a8adc1]">User</span>
                <ChevronRight className="h-3 w-3 text-[#a8adc1]/40" />
                <span className="font-mono text-xs text-[#f5f3ff] truncate">{event.user}</span>
              </div>
            )}
            {event.resource && (
              <div className="flex items-center gap-2 text-sm">
                <Hash className="h-3.5 w-3.5 shrink-0 text-[#a8adc1]" />
                <span className="text-[#a8adc1]">Resource</span>
                <ChevronRight className="h-3 w-3 text-[#a8adc1]/40" />
                <span className="font-mono text-xs text-[#f5f3ff] truncate">{event.resource}</span>
              </div>
            )}
            {event.txHash && (
              <div className="flex items-center gap-2 text-sm">
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#a8adc1]" />
                <span className="text-[#a8adc1]">Tx Hash</span>
                <ChevronRight className="h-3 w-3 text-[#a8adc1]/40" />
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#00d4ff] hover:underline truncate"
                >
                  {event.txHash.slice(0, 12)}…{event.txHash.slice(-8)}
                </a>
              </div>
            )}
          </div>

          {/* Before / After diff */}
          {(event.before || event.after) && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a8adc1]">
                Changes
              </p>
              <div className="rounded-xl border border-white/5 bg-[#0f1419] overflow-hidden">
                {event.before &&
                  Object.entries(event.before).map(([key, val]) => {
                    const afterVal = event.after?.[key];
                    if (afterVal !== undefined && afterVal !== val) {
                      return (
                        <div key={key}>
                          <DiffLine type="removed" content={`${key}: ${JSON.stringify(val)}`} />
                          <DiffLine type="added" content={`${key}: ${JSON.stringify(afterVal)}`} />
                        </div>
                      );
                    }
                    if (afterVal === undefined) {
                      return <DiffLine key={key} type="removed" content={`${key}: ${JSON.stringify(val)}`} />;
                    }
                    return <DiffLine key={key} type="unchanged" content={`${key}: ${JSON.stringify(val)}`} />;
                  })}
                {event.after &&
                  Object.entries(event.after)
                    .filter(([key]) => !event.before?.[key])
                    .map(([key, val]) => (
                      <DiffLine key={key} type="added" content={`${key}: ${JSON.stringify(val)}`} />
                    ))}
              </div>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="text-xs leading-relaxed text-[#a8adc1]">{event.description}</p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
