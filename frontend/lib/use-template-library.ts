"use client";
import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StreamTemplate {
  id: string;
  name: string;
  asset: string;
  recipientAddress: string;
  splitEnabled: boolean;
  splitAddress: string;
  splitPercent: number;
  totalAmount: string;
  rateType: "per-second" | "per-minute" | "per-hour" | "per-day";
  durationPreset: string;
  usageCount?: number;
  createdAt: string;
}

// ── localStorage helpers ───────────────────────────────────────────────────────

const KEY = "stellarstream_templates";

function loadLocal(): StreamTemplate[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

function saveLocal(templates: StreamTemplate[]) {
  localStorage.setItem(KEY, JSON.stringify(templates));
}

// ── Backend API helpers ────────────────────────────────────────────────────────

async function fetchBackend(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`/api/v3/split/templates${path}`, init);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * useTemplateLibrary
 *
 * Backend-first template management with localStorage fallback.
 * @param walletAddress - The current user's Stellar address (required for backend persistence).
 *                        If not provided, falls back to localStorage-only mode.
 */
export function useTemplateLibrary(walletAddress?: string) {
  const [templates, setTemplates] = useState<StreamTemplate[]>([]);
  const [backendOnline, setBackendOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const initialised = useRef(false);

  // Load on mount: try backend first, fall back to localStorage
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    async function load() {
      setLoading(true);

      if (!walletAddress) {
        // No wallet connected — use localStorage only
        setBackendOnline(false);
        setTemplates(loadLocal());
        setLoading(false);
        return;
      }

      const data = await fetchBackend(`?createdBy=${encodeURIComponent(walletAddress)}`);
      if (data && Array.isArray(data)) {
        // Backend returned templates; map snake_case → camelCase
        const mapped: StreamTemplate[] = data.map((t: any) => ({
          id: t.id,
          name: t.name,
          asset: t.asset,
          recipientAddress: t.recipientAddress ?? t.recipient_address ?? "",
          splitEnabled: t.splitEnabled ?? t.split_enabled ?? false,
          splitAddress: t.splitAddress ?? t.split_address ?? "",
          splitPercent: t.splitPercent ?? t.split_percent ?? 0,
          totalAmount: t.totalAmount ?? t.total_amount ?? "",
          rateType: t.rateType ?? t.rate_type ?? "per-hour",
          durationPreset: t.durationPreset ?? t.duration_preset ?? "",
          usageCount: t.usageCount ?? t.usage_count ?? 0,
          createdAt: t.createdAt ?? t.created_at ?? "",
        }));
        setTemplates(mapped);
        setBackendOnline(true);
      } else {
        // Backend offline — fall back to localStorage
        setBackendOnline(false);
        setTemplates(loadLocal());
      }
      setLoading(false);
    }

    load();
  }, [walletAddress]);

  const saveTemplate = useCallback(async (data: Omit<StreamTemplate, "id" | "createdAt" | "usageCount">) => {
    if (!walletAddress) {
      // localStorage-only mode
      const t: StreamTemplate = { ...data, id: crypto.randomUUID(), usageCount: 0, createdAt: new Date().toISOString() };
      setTemplates((prev) => { const next = [t, ...prev]; saveLocal(next); return next; });
      return t;
    }

    // Try backend first
    const created = await fetchBackend("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, createdBy: walletAddress }),
    });

    if (created) {
      const mapped: StreamTemplate = {
        id: created.id,
        name: created.name,
        asset: created.asset,
        recipientAddress: created.recipientAddress ?? created.recipient_address ?? "",
        splitEnabled: created.splitEnabled ?? created.split_enabled ?? false,
        splitAddress: created.splitAddress ?? created.split_address ?? "",
        splitPercent: created.splitPercent ?? created.split_percent ?? 0,
        totalAmount: created.totalAmount ?? created.total_amount ?? "",
        rateType: created.rateType ?? created.rate_type ?? "per-hour",
        durationPreset: created.durationPreset ?? created.duration_preset ?? "",
        usageCount: created.usageCount ?? 0,
        createdAt: created.createdAt ?? created.created_at ?? "",
      };
      setTemplates((prev) => [mapped, ...prev]);
      setBackendOnline(true);
      return mapped;
    }

    // Fallback to localStorage
    setBackendOnline(false);
    const t: StreamTemplate = { ...data, id: crypto.randomUUID(), usageCount: 0, createdAt: new Date().toISOString() };
    setTemplates((prev) => { const next = [t, ...prev]; saveLocal(next); return next; });
    return t;
  }, [walletAddress]);

  const deleteTemplate = useCallback(async (id: string) => {
    if (!walletAddress) {
      setTemplates((prev) => { const next = prev.filter((t) => t.id !== id); saveLocal(next); return next; });
      return;
    }

    // Try backend first
    const deleted = await fetchBackend(`?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (deleted) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setBackendOnline(true);
      return;
    }

    // Fallback to localStorage
    setBackendOnline(false);
    setTemplates((prev) => { const next = prev.filter((t) => t.id !== id); saveLocal(next); return next; });
  }, [walletAddress]);

  const duplicateTemplate = useCallback(async (id: string) => {
    const src = templates.find((t) => t.id === id) ?? loadLocal().find((t) => t.id === id);
    if (!src) return;

    const copy = { ...src, name: `${src.name} (copy)` };

    if (!walletAddress) {
      setTemplates((prev) => {
        const dup: StreamTemplate = { ...src, id: crypto.randomUUID(), name: `${src.name} (copy)`, createdAt: new Date().toISOString() };
        const next = [dup, ...prev];
        saveLocal(next);
        return next;
      });
      return;
    }

    // Try backend first
    const created = await fetchBackend("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: copy.name,
        asset: copy.asset,
        recipientAddress: copy.recipientAddress,
        splitEnabled: copy.splitEnabled,
        splitAddress: copy.splitAddress,
        splitPercent: copy.splitPercent,
        totalAmount: copy.totalAmount,
        rateType: copy.rateType,
        durationPreset: copy.durationPreset,
        createdBy: walletAddress,
      }),
    });

    if (created) {
      const mapped: StreamTemplate = {
        id: created.id,
        name: created.name,
        asset: created.asset,
        recipientAddress: created.recipientAddress ?? created.recipient_address ?? "",
        splitEnabled: created.splitEnabled ?? created.split_enabled ?? false,
        splitAddress: created.splitAddress ?? created.split_address ?? "",
        splitPercent: created.splitPercent ?? created.split_percent ?? 0,
        totalAmount: created.totalAmount ?? created.total_amount ?? "",
        rateType: created.rateType ?? created.rate_type ?? "per-hour",
        durationPreset: created.durationPreset ?? created.duration_preset ?? "",
        usageCount: created.usageCount ?? 0,
        createdAt: created.createdAt ?? created.created_at ?? "",
      };
      setTemplates((prev) => [mapped, ...prev]);
      setBackendOnline(true);
      return;
    }

    // Fallback to localStorage
    setBackendOnline(false);
    setTemplates((prev) => {
      const dup: StreamTemplate = { ...src, id: crypto.randomUUID(), name: `${src.name} (copy)`, createdAt: new Date().toISOString() };
      const next = [dup, ...prev];
      saveLocal(next);
      return next;
    });
  }, [templates, walletAddress]);

  const loadTemplate = useCallback((id: string): StreamTemplate | undefined => {
    return templates.find((t) => t.id === id) ?? loadLocal().find((t) => t.id === id);
  }, [templates]);

  return { templates, loading, backendOnline, saveTemplate, deleteTemplate, duplicateTemplate, loadTemplate };
}
