import Papa from "papaparse";
import { isValidStellarRecipientAddress } from "@/lib/stellar-address";
import type { MemoType } from "@/lib/bulk-splitter/types";
import type { RecipientRow } from "@/components/recipient-grid";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParseError {
  id: string;
  row: number;
  reason: string;
  rawData: {
    address: string;
    amount: string;
    memoType: string;
    memo: string;
  };
}

export interface BulkParseResult {
  valid: RecipientRow[];
  errors: ParseError[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
const nextId = () => `bulk-${++_id}`;

/** Resolve address/amount column names case-insensitively, including aliases */
function resolveHeaders(headers: string[]): { addrIdx: number; amtIdx: number } {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const addrIdx = lower.findIndex((h) => h === "address" || h === "public key" || h === "public_key");
  const amtIdx = lower.findIndex((h) => h === "amount");
  return { addrIdx, amtIdx };
}

function validateRow(
  rowNum: number,
  rawData: { address: string; amount: string; memoType: string; memo: string },
  errors: ParseError[],
): boolean {
  const { address, amount } = rawData;
  const reasons: string[] = [];
  
  if (!isValidStellarRecipientAddress(address)) {
    reasons.push(`Invalid Stellar address "${address}"`);
  }
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0 || !/^\d+(\.\d+)?$/.test(amount.trim())) {
    reasons.push(`Invalid amount "${amount}"`);
  }
  
  if (reasons.length > 0) {
    errors.push({
      id: nextId(),
      row: rowNum,
      reason: `Row ${rowNum}: ${reasons.join(" and ")}`,
      rawData
    });
    return false;
  }
  return true;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

export function parseCSV(raw: string): BulkParseResult {
  const valid: RecipientRow[] = [];
  const errors: ParseError[] = [];

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(raw.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parseErrors.length) {
    errors.push({ id: nextId(), row: 0, reason: `CSV parse error: ${parseErrors[0].message}`, rawData: { address: "", amount: "", memoType: "none", memo: "" } });
    return { valid, errors };
  }

  if (!data.length) return { valid, errors };

  const { addrIdx, amtIdx } = resolveHeaders(Object.keys(data[0]));

  if (addrIdx === -1 || amtIdx === -1) {
    errors.push({ id: nextId(), row: 0, reason: 'Missing required columns: "Address" (or "Public Key") and "Amount"', rawData: { address: "", amount: "", memoType: "none", memo: "" } });
    return { valid, errors };
  }

  const headers = Object.keys(data[0]);
  const addrKey = headers[addrIdx];
  const amtKey = headers[amtIdx];
  const memoTypeKey = headers.find((h) => h.toLowerCase() === "memo_type");
  const memoKey = headers.find((h) => h.toLowerCase() === "memo");

  data.forEach((row, i) => {
    const rowNum = i + 2; // 1-based + header row
    const address = (row[addrKey] ?? "").trim();
    const amount = (row[amtKey] ?? "").trim();
    const memoTypeRaw = memoTypeKey ? row[memoTypeKey]?.trim() : "none";
    const memoType = ["none", "text", "id"].includes(memoTypeRaw as MemoType) ? (memoTypeRaw as MemoType) : "none";
    const memo = memoKey ? (row[memoKey]?.trim() ?? "") : "";

    const rawData = { address, amount, memoType, memo };

    if (validateRow(rowNum, rawData, errors)) {
      valid.push({
        id: nextId(),
        address,
        amount,
        memoType,
        memo,
      });
    }
  });

  return { valid, errors };
}

// ─── JSON parser ──────────────────────────────────────────────────────────────

export function parseJSON(raw: string): BulkParseResult {
  const valid: RecipientRow[] = [];
  const errors: ParseError[] = [];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    errors.push({ id: nextId(), row: 0, reason: "Invalid JSON — could not parse file", rawData: { address: "", amount: "", memoType: "none", memo: "" } });
    return { valid, errors };
  }

  if (!Array.isArray(data)) {
    errors.push({ id: nextId(), row: 0, reason: "JSON must be an array of recipient objects", rawData: { address: "", amount: "", memoType: "none", memo: "" } });
    return { valid, errors };
  }

  data.forEach((item: unknown, i) => {
    const rowNum = i + 1;
    if (typeof item !== "object" || item === null) {
      errors.push({ id: nextId(), row: rowNum, reason: `Row ${rowNum}: Entry is not an object`, rawData: { address: "", amount: "", memoType: "none", memo: "" } });
      return;
    }

    const obj = item as Record<string, unknown>;
    // Case-insensitive key lookup
    const find = (keys: string[]) => {
      const entry = Object.entries(obj).find(([k]) => keys.includes(k.toLowerCase()));
      return entry ? String(entry[1] ?? "").trim() : "";
    };

    const address = find(["address", "public key", "public_key"]);
    const amount = find(["amount"]);
    const memoTypeRaw = find(["memo_type"]) as MemoType;
    const memoType = ["none", "text", "id"].includes(memoTypeRaw) ? memoTypeRaw : "none";
    const memo = find(["memo"]);

    const rawData = { address, amount, memoType, memo };

    if (validateRow(rowNum, rawData, errors)) {
      valid.push({
        id: nextId(),
        address,
        amount,
        memoType,
        memo,
      });
    }
  });

  return { valid, errors };
}

// ─── Unified entry point ──────────────────────────────────────────────────────

export function parseBulkFile(raw: string, filename: string): BulkParseResult {
  return filename.toLowerCase().endsWith(".json") ? parseJSON(raw) : parseCSV(raw);
}
