-- Migration: Add Invitation table for token-based invitations

-- Ensure OrgRole enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrgRole') THEN
    CREATE TYPE "OrgRole" AS ENUM ('DRAFTER', 'APPROVER', 'EXECUTOR');
  END IF;
END
$$;

-- Create Invitation table for token-based team member invitations
-- Stores invitation state including tokenHash, expiration, and acceptance tracking
CREATE TABLE IF NOT EXISTS "Invitation" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "invitee_email"   TEXT NOT NULL,
  "role"            "OrgRole" NOT NULL,
  "token_hash"      TEXT NOT NULL UNIQUE,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at"      TIMESTAMPTZ NOT NULL,
  "accepted_by"     TEXT,
  "accepted_at"     TIMESTAMPTZ,
  "revoked_by"      TEXT,
  "revoked_at"      TIMESTAMPTZ,
  "invited_by"      TEXT NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on organization_id for looking up invitations by organization
CREATE INDEX IF NOT EXISTS "Invitation_organization_id_idx" ON "Invitation"("organization_id");

-- Index on status for efficient filtering of PENDING/ACCEPTED/EXPIRED/REVOKED invitations
CREATE INDEX IF NOT EXISTS "Invitation_status_idx" ON "Invitation"("status");

-- Index on expires_at for cleanup queries (finding expired invitations to mark as EXPIRED)
CREATE INDEX IF NOT EXISTS "Invitation_expires_at_idx" ON "Invitation"("expires_at");

-- Ensure token_hash uniqueness is enforced (unique constraint already on column definition)
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_token_hash_unique_idx" ON "Invitation"("token_hash");
