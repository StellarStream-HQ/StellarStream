-- Migration: Add Reconciliation Reports tables
-- Adds Report, ReportConfiguration, and ReportAuditLog tables for automated reconciliation reports

-- ── Report Type Enum ──────────────────────────────────────────────────────────
CREATE TYPE "ReportType" AS ENUM (
  'daily_summary',
  'monthly_statement',
  'failed_payment',
  'fee_analysis',
  'tax_report'
);

-- ── Report Status Enum ────────────────────────────────────────────────────────
CREATE TYPE "ReportStatus" AS ENUM (
  'pending',
  'generating',
  'generated',
  'failed'
);

-- ── Report Table ──────────────────────────────────────────────────────────────
-- Core report metadata and reconciliation data
CREATE TABLE "Report" (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"        VARCHAR(58) NOT NULL,
  "reportType"            "ReportType" NOT NULL,
  "periodStart"           TIMESTAMPTZ NOT NULL,
  "periodEnd"             TIMESTAMPTZ NOT NULL,
  "generatedAt"           TIMESTAMPTZ NOT NULL,
  "generatedBy"           TEXT        NOT NULL,
  status                  "ReportStatus" NOT NULL DEFAULT 'pending',
  -- JSONB storage for flexible schema (supports pdf, xlsx, json, csv URLs)
  "fileUrls"              JSONB       DEFAULT '{}',
  -- Summary statistics (transactionCount, totalVolume, failureCount, feeTotal)
  summary                 JSONB       NOT NULL,
  -- Reconciliation data (totalExpected, totalActual, variance, discrepanciesFound, explanations)
  "reconciliationStatus"  JSONB       NOT NULL,
  -- Email delivery tracking (optional)
  "emailDeliveryStatus"   JSONB,
  -- Audit log array for embedded audit trail (optional)
  "auditLog"              JSONB       DEFAULT '[]',
  -- Soft delete timestamp (null = active, not null = deleted)
  "deletedAt"             TIMESTAMPTZ,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "Report_pkey" PRIMARY KEY (id)
);

-- Indexes for Report table
CREATE INDEX "Report_organizationId_createdAt_idx" ON "Report" ("organizationId", "createdAt" DESC);
CREATE INDEX "Report_reportType_organizationId_idx" ON "Report" ("reportType", "organizationId");
CREATE INDEX "Report_status_idx" ON "Report" (status);
CREATE INDEX "Report_organizationId_idx" ON "Report" ("organizationId");

-- ── Report Configuration Table ────────────────────────────────────────────────
-- Stores per-organization report generation schedules and preferences
CREATE TABLE "ReportConfiguration" (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"        VARCHAR(58) NOT NULL,
  "reportType"            "ReportType" NOT NULL,
  enabled                 BOOLEAN     NOT NULL DEFAULT true,
  -- Schedule: { frequency: 'daily'|'monthly'|'on_failure'|'manual', timeUtc?: 'HH:MM', dayOfMonth?: number }
  schedule                JSONB       NOT NULL,
  -- Export formats array: ['pdf', 'xlsx', 'json', 'csv']
  "exportFormats"         TEXT[]      NOT NULL DEFAULT ARRAY['pdf', 'xlsx'],
  -- Email config: { enabled, recipients, includePreview, attachmentFormats }
  "emailConfig"           JSONB,
  -- Storage config: { provider: 's3'|'gcs', bucket, retentionDays }
  "storageConfig"         JSONB       NOT NULL,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "ReportConfiguration_pkey" PRIMARY KEY (id),
  CONSTRAINT "ReportConfiguration_org_type_unique" UNIQUE ("organizationId", "reportType")
);

-- Indexes for ReportConfiguration table
CREATE INDEX "ReportConfiguration_organizationId_reportType_idx" ON "ReportConfiguration" ("organizationId", "reportType");
CREATE INDEX "ReportConfiguration_organizationId_idx" ON "ReportConfiguration" ("organizationId");
CREATE INDEX "ReportConfiguration_enabled_idx" ON "ReportConfiguration" (enabled);

-- ── Report Audit Log Table ─────────────────────────────────────────────────────
-- Immutable append-only log of all report operations for compliance and debugging
CREATE TABLE "ReportAuditLog" (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "reportId"              UUID        NOT NULL REFERENCES "Report"(id) ON DELETE CASCADE,
  action                  TEXT        NOT NULL,  -- generated, failed, emailed, deleted, verified
  actor                   TEXT        NOT NULL,  -- user ID or 'system'
  timestamp               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Details: arbitrary JSON for operation-specific context
  details                 JSONB,

  CONSTRAINT "ReportAuditLog_pkey" PRIMARY KEY (id)
);

-- Indexes for ReportAuditLog table
CREATE INDEX "ReportAuditLog_reportId_timestamp_idx" ON "ReportAuditLog" ("reportId", timestamp DESC);
CREATE INDEX "ReportAuditLog_timestamp_idx" ON "ReportAuditLog" (timestamp DESC);
CREATE INDEX "ReportAuditLog_action_idx" ON "ReportAuditLog" (action);

