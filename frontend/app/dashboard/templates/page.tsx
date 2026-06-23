"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutTemplate, Plus, Copy, Trash2, ArrowRight, X, CheckCircle2, Loader2 } from "lucide-react";
import { useTemplateLibrary, type StreamTemplate } from "@/lib/use-template-library";
import { useWallet } from "@/lib/wallet-context";
import { useRouter } from "next/navigation";

const ASSETS = ["USDC","USDT","DAI","ETH","WBTC"];
const DURATIONS = ["1 Hour","1 Day","1 Week","1 Month","3 Months","1 Year"];
const RATE_TYPES = ["per-second","per-minute","per-hour","per-day"] as const;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});

function TemplateCard({ t, onLoad, onDuplicate, onDelete }: {
  t: StreamTemplate;
  onLoad: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <motion.div layout initial={{ opacity:0, scale:0.96 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.94 }}
      className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-semibold text-white">{t.name}</p>
          <p className="font-body text-xs text-white/40 mt-0.5">Created {fmtDate(t.createdAt)}</p>
        </div>
        <span className="rounded-full border border-[#00f5ff]/20 bg-[#00f5ff]/10 px-2.5 py-0.5 font-ticker text-xs text-[#00f5ff]">{t.asset}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Recipient", t.recipientAddress ? `${t.recipientAddress.slice(0,8)}…` : "—"],
          ["Amount", t.totalAmount ? `${t.totalAmount} ${t.asset}` : "—"],
          ["Duration", t.durationPreset],
          ["Split", t.splitEnabled ? `${t.splitPercent}%` : "Off"],
          ["Times Used", `${t.usageCount ?? 0}`],
        ].map(([k,v]) => (
          <div key={k} className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
            <p className="font-body text-[10px] uppercase tracking-wider text-white/30">{k}</p>
            <p className="font-ticker text-white/70 mt-0.5 truncate">{v}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-auto">
        <button onClick={onLoad} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#00f5ff]/25 bg-[#00f5ff]/10 py-2 text-xs font-semibold text-[#00f5ff] transition hover:bg-[#00f5ff]/20">
          <ArrowRight className="h-3.5 w-3.5" /> Load
        </button>
        <button onClick={onDuplicate} className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50 transition hover:text-white hover:bg-white/10">
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { if (confirmDelete) { onDelete(); } else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); } }}
          className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition ${confirmDelete ? "border-red-500/40 bg-red-500/15 text-red-400" : "border-white/10 bg-white/5 text-white/50 hover:text-red-400 hover:border-red-500/30"}`}>
          {confirmDelete ? <><Trash2 className="h-3.5 w-3.5" /> Confirm</> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </motion.div>
  );
}

export default function TemplatesPage() {
  const { address: walletAddress } = useWallet();
  const { templates, loading, saveTemplate, deleteTemplate, duplicateTemplate } = useTemplateLibrary(walletAddress ?? undefined);
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name:"", asset:"USDC", recipientAddress:"", splitEnabled:false, splitAddress:"", splitPercent:10, totalAmount:"", rateType:"per-hour" as typeof RATE_TYPES[number], durationPreset:"1 Month" });

  const handleLoad = (t: StreamTemplate) => {
    sessionStorage.setItem("stellarstream_template_load", JSON.stringify(t));
    router.push("/dashboard/create-stream");
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await saveTemplate(form);
    setShowForm(false);
    setForm({ name:"", asset:"USDC", recipientAddress:"", splitEnabled:false, splitAddress:"", splitPercent:10, totalAmount:"", rateType:"per-hour", durationPreset:"1 Month" });
  };

  return (
    <div className="space-y-6 p-6 pb-24 md:pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#8a00ff]/30 bg-[#8a00ff]/10">
            <LayoutTemplate className="h-6 w-6 text-[#8a00ff]" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-white">Template Library</h1>
            <p className="font-body mt-1 text-sm text-white/50">Save and reuse split configurations for payroll or vendor payments.</p>
          </div>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-xl border border-[#8a00ff]/30 bg-[#8a00ff]/10 px-4 py-2.5 text-sm font-semibold text-[#c084fc] transition hover:bg-[#8a00ff]/20">
          {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Add Template</>}
        </button>
      </div>

      {/* Inline add form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
            className="glass-card p-5 space-y-4">
            <p className="font-body text-xs font-medium uppercase tracking-widest text-white/30">New Template</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["Template Name","name","text"],["Recipient Address","recipientAddress","text"],["Total Amount","totalAmount","text"]].map(([label,key,type]) => (
                <div key={key}>
                  <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">{label}</p>
                  <input type={type} value={(form as any)[key]} onChange={(e) => setForm((p) => ({...p,[key]:e.target.value}))}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-body text-sm text-white outline-none focus:border-[#8a00ff]/40 placeholder:text-white/20"
                    placeholder={label} />
                </div>
              ))}
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">Asset</p>
                <div className="flex gap-1.5 flex-wrap">
                  {ASSETS.map((a) => (
                    <button key={a} onClick={() => setForm((p) => ({...p,asset:a}))}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${form.asset===a ? "border-[#00f5ff]/40 bg-[#00f5ff]/10 text-[#00f5ff]" : "border-white/10 bg-white/5 text-white/40 hover:text-white"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-body text-[10px] uppercase tracking-wider text-white/30 mb-1">Duration</p>
                <div className="flex gap-1.5 flex-wrap">
                  {DURATIONS.map((d) => (
                    <button key={d} onClick={() => setForm((p) => ({...p,durationPreset:d}))}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition ${form.durationPreset===d ? "border-[#8a00ff]/40 bg-[#8a00ff]/10 text-[#c084fc]" : "border-white/10 bg-white/5 text-white/40 hover:text-white"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={handleSave} disabled={!form.name.trim()}
              className="flex items-center gap-2 rounded-xl bg-[#8a00ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7000dd] disabled:opacity-40">
              <CheckCircle2 className="h-4 w-4" /> Save Template
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading state */}
      {loading && (
        <div className="glass-card flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/20" />
          <p className="font-body text-white/40">Loading templates…</p>
        </div>
      )}

      {/* Gallery */}
      {!loading && templates.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-3 py-16 text-center">
          <LayoutTemplate className="h-10 w-10 text-white/15" />
          <p className="font-body text-white/40">No templates yet. Create one to get started.</p>
        </div>
      ) : !loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {templates.map((t) => (
              <TemplateCard key={t.id} t={t}
                onLoad={() => handleLoad(t)}
                onDuplicate={() => duplicateTemplate(t.id)}
                onDelete={() => deleteTemplate(t.id)} />
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
