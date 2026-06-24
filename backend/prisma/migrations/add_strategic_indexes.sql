-- #1148 — Strategic Database Indexes
--
-- Adds composite indexes for the hottest read paths that were previously
-- doing sequential scans, plus a batch_id column on Disbursement to support
-- the batch processing engine (#1202).
--
-- NOTE ON CONCURRENTLY:
--   CREATE/DROP INDEX CONCURRENTLY must run OUTSIDE a transaction block so the
--   index is built without taking a write lock on a populated table. Apply this
--   file with psql (autocommit), e.g.:
--       psql "$DATABASE_URL" -f prisma/migrations/add_strategic_indexes.sql
--   If you apply it through a transaction-wrapping runner, remove the
--   CONCURRENTLY keywords first.

-- ── streams: (sender, status, createdAt DESC) ────────────────────────────────
-- Powers the owner dashboard: a user's most recent streams filtered by status.
-- ("sender" is the stream owner; the schema has no separate userId column.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Stream_sender_status_createdAt_idx"
    ON "Stream" ("sender", "status", "createdAt" DESC);

-- ── events: (contract_id, ledger_sequence DESC) ──────────────────────────────
-- Newest-first event scans per contract. Replaces the existing ascending
-- composite so the index order matches the dominant ORDER BY ... DESC queries.
DROP INDEX CONCURRENTLY IF EXISTS "ContractEvent_contract_id_ledger_sequence_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ContractEvent_contract_id_ledger_sequence_idx"
    ON "ContractEvent" ("contract_id", "ledger_sequence" DESC);

-- ── audit_logs: (streamId, createdAt DESC) ───────────────────────────────────
-- Stream audit trail, newest entries first. (EventLog is the audit-log table.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EventLog_streamId_createdAt_idx"
    ON "EventLog" ("streamId", "createdAt" DESC);

-- ── disbursements: (batch_id, status) ────────────────────────────────────────
-- The Disbursement table had no batch concept; add a nullable batch_id that the
-- batch processing engine (#1202) populates, then index it with status for
-- per-batch progress/status lookups. Nullable + no default => instant DDL.
ALTER TABLE "Disbursement" ADD COLUMN IF NOT EXISTS "batch_id" TEXT;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Disbursement_batch_id_status_idx"
    ON "Disbursement" ("batch_id", "status");

-- ── (contractId, ledger) UNIQUE — intentionally NOT added ─────────────────────
-- The issue asks for UNIQUE (contractId, ledger) on events, but a single
-- contract routinely emits MANY events in the same ledger, so this constraint
-- would reject valid events and break ingestion. Event idempotency is already
-- guaranteed by the existing constraints:
--     UNIQUE ("tx_hash", "event_index")   -- ContractEvent_tx_hash_event_index_key
--     UNIQUE ("event_id")                 -- ContractEvent_event_id_key
-- If a one-row-per-ledger uniqueness is genuinely required, it belongs on a
-- ledger-keyed table (e.g. LedgerHash.sequence, which is already a PK), not on
-- the events table. Add it explicitly here only after confirming the intent.
