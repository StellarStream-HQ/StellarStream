-- #1148 — Verification harness for the strategic indexes.
--
-- Runs EXPLAIN ANALYZE on the four query shapes the indexes target so you can
-- confirm the planner switched from a Seq Scan to an Index Scan and measure the
-- improvement (target: >= 50% lower execution time on a populated database).
--
-- Usage:
--   1. Capture a baseline BEFORE applying the migration:
--        psql "$DATABASE_URL" -f backend/scripts/verify-strategic-indexes.sql > before.txt
--   2. Apply the migration:
--        psql "$DATABASE_URL" -f backend/prisma/migrations/add_strategic_indexes.sql
--   3. Re-run and compare:
--        psql "$DATABASE_URL" -f backend/scripts/verify-strategic-indexes.sql > after.txt
--        diff before.txt after.txt
--
-- Look for: "Seq Scan" (before) -> "Index Scan"/"Index Only Scan" (after) and a
-- lower "Execution Time".

\timing on

-- Replace the literals below with values that exist in your dataset.
\set sample_sender    '''GSAMPLESENDERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'''
\set sample_contract  '''CSAMPLECONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'''
\set sample_stream    '''stream-sample-id'''
\set sample_batch     '''batch-sample-id'''

-- ── streams: latest ACTIVE streams for an owner ──────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Stream"
WHERE "sender" = :sample_sender
  AND "status" = 'ACTIVE'
ORDER BY "createdAt" DESC
LIMIT 50;

-- ── events: newest events for a contract ─────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "ContractEvent"
WHERE "contract_id" = :sample_contract
ORDER BY "ledger_sequence" DESC
LIMIT 100;

-- ── audit_logs: newest audit entries for a stream ────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "EventLog"
WHERE "streamId" = :sample_stream
ORDER BY "createdAt" DESC
LIMIT 100;

-- ── disbursements: items in a batch by status ────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM "Disbursement"
WHERE "batch_id" = :sample_batch
  AND "status" = 'PENDING';

\timing off
