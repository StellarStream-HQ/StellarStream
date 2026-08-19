-- Payment Dispute Resolution System
-- -----------------------------------
-- Adds tables for filing, tracking, and resolving payment disputes:
--   PaymentDispute  — the dispute record itself
--   DisputeEvidence — evidence files attached to a dispute
--   DisputeHistory  — immutable timeline of actions/status transitions

CREATE TABLE IF NOT EXISTS "PaymentDispute" (
  id                 TEXT PRIMARY KEY,
  disputeRef         TEXT NOT NULL UNIQUE,          -- Human-readable reference e.g. DSP-2026-XXXXXX
  streamId           TEXT,                          -- Reference to the payment stream
  txHash             TEXT,                          -- Reference to the on-chain transaction
  filerAddress       TEXT NOT NULL,                 -- Address that filed the dispute
  respondentAddress  TEXT NOT NULL,                 -- Counterparty address
  reason             TEXT NOT NULL,                 -- Dispute category/reason
  description        TEXT,                          -- Detailed description
  amount             TEXT NOT NULL DEFAULT '0',     -- Disputed amount (string to avoid precision loss)
  tokenAddress       TEXT,                          -- Asset/token involved
  status             TEXT NOT NULL DEFAULT 'FILED', -- FILED, EVIDENCE_REVIEW, RESOLVED, REJECTED, CLOSED
  decision           TEXT,                          -- GRANTED, DENIED, PARTIAL (null while unresolved)
  resolutionNotes    TEXT,                          -- Notes attached on resolution
  resolvedBy         TEXT,                          -- Address that resolved the dispute
  resolvedAt         TIMESTAMP,
  createdAt          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DisputeEvidence" (
  id              TEXT PRIMARY KEY,
  disputeId       TEXT NOT NULL REFERENCES "PaymentDispute"(id) ON DELETE CASCADE,
  uploaderAddress TEXT NOT NULL,                    -- Address that uploaded the evidence
  fileName        TEXT NOT NULL,                    -- Original file name
  fileUrl         TEXT NOT NULL,                    -- Stored file URL / object key
  mimeType        TEXT,                             -- e.g. image/png, application/pdf
  fileSize        INTEGER DEFAULT 0,                -- Bytes
  description     TEXT,                             -- Optional evidence description
  createdAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DisputeHistory" (
  id            TEXT PRIMARY KEY,
  disputeId     TEXT NOT NULL REFERENCES "PaymentDispute"(id) ON DELETE CASCADE,
  actorAddress  TEXT NOT NULL,                      -- Address that performed the action
  action        TEXT NOT NULL,                      -- FILED, EVIDENCE_ADDED, STATUS_CHANGED, RESOLVED, REJECTED, CLOSED, NOTE_ADDED
  fromStatus    TEXT,
  toStatus      TEXT,
  comment       TEXT,                               -- Optional human-readable note
  createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "PaymentDispute_filerAddress_idx"     ON "PaymentDispute"("filerAddress");
CREATE INDEX IF NOT EXISTS "PaymentDispute_respondentAddress_idx" ON "PaymentDispute"("respondentAddress");
CREATE INDEX IF NOT EXISTS "PaymentDispute_status_idx"           ON "PaymentDispute"("status");
CREATE INDEX IF NOT EXISTS "PaymentDispute_streamId_idx"         ON "PaymentDispute"("streamId");
CREATE INDEX IF NOT EXISTS "PaymentDispute_txHash_idx"           ON "PaymentDispute"("txHash");
CREATE INDEX IF NOT EXISTS "PaymentDispute_createdAt_idx"        ON "PaymentDispute"("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DisputeEvidence_disputeId_idx"       ON "DisputeEvidence"("disputeId");
CREATE INDEX IF NOT EXISTS "DisputeEvidence_uploaderAddress_idx" ON "DisputeEvidence"("uploaderAddress");

CREATE INDEX IF NOT EXISTS "DisputeHistory_disputeId_idx"        ON "DisputeHistory"("disputeId");
CREATE INDEX IF NOT EXISTS "DisputeHistory_action_idx"           ON "DisputeHistory"("action");
CREATE INDEX IF NOT EXISTS "DisputeHistory_createdAt_idx"        ON "DisputeHistory"("createdAt" DESC);

COMMENT ON TABLE "PaymentDispute"  IS 'Payment disputes filed against streams/transactions';
COMMENT ON TABLE "DisputeEvidence" IS 'Evidence attachments supporting a payment dispute';
COMMENT ON TABLE "DisputeHistory"  IS 'Immutable timeline of dispute actions and status transitions';

