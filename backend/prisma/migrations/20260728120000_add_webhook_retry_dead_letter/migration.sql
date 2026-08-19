-- Migration: Webhook Retry Logic & Dead Letter Queue (Issue #1348)
--
-- 1. Adds the missing Webhook <- WebhookDelivery foreign key. Without it the
--    dispatcher's `include: { webhook: true }` query fails at runtime, which
--    meant no queued delivery was ever retried.
-- 2. Adds per-attempt observability columns (status code, timestamps) backing
--    the retry dashboard.
-- 3. Adds claim columns (lockedAt / lockedBy) so concurrent workers cannot
--    dispatch the same delivery twice.
-- 4. Renames the terminal `failed` status to `dead_letter`.
--
-- The Webhook / WebhookDelivery tables were introduced by a loose SQL file
-- (add_webhooks_dust_affiliates.sql) that `prisma migrate deploy` never
-- applies, so both tables are created here when absent. Every statement is
-- idempotent, making this migration safe against databases that already ran
-- the loose file as well as against a freshly provisioned one.

CREATE TABLE IF NOT EXISTS "Webhook" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "url"         TEXT NOT NULL,
  "description" TEXT,
  "eventType"   TEXT NOT NULL DEFAULT '*',
  "secretKey"   TEXT NOT NULL DEFAULT '',
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Webhook_url_key" ON "Webhook"("url");
CREATE INDEX IF NOT EXISTS "Webhook_eventType_idx" ON "Webhook"("eventType");
CREATE INDEX IF NOT EXISTS "Webhook_isActive_idx" ON "Webhook"("isActive");

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "webhookId"   TEXT NOT NULL,
  "eventType"   TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "maxRetries"  INTEGER NOT NULL DEFAULT 5,
  "nextRetryAt" TIMESTAMP(3),
  "lastError"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "WebhookDelivery_webhookId_status_idx"
  ON "WebhookDelivery"("webhookId", "status");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_nextRetryAt_idx"
  ON "WebhookDelivery"("nextRetryAt");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_createdAt_idx"
  ON "WebhookDelivery"("createdAt");

-- ── Retry / dead letter columns ──────────────────────────────────────────────

ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "lastStatusCode" INTEGER;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "deadLetterReason" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "lockedBy" TEXT;

-- Existing terminal failures become the initial dead letter queue contents.
UPDATE "WebhookDelivery"
SET "status" = 'dead_letter',
    "deadLetteredAt" = COALESCE("deadLetteredAt", "updatedAt"),
    "deadLetterReason" = COALESCE("deadLetterReason", 'retries_exhausted')
WHERE "status" = 'failed';

-- Deliveries left mid-flight have no claim owner; return them to the queue.
UPDATE "WebhookDelivery"
SET "status" = 'pending',
    "nextRetryAt" = COALESCE("nextRetryAt", CURRENT_TIMESTAMP),
    "lockedAt" = NULL,
    "lockedBy" = NULL
WHERE "status" = 'delivering';

-- ── Foreign key ──────────────────────────────────────────────────────────────

-- Drop orphaned deliveries first, otherwise the constraint cannot validate on
-- databases that accumulated rows while the relation was missing.
DELETE FROM "WebhookDelivery" wd
WHERE NOT EXISTS (
  SELECT 1 FROM "Webhook" w WHERE w."id" = wd."webhookId"
);

ALTER TABLE "WebhookDelivery"
  DROP CONSTRAINT IF EXISTS "WebhookDelivery_webhookId_fkey";

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_nextRetryAt_idx"
  ON "WebhookDelivery"("status", "nextRetryAt");

CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_lockedAt_idx"
  ON "WebhookDelivery"("status", "lockedAt");
