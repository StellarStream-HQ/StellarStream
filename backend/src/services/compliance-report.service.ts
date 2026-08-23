/**
 * ComplianceReportService — regulatory compliance report generation (#1359)
 *
 * Generates the report types regulators and internal compliance teams need:
 *   - AML_KYC               — compliance-profile state (KYC level, sanctions, PEP) + AML/KYC check history
 *   - TRANSACTION_MONITORING — every compliance-screened payment in a period, flagged limit breaches included
 *   - SUSPICIOUS_ACTIVITY    — blocked payments formatted as SAR-style entries with a narrative
 *   - REGULATORY_FILING      — a filing-ready bundle summarizing all of the above for a period
 *   - AUDIT_TRAIL            — the hash-chained protocol event log + admin operation log for a period
 *
 * Every generated report is written to secure on-disk storage (0600, outside
 * any statically-served directory), checksummed with SHA-256, and logged to
 * "ComplianceReport" for accountability — satisfying "automated generation"
 * and "secure storage" independent of who or what triggered the run.
 */

import PDFDocument from "pdfkit";
import { Parser } from "json2csv";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComplianceReportType =
  | "AML_KYC"
  | "TRANSACTION_MONITORING"
  | "SUSPICIOUS_ACTIVITY"
  | "REGULATORY_FILING"
  | "AUDIT_TRAIL";

export type ComplianceReportFormat = "pdf" | "csv";

export interface GenerateReportOptions {
  reportType: ComplianceReportType;
  format: ComplianceReportFormat;
  periodStart: Date;
  periodEnd: Date;
  generatedBy: string;
}

export interface ComplianceReportRecord {
  id: string;
  reportType: string;
  format: string;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
  checksumSha256: string;
  generatedBy: string;
  createdAt: string;
}

export interface ComplianceReportListFilters {
  reportType?: ComplianceReportType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface StoredReportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface ReportSection {
  heading: string;
  columns: string[];
  rows: string[][];
}

interface ReportPayload {
  title: string;
  summary: Array<[string, string]>;
  sections: ReportSection[];
  /** Section used for CSV export (CSV supports a single flat table). */
  csvSection: ReportSection;
}

const REPORT_TYPES: ComplianceReportType[] = [
  "AML_KYC",
  "TRANSACTION_MONITORING",
  "SUSPICIOUS_ACTIVITY",
  "REGULATORY_FILING",
  "AUDIT_TRAIL",
];

// ─── Secure storage ─────────────────────────────────────────────────────────

const REPORTS_DIR = path.join(process.cwd(), "storage", "compliance-reports");

function ensureReportsDir(): void {
  fs.mkdirSync(REPORTS_DIR, { recursive: true, mode: 0o700 });
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ─── Brand tokens (matches invoice-pdf.service.ts / split-audit-export.service.ts) ──

const BRAND_CYAN = "#00f5ff";
const DARK_BG = "#080814";
const TEXT_PRIMARY = "#e0e0ff";
const TEXT_MUTED = "#7878a0";
const ROW_ALT = "#0f0f28";

// ─── PDF rendering ──────────────────────────────────────────────────────────

function renderPDF(payload: ReportPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      compress: true,
      info: {
        Title: payload.title,
        Author: "StellarStream Compliance",
        Subject: "Compliance Report",
        Creator: "StellarStream",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = doc.page.width;
    const M = 50;

    const drawHeader = () => {
      doc.rect(0, 0, W, doc.page.height).fill(DARK_BG);
      doc.rect(0, 0, W, 4).fill(BRAND_CYAN);
      doc
        .font("Helvetica-Bold")
        .fontSize(20)
        .fillColor(BRAND_CYAN)
        .text("StellarStream", M, 24);
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor(TEXT_PRIMARY)
        .text(payload.title.toUpperCase(), W - M - 260, 28, { width: 260, align: "right" });
      doc.moveTo(M, 72).lineTo(W - M, 72).strokeColor(BRAND_CYAN).lineWidth(0.5).stroke();
    };

    const drawFooter = () => {
      const footerY = doc.page.height - 30;
      doc.rect(0, footerY - 4, W, 4).fill(BRAND_CYAN);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(TEXT_MUTED)
        .text(
          `Generated ${new Date().toISOString()} · StellarStream Compliance · Confidential`,
          M,
          footerY + 6,
          { width: W - M * 2, align: "center" },
        );
    };

    drawHeader();
    let y = 86;

    // ── Summary block ────────────────────────────────────────────────────────
    for (const [label, value] of payload.summary) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(TEXT_MUTED).text(label, M, y);
      doc.font("Helvetica").fontSize(9).fillColor(TEXT_PRIMARY).text(value, M + 160, y, { width: W - M * 2 - 160 });
      y += 16;
    }
    y += 10;

    for (const section of payload.sections) {
      if (y > doc.page.height - 140) {
        drawFooter();
        doc.addPage();
        drawHeader();
        y = 86;
      }

      doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND_CYAN).text(section.heading, M, y);
      y += 18;

      if (section.rows.length === 0) {
        doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED).text("No records in this period.", M, y);
        y += 20;
        continue;
      }

      const colWidth = (W - M * 2) / section.columns.length;

      doc.rect(M, y, W - M * 2, 16).fill("#0a0a22");
      section.columns.forEach((col, i) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(TEXT_MUTED)
          .text(col.toUpperCase(), M + i * colWidth + 4, y + 4, { width: colWidth - 6 });
      });
      y += 16;

      for (let r = 0; r < section.rows.length; r++) {
        if (y > doc.page.height - 60) {
          drawFooter();
          doc.addPage();
          drawHeader();
          y = 86;
        }

        const rowH = 16;
        if (r % 2 === 1) doc.rect(M, y, W - M * 2, rowH).fill(ROW_ALT);

        section.rows[r].forEach((cell, i) => {
          doc
            .font("Helvetica")
            .fontSize(7)
            .fillColor(TEXT_PRIMARY)
            .text(cell, M + i * colWidth + 4, y + 4, { width: colWidth - 6, ellipsis: true });
        });
        y += rowH;
      }
      y += 14;
    }

    drawFooter();
    doc.end();
  });
}

// ─── CSV rendering ──────────────────────────────────────────────────────────

function renderCSV(section: ReportSection): string {
  if (section.rows.length === 0) {
    return section.columns.join(",") + "\n";
  }
  const rows = section.rows.map((row) =>
    Object.fromEntries(section.columns.map((col, i) => [col, row[i] ?? ""])),
  );
  const parser = new Parser({ fields: section.columns });
  return parser.parse(rows);
}

// ─── Data access ────────────────────────────────────────────────────────────

interface ComplianceProfileRow {
  stellar_address: string;
  kyc_level: number;
  sanctioned: boolean;
  is_pep: boolean;
  updated_at: Date;
}

interface ComplianceLogRow {
  sender_address: string;
  recipient_address: string;
  amount_stroops: string;
  asset_code: string;
  tx_hash: string | null;
  allowed: boolean;
  check_name: string;
  block_reason: string | null;
  created_at: Date;
}

async function fetchComplianceProfiles(
  periodStart: Date,
  periodEnd: Date,
): Promise<ComplianceProfileRow[]> {
  try {
    return await prisma.$queryRaw<ComplianceProfileRow[]>`
      SELECT stellar_address, kyc_level, sanctioned, is_pep, updated_at
      FROM "ComplianceProfile"
      WHERE updated_at >= ${periodStart} AND updated_at <= ${periodEnd}
      ORDER BY updated_at DESC
    `;
  } catch (err) {
    logger.error("[ComplianceReport] Failed to fetch ComplianceProfile rows", { err });
    return [];
  }
}

async function fetchComplianceLogs(
  periodStart: Date,
  periodEnd: Date,
  options: { blockedOnly?: boolean; checkNameLike?: string } = {},
): Promise<ComplianceLogRow[]> {
  try {
    if (options.blockedOnly) {
      return await prisma.$queryRaw<ComplianceLogRow[]>`
        SELECT sender_address, recipient_address, amount_stroops::text AS amount_stroops,
               asset_code, tx_hash, allowed, check_name, block_reason, created_at
        FROM "ComplianceLog"
        WHERE allowed = false
          AND created_at >= ${periodStart} AND created_at <= ${periodEnd}
        ORDER BY created_at DESC
      `;
    }
    if (options.checkNameLike) {
      return await prisma.$queryRaw<ComplianceLogRow[]>`
        SELECT sender_address, recipient_address, amount_stroops::text AS amount_stroops,
               asset_code, tx_hash, allowed, check_name, block_reason, created_at
        FROM "ComplianceLog"
        WHERE created_at >= ${periodStart} AND created_at <= ${periodEnd}
          AND check_name LIKE ${options.checkNameLike}
        ORDER BY created_at DESC
      `;
    }
    return await prisma.$queryRaw<ComplianceLogRow[]>`
      SELECT sender_address, recipient_address, amount_stroops::text AS amount_stroops,
             asset_code, tx_hash, allowed, check_name, block_reason, created_at
      FROM "ComplianceLog"
      WHERE created_at >= ${periodStart} AND created_at <= ${periodEnd}
      ORDER BY created_at DESC
    `;
  } catch (err) {
    logger.error("[ComplianceReport] Failed to fetch ComplianceLog rows", { err });
    return [];
  }
}

async function fetchEventLogRows(periodStart: Date, periodEnd: Date) {
  try {
    return await prisma.eventLog.findMany({
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
  } catch (err) {
    logger.error("[ComplianceReport] Failed to fetch EventLog rows", { err });
    return [];
  }
}

async function fetchAdminAuditRows(periodStart: Date, periodEnd: Date) {
  try {
    return await prisma.adminAuditLog.findMany({
      where: { timestamp: { gte: periodStart, lte: periodEnd } },
      orderBy: { timestamp: "desc" },
      take: 5000,
      select: {
        timestamp: true,
        userId: true,
        userEmail: true,
        method: true,
        path: true,
        statusCode: true,
        changesSummary: true,
      },
    });
  } catch (err) {
    logger.error("[ComplianceReport] Failed to fetch AdminAuditLog rows", { err });
    return [];
  }
}

// ─── Payload builders (one per report type) ────────────────────────────────

function profileSection(rows: ComplianceProfileRow[]): ReportSection {
  return {
    heading: "Compliance Profiles Updated in Period",
    columns: ["Address", "KYC Level", "Sanctioned", "PEP", "Updated At"],
    rows: rows.map((r) => [
      r.stellar_address,
      String(r.kyc_level),
      r.sanctioned ? "YES" : "NO",
      r.is_pep ? "YES" : "NO",
      new Date(r.updated_at).toISOString(),
    ]),
  };
}

function complianceLogSection(heading: string, rows: ComplianceLogRow[]): ReportSection {
  return {
    heading,
    columns: ["Sender", "Recipient", "Amount (stroops)", "Asset", "Allowed", "Checks", "Reason", "Timestamp"],
    rows: rows.map((r) => [
      r.sender_address,
      r.recipient_address,
      r.amount_stroops,
      r.asset_code,
      r.allowed ? "YES" : "NO",
      r.check_name,
      r.block_reason ?? "",
      new Date(r.created_at).toISOString(),
    ]),
  };
}

async function buildAmlKycPayload(periodStart: Date, periodEnd: Date): Promise<ReportPayload> {
  const [profiles, amlKycLogs] = await Promise.all([
    fetchComplianceProfiles(periodStart, periodEnd),
    fetchComplianceLogs(periodStart, periodEnd, { checkNameLike: "%AML%" }),
  ]);

  const profiles_ = profileSection(profiles);
  const logs_ = complianceLogSection("AML / KYC Check History", amlKycLogs);

  return {
    title: "AML / KYC Compliance Report",
    summary: [
      ["Period", `${periodStart.toISOString()} — ${periodEnd.toISOString()}`],
      ["Profiles Updated", String(profiles.length)],
      ["Sanctioned Addresses", String(profiles.filter((p) => p.sanctioned).length)],
      ["PEP-Flagged Addresses", String(profiles.filter((p) => p.is_pep).length)],
      ["AML/KYC Checks Logged", String(amlKycLogs.length)],
    ],
    sections: [profiles_, logs_],
    csvSection: profiles_,
  };
}

async function buildTransactionMonitoringPayload(
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportPayload> {
  const logs = await fetchComplianceLogs(periodStart, periodEnd);
  const flagged = logs.filter((r) => !r.allowed);
  const section = complianceLogSection("Screened Transactions", logs);

  return {
    title: "Transaction Monitoring Report",
    summary: [
      ["Period", `${periodStart.toISOString()} — ${periodEnd.toISOString()}`],
      ["Transactions Screened", String(logs.length)],
      ["Flagged / Blocked", String(flagged.length)],
      ["Flag Rate", logs.length > 0 ? `${((flagged.length / logs.length) * 100).toFixed(2)}%` : "0%"],
    ],
    sections: [section],
    csvSection: section,
  };
}

async function buildSuspiciousActivityPayload(
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportPayload> {
  const blocked = await fetchComplianceLogs(periodStart, periodEnd, { blockedOnly: true });
  const section: ReportSection = {
    heading: "Suspicious Activity Entries",
    columns: ["Sender", "Recipient", "Amount (stroops)", "Asset", "TX Hash", "Triggered Checks", "Narrative", "Detected At"],
    rows: blocked.map((r) => [
      r.sender_address,
      r.recipient_address,
      r.amount_stroops,
      r.asset_code,
      r.tx_hash ?? "N/A",
      r.check_name,
      r.block_reason ?? "Blocked by automated compliance checks",
      new Date(r.created_at).toISOString(),
    ]),
  };

  return {
    title: "Suspicious Activity Report (SAR)",
    summary: [
      ["Period", `${periodStart.toISOString()} — ${periodEnd.toISOString()}`],
      ["Suspicious Transactions Identified", String(blocked.length)],
      ["Filing Basis", "Automated compliance rule engine (sanctions, AML, KYC, PEP, limits)"],
    ],
    sections: [section],
    csvSection: section,
  };
}

async function buildAuditTrailPayload(periodStart: Date, periodEnd: Date): Promise<ReportPayload> {
  const [events, adminOps] = await Promise.all([
    fetchEventLogRows(periodStart, periodEnd),
    fetchAdminAuditRows(periodStart, periodEnd),
  ]);

  const eventSection: ReportSection = {
    heading: "Protocol Event Log (Hash-Chained)",
    columns: ["Event Type", "Stream ID", "TX Hash", "Sender", "Receiver", "Amount", "Entry Hash", "Created At"],
    rows: events.map((e) => [
      e.eventType,
      e.streamId,
      e.txHash,
      e.sender ?? "",
      e.receiver ?? "",
      e.amount?.toString() ?? "",
      (e.entryHash ?? "").slice(0, 16),
      e.createdAt.toISOString(),
    ]),
  };

  const adminSection: ReportSection = {
    heading: "Administrative Operations Log",
    columns: ["Timestamp", "User", "Method", "Path", "Status", "Summary"],
    rows: adminOps.map((a) => [
      a.timestamp.toISOString(),
      a.userEmail ?? a.userId ?? "unknown",
      a.method,
      a.path,
      String(a.statusCode),
      a.changesSummary ?? "",
    ]),
  };

  return {
    title: "Audit Trail Report",
    summary: [
      ["Period", `${periodStart.toISOString()} — ${periodEnd.toISOString()}`],
      ["Protocol Events", String(events.length)],
      ["Admin Operations", String(adminOps.length)],
    ],
    sections: [eventSection, adminSection],
    csvSection: eventSection,
  };
}

async function buildRegulatoryFilingPayload(
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportPayload> {
  const [amlKyc, txMonitoring, sar] = await Promise.all([
    buildAmlKycPayload(periodStart, periodEnd),
    buildTransactionMonitoringPayload(periodStart, periodEnd),
    buildSuspiciousActivityPayload(periodStart, periodEnd),
  ]);

  const summarySection: ReportSection = {
    heading: "Filing Summary",
    columns: ["Category", "Metric", "Value"],
    rows: [
      ["AML/KYC", "Profiles Updated", amlKyc.summary[1][1]],
      ["AML/KYC", "Sanctioned Addresses", amlKyc.summary[2][1]],
      ["AML/KYC", "PEP-Flagged Addresses", amlKyc.summary[3][1]],
      ["Transaction Monitoring", "Transactions Screened", txMonitoring.summary[1][1]],
      ["Transaction Monitoring", "Flagged / Blocked", txMonitoring.summary[2][1]],
      ["Suspicious Activity", "SAR Entries Filed", sar.summary[1][1]],
    ],
  };

  return {
    title: "Regulatory Filing Bundle",
    summary: [
      ["Period", `${periodStart.toISOString()} — ${periodEnd.toISOString()}`],
      ["Sections Included", "AML/KYC, Transaction Monitoring, Suspicious Activity"],
    ],
    sections: [summarySection, ...amlKyc.sections, ...txMonitoring.sections, ...sar.sections],
    csvSection: summarySection,
  };
}

async function buildPayload(
  reportType: ComplianceReportType,
  periodStart: Date,
  periodEnd: Date,
): Promise<ReportPayload> {
  switch (reportType) {
    case "AML_KYC":
      return buildAmlKycPayload(periodStart, periodEnd);
    case "TRANSACTION_MONITORING":
      return buildTransactionMonitoringPayload(periodStart, periodEnd);
    case "SUSPICIOUS_ACTIVITY":
      return buildSuspiciousActivityPayload(periodStart, periodEnd);
    case "AUDIT_TRAIL":
      return buildAuditTrailPayload(periodStart, periodEnd);
    case "REGULATORY_FILING":
      return buildRegulatoryFilingPayload(periodStart, periodEnd);
  }
}

function recordCountOf(payload: ReportPayload): number {
  return payload.sections.reduce((sum, s) => sum + s.rows.length, 0);
}

// ─── ComplianceReportService ────────────────────────────────────────────────

export class ComplianceReportService {
  /**
   * Generate a report, persist it to secure storage, and log its metadata.
   * Never returns the raw file — callers must fetch it via getReportFile()
   * so every access to report content goes through the same audit path.
   */
  async generateReport(options: GenerateReportOptions): Promise<ComplianceReportRecord> {
    const { reportType, format, periodStart, periodEnd, generatedBy } = options;

    const payload = await buildPayload(reportType, periodStart, periodEnd);
    const recordCount = recordCountOf(payload);

    const buffer =
      format === "pdf"
        ? await renderPDF(payload)
        : Buffer.from(renderCSV(payload.csvSection), "utf-8");

    ensureReportsDir();
    const id = crypto.randomUUID();
    const ext = format === "pdf" ? "pdf" : "csv";
    const filename = `${reportType.toLowerCase()}-${id}.${ext}`;
    const filePath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filePath, buffer, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);

    const checksum = sha256(buffer);

    try {
      await prisma.$executeRaw`
        INSERT INTO "ComplianceReport" (
          id, report_type, format, period_start, period_end,
          record_count, file_path, checksum_sha256, generated_by, metadata, created_at
        ) VALUES (
          ${id}::uuid, ${reportType}, ${format}, ${periodStart}, ${periodEnd},
          ${recordCount}, ${filePath}, ${checksum}, ${generatedBy},
          ${JSON.stringify({ title: payload.title })}::jsonb, NOW()
        )
      `;
    } catch (err) {
      // Roll back the file so we never have an orphaned, unlogged report on disk.
      fs.rmSync(filePath, { force: true });
      logger.error("[ComplianceReport] Failed to persist report metadata", { err, reportType });
      throw err;
    }

    logger.info("[ComplianceReport] Report generated", {
      id,
      reportType,
      format,
      recordCount,
      generatedBy,
    });

    return {
      id,
      reportType,
      format,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      recordCount,
      checksumSha256: checksum,
      generatedBy,
      createdAt: new Date().toISOString(),
    };
  }

  async listReports(filters: ComplianceReportListFilters = {}): Promise<unknown[]> {
    const { reportType, startDate, endDate, limit = 50, offset = 0 } = filters;

    return prisma.$queryRaw`
      SELECT id, report_type, format, period_start, period_end,
             record_count, checksum_sha256, generated_by, created_at
      FROM "ComplianceReport"
      WHERE (${reportType ?? null}::text IS NULL OR report_type = ${reportType ?? null})
        AND (${startDate ?? null}::timestamptz IS NULL OR created_at >= ${startDate ?? null})
        AND (${endDate ?? null}::timestamptz IS NULL OR created_at <= ${endDate ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async getReportMetadata(id: string): Promise<Record<string, unknown> | null> {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, report_type, format, period_start, period_end,
             record_count, file_path, checksum_sha256, generated_by, created_at
      FROM "ComplianceReport"
      WHERE id = ${id}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Read a previously generated report's file, re-verifying its checksum
   * against the value logged at generation time. Refuses to serve a file
   * whose contents no longer match — the storage-integrity guarantee that
   * makes this "secure storage" rather than just a filesystem write.
   */
  async getReportFile(id: string): Promise<StoredReportFile | null> {
    const meta = await this.getReportMetadata(id);
    if (!meta) return null;

    const filePath = meta.file_path as string;
    if (!fs.existsSync(filePath)) {
      logger.error("[ComplianceReport] Report file missing from storage", { id, filePath });
      return null;
    }

    const buffer = fs.readFileSync(filePath);
    const checksum = sha256(buffer);
    if (checksum !== meta.checksum_sha256) {
      logger.error("[ComplianceReport] Checksum mismatch — refusing to serve report", { id });
      throw new Error("Report integrity check failed");
    }

    const reportType = String(meta.report_type).toLowerCase();
    const format = meta.format as string;
    const contentType = format === "pdf" ? "application/pdf" : "text/csv";

    return {
      buffer,
      filename: `${reportType}-${id}.${format}`,
      contentType,
    };
  }
}

export const complianceReportService = new ComplianceReportService();
export const SUPPORTED_REPORT_TYPES = REPORT_TYPES;
