"use client";

import { useState, Suspense } from "react";
import TransactionHistory from "@/components/dashboard/TransactionHistory";
import { SanctionsFlagBanner, type SanctionsFlag } from "@/components/compliance/SanctionsFlagBanner";
import RoadmapTeaser from "@/components/dashboard/RoadmapTeaser";

// ─── Mock Data ────────────────────────────────────────────────────────────────
const MOCK_FLAGS: SanctionsFlag[] = [
  {
    recipientAddress: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
    riskReason: "Address on OFAC SDN list — matched via Chainalysis screening.",
    reportUrl: "https://sanctionssearch.ofac.treas.gov/",
  },
];

interface Stream {
  id: string;
  name: string;
  token: string;
  status: "active" | "paused" | "ended";
  startTime: Date;
  endTime: Date;
  totalAmount: number;
  streamed: number;
  yieldEarned: number;
  sender: string;
  recipient: string;
  ratePerSecond: number;
}

const STREAM: Stream = {
  id: "0x4a3b…f91c",
  name: "DAO Treasury → Dev Fund",
  token: "USDC",
  status: "active",
startTime: new Date("2026-06-06T10:01:00"),
endTime: new Date("2026-08-05T10:01:00"),
  totalAmount: 120_000,
  streamed: 37_500,
  yieldEarned: 842.17,
  sender: "0xDAO1…3a2f",
  recipient: "0xDev9…7bc1",
  ratePerSecond: 0.03858,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

// ─── Live Counter ──────────────────────────────────────────────────────────────
function LiveCounter({ base }: { base: number; rate: number }) {
  return <span className="tabular-nums">{fmt(base)}</span>;
}

// ─── Radial Progress ──────────────────────────────────────────────────────────
function RadialProgress({ pct }: { pct: number }) {
  const r = 40, cx = 50, cy = 50, sw = 6;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={100} height={100} className="mx-auto">
      <defs>
        <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={sw} />
      <circle
        cx={cx} cy={cy} r={r} fill="none"
        stroke="url(#arcGrad)" strokeWidth={sw}
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 12px rgba(52,211,153,0.5))" }}
      />
      <text x={cx} y={cy - 2} textAnchor="middle" fill="white" fontSize={16} fontWeight={700}>
        {Math.round(pct)}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={8} letterSpacing="0.1em">
        PROGRESS
      </text>
    </svg>
  );
}

// ─── Mini Chart ───────────────────────────────────────────────────────────────
function MiniChart({ stream }: { stream: Stream }) {
  const W = 400, H = 160;
  const PAD = { t: 12, r: 12, b: 30, l: 40 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const t0 = stream.startTime.getTime();
const t1 = stream.startTime.getTime() + 1000 * 60 * 60 * 24 * 12;
  const STEPS = 60;

  const points = Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / STEPS;
    const elapsed = (t - t0) / 1000;
    const amount = elapsed * stream.ratePerSecond;
    return { t, amount };
  });

  const maxAmt = (stream.ratePerSecond * ((t1 - t0) / 1000)) * 1.1;
  const xS = (t: number) => ((t - t0) / (t1 - t0)) * iW;
  const yS = (v: number) => iH - (v / maxAmt) * iH;

  const streamD = points.map((p, i) => `${i ? "L" : "M"}${xS(p.t).toFixed(1)},${yS(p.amount).toFixed(1)}`).join(" ");
  const areaD = streamD + ` L${iW},${iH} L0,${iH}Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <defs>
        <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform={`translate(${PAD.l},${PAD.t})`}>
        <path d={areaD} fill="url(#miniGrad)" />
        <path d={streamD} fill="none" stroke="#34d399" strokeWidth="2" style={{ filter: "drop-shadow(0 0 4px rgba(52,211,153,0.4))" }} />
      </g>
    </svg>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────
export default function StreamDetailPage() {
const streamed = STREAM.streamed;
const [flags, setFlags] = useState<SanctionsFlag[]>(MOCK_FLAGS);

  const pct = (streamed / STREAM.totalAmount) * 100;
  const remaining = STREAM.totalAmount - streamed;
const stableNow = STREAM.startTime.getTime() + 1000 * 60 * 60 * 24 * 12;
const daysLeft = Math.ceil((STREAM.endTime.getTime() - stableNow) / 86_400_000);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Background grid */}
      <div className="fixed inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Glow effects */}
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed -bottom-40 -right-40 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* Alert Banner */}
        <SanctionsFlagBanner
          flags={flags}
          onBypass={(f) => console.warn("Compliance bypass recorded for", f.recipientAddress)}
          onDismiss={(f) => setFlags((prev) => prev.filter((x) => x.recipientAddress !== f.recipientAddress))}
        />

        {/* Main Container */}
        <div className="px-4 md:px-8 py-8 max-w-7xl mx-auto space-y-8">

          {/* ════ HEADER SECTION ════ */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-mono tracking-widest text-cyan-400/60 uppercase">Stream Dashboard</span>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute animate-ping inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Active
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white">
              {STREAM.name}
            </h1>
            <p className="text-sm text-white/50">{STREAM.id} • {STREAM.token}</p>
          </div>

          {/* ════ STATS OVERVIEW (4-Column Grid) ════ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Card: Streamed */}
            <div className="group rounded-2xl border border-white/8 bg-linear-to-br from-white/6 to-white/3 p-6 backdrop-blur-xl hover:border-cyan-500/30 hover:from-cyan-500/5 transition-all">
              <p className="text-xs font-mono tracking-widest text-cyan-400/50 uppercase mb-3">Total Streamed</p>
              <p className="text-3xl font-black text-cyan-400 mb-1 tabular-nums">
                <LiveCounter base={STREAM.streamed} rate={STREAM.ratePerSecond} />
              </p>
              <p className="text-xs text-white/40">{STREAM.token}</p>
            </div>

            {/* Card: Remaining */}
            <div className="group rounded-2xl border border-white/8 bg-linear-to-br from-white/6 to-white/3 p-6 backdrop-blur-xl hover:border-emerald-500/30 hover:from-emerald-500/5 transition-all">
              <p className="text-xs font-mono tracking-widest text-emerald-400/50 uppercase mb-3">Remaining</p>
              <p className="text-3xl font-black text-emerald-400 mb-1 tabular-nums">{fmt(remaining, 0)}</p>
              <p className="text-xs text-white/40">{STREAM.token}</p>
            </div>

            {/* Card: Time Left */}
            <div className="group rounded-2xl border border-white/8 bg-linear-to-br from-white/6 to-white/3 p-6 backdrop-blur-xl hover:border-violet-500/30 hover:from-violet-500/5 transition-all">
              <p className="text-xs font-mono tracking-widest text-violet-400/50 uppercase mb-3">Time Left</p>
              <p className="text-3xl font-black text-violet-400 mb-1">{daysLeft}</p>
              <p className="text-xs text-white/40">days</p>
            </div>

            {/* Card: Yield */}
            <div className="group rounded-2xl border border-white/8 bg-linear-to-br from-white/6 to-white/3 p-6 backdrop-blur-xl hover:border-amber-500/30 hover:from-amber-500/5 transition-all">
              <p className="text-xs font-mono tracking-widest text-amber-400/50 uppercase mb-3">Yield Earned</p>
              <p className="text-3xl font-black text-amber-400 mb-1 tabular-nums">{fmt(STREAM.yieldEarned)}</p>
              <p className="text-xs text-white/40">8.2% APY</p>
            </div>
          </div>

          {/* ════ MAIN CONTENT (2-Column Layout) ════ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* LEFT: Main Chart Section (2/3 width) */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Chart Card */}
              <div className="rounded-3xl border border-white/8 bg-white/4 backdrop-blur-xl p-8">
                <div className="mb-6 pb-6 border-b border-white/8">
                  <p className="text-xs font-mono tracking-widest text-white/40 uppercase mb-2">Stream Progress</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-5xl font-black text-white mb-1">{pct.toFixed(1)}%</p>
                      <p className="text-xs text-white/40">{fmt(streamed)} of {fmt(STREAM.totalAmount)} USDC streamed</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono text-white/60 mb-2">Rate: {STREAM.ratePerSecond.toFixed(5)} USDC/sec</p>
                      <p className="text-sm font-mono text-white/60">{fmt(STREAM.ratePerSecond * 86400)} USDC/day</p>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-6">
                  <div className="h-3 w-full rounded-full bg-white/6 overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        background: "linear-gradient(90deg, #34d399 0%, #a78bfa 100%)",
                        boxShadow: "0 0 20px rgba(52,211,153,0.5)",
                      }}
                    />
                  </div>
                </div>

                {/* Mini chart */}
                <div className="h-48 w-full">
                  <MiniChart stream={STREAM} />
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Timeline Card */}
                <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
                  <p className="text-xs font-mono tracking-widest text-white/40 uppercase mb-5">Timeline</p>
                  <div className="space-y-5">
                    {[
                      { label: "Start", date: STREAM.startTime, color: "#34d399" },
                      { label: "End", date: STREAM.endTime, color: "#a78bfa" },
                    ].map((item) => (
                      <div key={item.label} className="flex gap-4">
                        <div className="pt-1 shrink-0">
                          <div className="h-3 w-3 rounded-full" style={{ background: item.color }} />
                        </div>
                        <div>
                          <p className="text-xs text-white/40 mb-1">{item.label}</p>
                          <p className="text-sm font-semibold text-white">{fmtDate(item.date)}</p>
                          <p className="text-xs text-white/50 mt-0.5">{fmtTime(item.date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Participants Card */}
                <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6">
                  <p className="text-xs font-mono tracking-widest text-white/40 uppercase mb-5">Participants</p>
                  <div className="space-y-4">
                    {[
                      { label: "Sender", addr: STREAM.sender, icon: "↑" },
                      { label: "Recipient", addr: STREAM.recipient, icon: "↓" },
                    ].map((p) => (
                      <div key={p.label} className="flex items-start gap-3">
                        <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-white/4 flex items-center justify-center text-xs text-white/60">
                          {p.icon}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-white/40 mb-1">{p.label}</p>
                          <p className="text-sm font-mono text-white/80 truncate">{p.addr}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Sidebar (1/3 width) */}
            <div className="space-y-4">
              
              {/* Progress Ring Card */}
              <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-8 flex flex-col items-center">
                <RadialProgress pct={pct} />
                <div className="mt-6 text-center">
                  <p className="text-xs text-white/40 mb-2">Completion</p>
                  <p className="text-4xl font-black text-white mb-2">{pct.toFixed(1)}%</p>
                  <p className="text-xs text-white/50">{daysLeft} days remaining</p>
                </div>
              </div>

              {/* Key Stats */}
              <div className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur-xl p-6 space-y-4">
                <p className="text-xs font-mono tracking-widest text-white/40 uppercase">Summary</p>
                
                {[
                  { label: "Total Amount", value: fmt(STREAM.totalAmount), color: "text-white/80" },
                  { label: "Streamed", value: fmt(streamed), color: "text-cyan-400" },
                  { label: "Remaining", value: fmt(remaining), color: "text-emerald-400" },
                  { label: "Yield Earned", value: fmt(STREAM.yieldEarned), color: "text-amber-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-2 border-b border-white/6 last:border-b-0">
                    <span className="text-xs text-white/50">{item.label}</span>
                    <span className={`text-sm font-semibold font-mono ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button className="w-full px-6 py-3 rounded-xl border border-white/10 bg-white/4 hover:bg-white/6 text-white/70 hover:text-white font-semibold text-sm transition-all">
                  ⏸ Pause Stream
                </button>
                <button className="w-full px-6 py-3 rounded-xl bg-linear-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-black font-bold text-sm transition-all shadow-lg hover:shadow-emerald-500/50">
                  → Withdraw
                </button>
              </div>
            </div>
          </div>

          {/* ════ TRANSACTION HISTORY ════ */}
          <Suspense fallback={
            <div className="rounded-3xl border border-white/8 bg-white/4 backdrop-blur-xl p-12 text-center text-white/40">
              Loading transactions...
            </div>
          }>
            <TransactionHistory />
          </Suspense>

          {/* ════ ROADMAP TEASER ════ */}
          <RoadmapTeaser />
        </div>
      </div>
    </div>
  );
}
