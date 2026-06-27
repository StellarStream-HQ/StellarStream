import { StrKey } from "@stellar/stellar-sdk";
import { parse } from "csv-parse";
import { Readable } from "stream";
import { ValidationError } from "../lib/app-error.js";

export interface RawRecipientRow {
  address: string;
  amount: string;
  [key: string]: string;
}

export interface CleanRecipient {
  address: string;
  amountStroops: string;
}

export interface ProcessFileError {
  row: number;
  address: string;
  reason: string;
}

export interface ProcessFileResult {
  valid: CleanRecipient[];
  errors: ProcessFileError[];
  totalRows: number;
}

const STROOPS_PER_UNIT = 10_000_000n;

function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) {
    return BigInt(trimmed) * STROOPS_PER_UNIT;
  }
  const intPart = trimmed.slice(0, dotIndex);
  const fracPart = trimmed.slice(dotIndex + 1).padEnd(7, "0").slice(0, 7);
  return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(fracPart);
}

function parseCsvStream(raw: string): Promise<RawRecipientRow[]> {
  return new Promise((resolve, reject) => {
    const rows: RawRecipientRow[] = [];
    const parser = parse({
      columns: (header: string[]) => header.map((h: string) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    parser.on("readable", () => {
      let record: RawRecipientRow | null;
      while ((record = parser.read() as RawRecipientRow | null) !== null) {
        rows.push(record);
      }
    });
    parser.on("error", reject);
    parser.on("end", () => resolve(rows));

    Readable.from(raw).pipe(parser);
  });
}

export function processRows(rows: RawRecipientRow[]): ProcessFileResult {
  const valid: CleanRecipient[] = [];
  const errors: ProcessFileError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const address = (row.address ?? "").trim();
    const amountRaw = (row.amount ?? "").trim();
    const rowNum = i + 1;

    if (!StrKey.isValidEd25519PublicKey(address)) {
      errors.push({ row: rowNum, address, reason: "Invalid G-address checksum" });
      continue;
    }

    if (!/^\d+(\.\d+)?$/.test(amountRaw)) {
      errors.push({ row: rowNum, address, reason: "Invalid amount format" });
      continue;
    }

    try {
      const amountStroops = toStroops(amountRaw).toString();
      valid.push({ address, amountStroops });
    } catch {
      errors.push({ row: rowNum, address, reason: "Amount conversion failed" });
    }
  }

  return { valid, errors, totalRows: rows.length };
}

export async function processFile(
  content: string,
  format: "csv" | "json"
): Promise<ProcessFileResult> {
  let rows: RawRecipientRow[];

  if (format === "csv") {
    rows = await parseCsvStream(content);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (cause) {
      throw new ValidationError("JSON input is not valid JSON", { cause });
    }
    if (!Array.isArray(parsed)) {
      throw new ValidationError("JSON input must be an array", {
        details: { receivedType: typeof parsed },
      });
    }
    rows = parsed as RawRecipientRow[];
  }

  return processRows(rows);
}
