"use client";

// components/dashboard/DisbursementHistoryCard.tsx
// Renders a single past successful disbursement with a "Duplicate Split" button.

import { useState } from "react";
import type { DraftProposal } from "@/app/api/v3/proposals/pending/route";
import {
  useDuplicateSplit,
  type BalanceCheckStatus,
} from "@/lib/hooks/use-duplicate-split";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortenAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: true,
  }).format(amount);
}

const BALANCE_LABEL: Record<
  BalanceCheckStatus,
  { text: string; color: string } | null
> = {
  idle: null,
  checking: { text: "Checking balance…", color: "#f59e0b" },
  ok: { text: "Balance OK — draft ready", color: "#34d399" },
  insufficient: { text: "Insufficient balance", color: "#f87171" },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface DisbursementHistoryCardProps {
  proposal: DraftProposal;
  /** Optional wallet balance in stroops for the balance check. */
  walletBalance?: bigint;
  /** Called after a successful clone so the parent can navigate/scroll. */
  onCloned?: (newDraftId: string) => void;
}

export function DisbursementHistoryCard({
  proposal,
  walletBalance,
  onCloned,
}: DisbursementHistoryCardProps) {
  const { duplicate, clonedId, balanceStatus } =
    useDuplicateSplit(walletBalance);
  const [justCloned, setJustCloned] = useState(false);

  const isThisCard = clonedId !== null;
  const balanceMeta = isThisCard ? BALANCE_LABEL[balanceStatus] : null;

  function handleDuplicate() {
    const newId = duplicate(proposal);
    setJustCloned(true);
    onCloned?.(newId);
  }

  return (
    <div
      className="rounded-2xl border transition-all duration-300"
      style={{
        borderColor: justCloned
          ? "rgba(52,211,153,0.3)"
          : "rgba(255,255,255,0.07)",
        background: justCloned
          ? "rgba(52,211,153,0.03)"
          : "rgba(255,255,255,0.025)",
        padding: "16px 20px",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-body text-sm font-bold text-white/80">
            {proposal.title}
          </p>

          <p className="mt-0.5 font-body text-[10px] text-white/30">
            {fmtDate(proposal.createdAt)} · {proposal.recipients.length}{" "}
            recipient
            {proposal.recipients.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Total amount badge */}
        <span
          className="flex-shrink-0 rounded-lg px-2.5 py-1 font-mono text-xs font-bold"
          style={{
            background: "rgba(0,245,255,0.08)",
            border: "1px solid rgba(0,245,255,0.2)",
            color: "#00f5ff",
          }}
        >
          {fmtAmount(proposal.totalAmount)} {proposal.token}
        </span>
      </div>

      {/* Recipient preview (up to 3) */}
      <div className="mb-4 space-y-1">
        {proposal.recipients.slice(0, 3).map((recipient) => (
          <div
            key={recipient.address}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate font-mono text-[10px] text-white/40">
              {shortenAddr(recipient.address)}
            </span>

            <span className="flex-shrink-0 font-mono text-[10px] text-white/50">
              {fmtAmount(recipient.amount)} {recipient.token}
            </span>
          </div>
        ))}

        {proposal.recipients.length > 3 && (
          <p className="font-body text-[10px] text-white/25">
            +{proposal.recipients.length - 3} more
          </p>
        )}
      </div>

      {/* Footer: balance status + button */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {balanceMeta && (
            <p
              className="font-body text-[10px] transition-colors"
              style={{ color: balanceMeta.color }}
            >
              {balanceMeta.text}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleDuplicate}
          disabled={balanceStatus === "checking"}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-body text-xs font-bold transition-all duration-200"
          style={{
            background: justCloned
              ? "rgba(52,211,153,0.12)"
              : "rgba(0,245,255,0.08)",
            border: `1px solid ${
              justCloned
                ? "rgba(52,211,153,0.3)"
                : "rgba(0,245,255,0.25)"
            }`,
            color: justCloned ? "#34d399" : "#00f5ff",
            opacity: balanceStatus === "checking" ? 0.6 : 1,
            cursor: balanceStatus === "checking" ? "not-allowed" : "pointer",
          }}
          title="Clone this disbursement into a new draft for the current month"
        >
          <svg
            className="h-3.5 w-3.5 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>

          {justCloned ? "Cloned" : "Duplicate Split"}
        </button>
      </div>
    </div>
  );
}