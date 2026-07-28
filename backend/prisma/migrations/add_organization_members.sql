-- Migration: Add OrganizationMember table for role-based membership
-- Roles: DRAFTER, APPROVER, EXECUTOR
-- This table maps individual Stellar addresses to organizations with assigned roles

-- Create OrgRole enum type
CREATE TYPE "OrgRole" AS ENUM ('DRAFTER', 'APPROVER', 'EXECUTOR');

-- Create OrganizationMember table with foreign key to Organization
CREATE TABLE "OrganizationMember" (
  "id"              TEXT        NOT NULL,
  "organization_id" TEXT        NOT NULL,  -- Foreign key to Organization table
  "orgAddress"      TEXT        NOT NULL,  -- Organization's G-address (denormalized for reference)
  "memberAddress"   TEXT        NOT NULL,  -- Individual member's Stellar address
  "role"            "OrgRole"   NOT NULL,  -- DRAFTER, APPROVER, or EXECUTOR
  "addedBy"         TEXT        NOT NULL,  -- Address of the member who granted this membership
  "is_active"       BOOLEAN     NOT NULL DEFAULT true,
  "last_activity_at" TIMESTAMP(3),         -- Timestamp of last activity
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMember_organization_id_fkey" 
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- Unique constraint: each member can only have one role per organization
CREATE UNIQUE INDEX "OrganizationMember_organization_id_memberAddress_key"
  ON "OrganizationMember"("organization_id", "memberAddress");

-- Indexes for common queries
CREATE INDEX "OrganizationMember_organization_id_idx"  ON "OrganizationMember"("organization_id");
CREATE INDEX "OrganizationMember_memberAddress_idx"    ON "OrganizationMember"("memberAddress");
CREATE INDEX "OrganizationMember_role_idx"             ON "OrganizationMember"("role");
