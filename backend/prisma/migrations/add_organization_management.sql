-- Create OrgRole enum type
CREATE TYPE "OrgRole" AS ENUM ('DRAFTER', 'APPROVER', 'EXECUTOR');

-- Create Organization table
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gAddress" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "custom_domain" TEXT,
    "contact_email" TEXT,
    "createdBy" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for Organization table
CREATE INDEX "Organization_gAddress_idx" ON "Organization"("gAddress");
CREATE INDEX "Organization_createdBy_idx" ON "Organization"("createdBy");
CREATE INDEX "Organization_is_active_idx" ON "Organization"("is_active");

-- Create OrganizationMember table
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "orgAddress" TEXT NOT NULL,
    "memberAddress" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "addedBy" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMember_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for OrganizationMember table
CREATE UNIQUE INDEX "OrganizationMember_organization_id_memberAddress_key" ON "OrganizationMember"("organization_id", "memberAddress");
CREATE INDEX "OrganizationMember_organization_id_idx" ON "OrganizationMember"("organization_id");
CREATE INDEX "OrganizationMember_memberAddress_idx" ON "OrganizationMember"("memberAddress");
CREATE INDEX "OrganizationMember_role_idx" ON "OrganizationMember"("role");

-- Create Invitation table
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "token_hash" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_by" TEXT,
    "accepted_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "invited_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for Invitation table
CREATE INDEX "Invitation_organization_id_idx" ON "Invitation"("organization_id");
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");
CREATE INDEX "Invitation_expires_at_idx" ON "Invitation"("expires_at");

-- Create OrganizationPolicy table
CREATE TABLE "OrganizationPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL UNIQUE,
    "daily_spend_limit_usd" DECIMAL(18, 2),
    "allowed_assets" TEXT,
    "requires_multisig" BOOLEAN NOT NULL DEFAULT false,
    "multisig_threshold" INTEGER,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationPolicy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for OrganizationPolicy table
CREATE INDEX "OrganizationPolicy_organization_id_idx" ON "OrganizationPolicy"("organization_id");

-- Create BillingRecord table
CREATE TABLE "BillingRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "billing_period" TEXT NOT NULL,
    "streams_created" INTEGER NOT NULL DEFAULT 0,
    "disbursements_processed" INTEGER NOT NULL DEFAULT 0,
    "api_requests" INTEGER NOT NULL DEFAULT 0,
    "volume_usd" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "charge_usd" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingRecord_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for BillingRecord table
CREATE UNIQUE INDEX "BillingRecord_organization_id_billing_period_key" ON "BillingRecord"("organization_id", "billing_period");
CREATE INDEX "BillingRecord_organization_id_idx" ON "BillingRecord"("organization_id");
CREATE INDEX "BillingRecord_billing_period_idx" ON "BillingRecord"("billing_period");

-- Create MultisigProposal table
CREATE TABLE "MultisigProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposal_id" TEXT NOT NULL UNIQUE,
    "organization_id" TEXT NOT NULL,
    "description" TEXT,
    "transaction_xdr" TEXT NOT NULL,
    "signatures" JSONB NOT NULL DEFAULT '[]',
    "required_signers" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submitted_tx_hash" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MultisigProposal_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for MultisigProposal table
CREATE INDEX "MultisigProposal_organization_id_idx" ON "MultisigProposal"("organization_id");
CREATE INDEX "MultisigProposal_status_idx" ON "MultisigProposal"("status");
CREATE INDEX "MultisigProposal_proposal_id_idx" ON "MultisigProposal"("proposal_id");
CREATE INDEX "MultisigProposal_created_at_idx" ON "MultisigProposal"("created_at");

-- Create AuditLog table
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "changes" JSONB,
    "entry_hash" TEXT,
    "parent_hash" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization" ("id") ON DELETE CASCADE
);

-- Create indexes for AuditLog table
CREATE INDEX "AuditLog_organization_id_idx" ON "AuditLog"("organization_id");
CREATE INDEX "AuditLog_action_type_idx" ON "AuditLog"("action_type");
CREATE INDEX "AuditLog_actor_idx" ON "AuditLog"("actor");
CREATE INDEX "AuditLog_created_at_organization_id_idx" ON "AuditLog"("created_at", "organization_id");
CREATE INDEX "AuditLog_resource_id_idx" ON "AuditLog"("resource_id");
