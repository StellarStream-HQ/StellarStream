-- Migration: add_organization_policy (#844)
-- Stores per-organisation spend limits and asset whitelists.

CREATE TABLE IF NOT EXISTS "OrganizationPolicy" (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id         TEXT NOT NULL UNIQUE,
  daily_spend_limit_usd   NUMERIC,          -- NULL = unlimited
  allowed_assets          TEXT,             -- JSON array of asset addresses; NULL = all allowed
  requires_multisig       BOOLEAN NOT NULL DEFAULT false,
  multisig_threshold      INTEGER,          -- NULL if multisig not required
  updated_by              TEXT,             -- Address of who updated the policy
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_org_policy_organization 
    FOREIGN KEY (organization_id) 
    REFERENCES "Organization"(id) 
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_policy_organization_id ON "OrganizationPolicy" (organization_id);
