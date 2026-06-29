"use client";

import { useState, useMemo } from "react";
import { isValidStellarRecipientAddress } from "@/lib/stellar-address";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { ParseError } from "@/lib/bulk-parser";
import type { RecipientRow } from "@/components/recipient-grid";
import type { MemoType } from "@/lib/bulk-splitter/types";

// ─── Validation ───────────────────────────────────────────────────────────────

function validateMemo(type: MemoType, value: string): string | undefined {
  if (type === "none" || !value) return undefined;
  if (type === "text") {
    // Stellar text memo: max 28 bytes
    if (new TextEncoder().encode(value).length > 28)
      return "Text memo must be ≤ 28 bytes";
    return undefined;
  }
  if (type === "id") {
    // Stellar ID memo: unsigned 64-bit integer
    if (!/^\\d+$/.test(value)) return "ID memo must be a positive integer";
    if (BigInt(value) > 18446744073709551615n) return "ID memo exceeds u64 max";
    return undefined;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  errors: ParseError[];
  onResolve: (resolved: RecipientRow[], remainingErrors: ParseError[]) => void;
  onDiscardAll: () => void;
}

export function ConflictResolver({ errors, onResolve, onDiscardAll }: Props) {
  // Local state for editing rows
  const [rows, setRows] = useState<ParseError[]>(errors);

  const updateRow = (id: string, patch: Partial<ParseError["rawData"]>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          rawData: { ...r.rawData, ...patch },
        };
      })
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Compute validation state for each row
  const validatedRows = useMemo(() => {
    return rows.map((row) => {
      const { address, amount, memoType, memo } = row.rawData;
      const reasons: string[] = [];

      if (!isValidStellarRecipientAddress(address)) {
        reasons.push("Invalid address");
      }
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0 || !/^\\d+(\\.\\d+)?$/.test(amount.trim())) {
        reasons.push("Invalid amount (must be positive)");
      }
      
      const memoTypeCast = (["none", "text", "id"].includes(memoType) ? memoType : "none") as MemoType;
      const memoErr = validateMemo(memoTypeCast, memo);
      if (memoErr) {
        reasons.push(memoErr);
      }

      return {
        ...row,
        isValid: reasons.length === 0,
        currentErrors: reasons,
        parsedMemoType: memoTypeCast,
      };
    });
  }, [rows]);

  const validCount = validatedRows.filter((r) => r.isValid).length;

  const handleApproveValid = () => {
    const validRowsToExport: RecipientRow[] = [];
    const remainingErrors: ParseError[] = [];

    validatedRows.forEach((r) => {
      if (r.isValid) {
        validRowsToExport.push({
          id: r.id,
          address: r.rawData.address,
          amount: r.rawData.amount,
          memoType: r.parsedMemoType,
          memo: r.rawData.memo,
        });
      } else {
        remainingErrors.push({
          id: r.id,
          row: r.row,
          reason: r.currentErrors.length > 0 ? `Row ${r.row}: ${r.currentErrors.join(" and ")}` : r.reason,
          rawData: r.rawData,
        });
      }
    });

    onResolve(validRowsToExport, remainingErrors);
  };

  return (
    <div className="space-y-4 rounded-xl border border-red-400/20 bg-black/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <h3 className="font-heading text-lg text-red-200">
            {rows.length} Conflict{rows.length !== 1 ? "s" : ""} Found
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscardAll}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors"
          >
            Discard All
          </button>
          <button
            onClick={handleApproveValid}
            disabled={validCount === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-400/20 disabled:opacity-30 disabled:hover:bg-emerald-400/10 transition-colors"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve {validCount} fixed row{validCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {validatedRows.map((row) => (
          <div
            key={row.id}
            className={`rounded-lg border p-3 transition-colors ${
              row.isValid
                ? "border-emerald-400/30 bg-emerald-400/[0.02]"
                : "border-red-400/20 bg-red-400/[0.02]"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-white/40 tracking-widest uppercase flex items-center gap-2">
                Row {row.row === 0 ? "General Error" : row.row}
                {!row.isValid && (
                  <span className="text-[10px] text-red-400/80 bg-red-400/10 px-2 py-0.5 rounded-full capitalize">
                    {row.currentErrors.join(", ") || row.reason}
                  </span>
                )}
              </span>
              <button
                onClick={() => removeRow(row.id)}
                className="text-white/20 hover:text-red-400 transition-colors"
                title="Discard this row"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-[1fr_100px] gap-3">
              <div className="space-y-1">
                <input
                  value={row.rawData.address}
                  onChange={(e) => updateRow(row.id, { address: e.target.value })}
                  placeholder="G...Address"
                  className="w-full rounded-md border border-white/[0.08] bg-black/40 px-3 py-1.5 text-xs text-white/80 focus:border-cyan-400/50 focus:outline-none font-mono"
                />
              </div>
              <div className="space-y-1">
                <input
                  value={row.rawData.amount}
                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                  placeholder="Amount"
                  type="number"
                  min="0"
                  className="w-full rounded-md border border-white/[0.08] bg-black/40 px-3 py-1.5 text-xs text-white/80 focus:border-cyan-400/50 focus:outline-none"
                />
              </div>
            </div>
            {row.isValid && (
              <div className="mt-2 flex items-center text-[10px] text-emerald-400/80">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Row fixed and ready to approve
              </div>
            )}
          </div>
        ))}

        {rows.length === 0 && (
          <div className="text-center py-6 text-sm text-white/40">
            No remaining conflicts to resolve.
          </div>
        )}
      </div>
    </div>
  );
}
