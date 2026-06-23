-- Add StreamTemplate table for reusable stream configurations (#1185)
CREATE TABLE "stream_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "recipient_address" TEXT NOT NULL,
  "split_enabled" BOOLEAN NOT NULL DEFAULT false,
  "split_address" TEXT,
  "split_percent" INTEGER NOT NULL DEFAULT 0,
  "total_amount" TEXT NOT NULL,
  "rate_type" TEXT NOT NULL,
  "duration_preset" TEXT NOT NULL,
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "stream_templates_createdBy_idx" ON "stream_templates"("created_by");
CREATE INDEX "stream_templates_usageCount_idx" ON "stream_templates"("usage_count");
