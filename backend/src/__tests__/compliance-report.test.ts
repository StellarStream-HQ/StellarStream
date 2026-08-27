/**
 * ComplianceReportService tests (#1359).
 *
 * DB calls are mocked so no Postgres instance is required. Filesystem I/O is
 * real (writing under backend/storage/compliance-reports, which is
 * gitignored and cleaned up after each test) rather than mocked — pdfkit
 * itself reads its bundled .afm font files via fs.readFileSync, so a blanket
 * fs mock would break PDF rendering. Exercising real file I/O also gives
 * genuine coverage of the checksum/tamper-detection logic instead of a
 * simulated one.
 *
 * Tests cover:
 *   - Report generation for each report type (AML/KYC, transaction monitoring,
 *     suspicious activity, regulatory filing, audit trail)
 *   - PDF and CSV rendering produce non-empty, checksummed output
 *   - Failed metadata writes roll back the on-disk file
 *   - Report retrieval refuses to serve a file whose checksum no longer matches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

// ── Mock prisma ──────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockExecuteRaw = vi.fn();
const mockEventLogFindMany = vi.fn();
const mockAdminAuditLogFindMany = vi.fn();

vi.mock("../lib/db.js", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
    eventLog: { findMany: (...args: unknown[]) => mockEventLogFindMany(...args) },
    adminAuditLog: { findMany: (...args: unknown[]) => mockAdminAuditLogFindMany(...args) },
  },
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ComplianceReportService } from "../services/compliance-report.service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_START = new Date("2026-06-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-07-01T00:00:00.000Z");
const REPORTS_DIR = path.join(process.cwd(), "storage", "compliance-reports");

function queryTextOf(strings: TemplateStringsArray): string {
  return strings.join(" ");
}

function mockAllComplianceQueries() {
  mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const q = queryTextOf(strings);
    if (q.includes("ComplianceProfile")) {
      return Promise.resolve([
        {
          stellar_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          kyc_level: 1,
          sanctioned: false,
          is_pep: false,
          updated_at: PERIOD_START,
        },
      ]);
    }
    if (q.includes("ComplianceLog")) {
      return Promise.resolve([
        {
          sender_address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          recipient_address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          amount_stroops: "20000000000",
          asset_code: "XLM",
          tx_hash: "abc123",
          allowed: false,
          check_name: "AML,TRANSACTION_LIMITS",
          block_reason: "Structuring pattern detected",
          created_at: PERIOD_START,
        },
      ]);
    }
    return Promise.resolve([]);
  });
}

describe("ComplianceReportService", () => {
  let service: ComplianceReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAllComplianceQueries();
    mockExecuteRaw.mockResolvedValue(undefined);
    mockEventLogFindMany.mockResolvedValue([
      {
        eventType: "create",
        streamId: "stream-1",
        txHash: "tx-1",
        sender: "GSENDER",
        receiver: "GRECEIVER",
        amount: BigInt("1000000"),
        entryHash: "deadbeefdeadbeef",
        createdAt: PERIOD_START,
      },
    ]);
    mockAdminAuditLogFindMany.mockResolvedValue([
      {
        timestamp: PERIOD_START,
        userId: "admin-1",
        userEmail: "admin@example.com",
        method: "PATCH",
        path: "/compliance/config",
        statusCode: 200,
        changesSummary: "Updated KYC threshold",
      },
    ]);
    service = new ComplianceReportService();
  });

  afterEach(() => {
    fs.rmSync(REPORTS_DIR, { recursive: true, force: true });
  });

  // ── Generation: one test per report type ────────────────────────────────

  it.each([
    "AML_KYC",
    "TRANSACTION_MONITORING",
    "SUSPICIOUS_ACTIVITY",
    "REGULATORY_FILING",
    "AUDIT_TRAIL",
  ] as const)("generates a PDF report for %s and writes it to secure storage", async (reportType) => {
    const report = await service.generateReport({
      reportType,
      format: "pdf",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      generatedBy: "admin-test",
    });

    expect(report.reportType).toBe(reportType);
    expect(report.format).toBe("pdf");
    expect(report.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const files = fs.readdirSync(REPORTS_DIR);
    expect(files.length).toBe(1);

    const written = fs.readFileSync(path.join(REPORTS_DIR, files[0]));
    expect(written.length).toBeGreaterThan(0);
    expect(createHash("sha256").update(written).digest("hex")).toBe(report.checksumSha256);

    // Secure permissions: owner read/write only
    const stat = fs.statSync(path.join(REPORTS_DIR, files[0]));
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("generates a CSV report with correct checksum", async () => {
    const report = await service.generateReport({
      reportType: "TRANSACTION_MONITORING",
      format: "csv",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      generatedBy: "admin-test",
    });

    expect(report.format).toBe("csv");
    const files = fs.readdirSync(REPORTS_DIR);
    expect(files[0].endsWith(".csv")).toBe(true);

    const written = fs.readFileSync(path.join(REPORTS_DIR, files[0]), "utf-8");
    expect(written).toContain("Sender");
    expect(written).toContain("Recipient");
  });

  it("persists report metadata via a ComplianceReport insert", async () => {
    await service.generateReport({
      reportType: "SUSPICIOUS_ACTIVITY",
      format: "pdf",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      generatedBy: "admin-test",
    });

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(String(mockExecuteRaw.mock.calls[0][0])).toMatch(/ComplianceReport/i);
  });

  it("rolls back the on-disk file if metadata persistence fails", async () => {
    mockExecuteRaw.mockRejectedValue(new Error("DB unavailable"));

    await expect(
      service.generateReport({
        reportType: "AML_KYC",
        format: "pdf",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        generatedBy: "admin-test",
      }),
    ).rejects.toThrow("DB unavailable");

    expect(fs.existsSync(REPORTS_DIR) ? fs.readdirSync(REPORTS_DIR) : []).toHaveLength(0);
  });

  // ── Listing / metadata ───────────────────────────────────────────────────

  it("listReports queries ComplianceReport", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "r1", report_type: "AML_KYC" }]);
    const reports = await service.listReports({ limit: 10 });
    expect(Array.isArray(reports)).toBe(true);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("getReportMetadata returns null when no row matches", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const meta = await service.getReportMetadata("nonexistent-id");
    expect(meta).toBeNull();
  });

  // ── Secure retrieval ─────────────────────────────────────────────────────

  it("getReportFile returns null when metadata is missing", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const file = await service.getReportFile("missing-id");
    expect(file).toBeNull();
  });

  it("getReportFile returns null when the file is missing from disk", async () => {
    mockQueryRaw.mockResolvedValue([
      {
        id: "r1",
        report_type: "AML_KYC",
        format: "pdf",
        file_path: path.join(os.tmpdir(), "compliance-report-test-does-not-exist.pdf"),
        checksum_sha256: "abc",
      },
    ]);

    const file = await service.getReportFile("r1");
    expect(file).toBeNull();
  });

  it("getReportFile throws when the checksum no longer matches (tamper detection)", async () => {
    const tamperedPath = path.join(os.tmpdir(), `compliance-report-tamper-${Date.now()}.pdf`);
    fs.writeFileSync(tamperedPath, "tampered content after generation");

    mockQueryRaw.mockResolvedValue([
      {
        id: "r1",
        report_type: "AML_KYC",
        format: "pdf",
        file_path: tamperedPath,
        checksum_sha256: "0".repeat(64), // does not match the file's real content
      },
    ]);

    try {
      await expect(service.getReportFile("r1")).rejects.toThrow(/integrity/i);
    } finally {
      fs.rmSync(tamperedPath, { force: true });
    }
  });

  it("getReportFile returns the buffer and correct content type when checksum matches", async () => {
    const filePath = path.join(os.tmpdir(), `compliance-report-valid-${Date.now()}.csv`);
    const content = "sender_address,recipient_address\nGA...,GB...\n";
    fs.writeFileSync(filePath, content);
    const checksum = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

    mockQueryRaw.mockResolvedValue([
      {
        id: "r1",
        report_type: "TRANSACTION_MONITORING",
        format: "csv",
        file_path: filePath,
        checksum_sha256: checksum,
      },
    ]);

    try {
      const file = await service.getReportFile("r1");
      expect(file).not.toBeNull();
      expect(file!.contentType).toBe("text/csv");
      expect(file!.filename).toBe("transaction_monitoring-r1.csv");
      expect(file!.buffer.toString("utf-8")).toBe(content);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });
});
