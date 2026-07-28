-- Organization Management Migration Rollback Script
-- 
-- This script safely removes all tables and types created by the 
-- organization management feature migration.
--
-- WARNING: This is a destructive operation that will permanently delete:
--   - All organization records and metadata
--   - All team member associations
--   - All invitation tokens
--   - All policy configurations
--   - All billing records
--   - All multisig proposals
--   - All audit log entries
--
-- Ensure a backup has been created before executing this script.
-- 
-- Execution: psql $DATABASE_URL < rollback-org-management.sql
-- 
-- Rollback Order (respecting foreign key constraints):
-- 1. Drop indexes on dependent tables
-- 2. Drop foreign key constraints
-- 3. Drop dependent tables (AuditLog, MultisigProposal, BillingRecord, 
--    OrganizationPolicy, Invitation, OrganizationMember)
-- 4. Drop parent table (Organization)
-- 5. Drop enum type (OrgRole)

-- ============================================================================
-- STAGE 1: Drop Dependent Tables (in reverse order of creation)
-- ============================================================================

-- Drop AuditLog table (immutable audit trail)
-- No other tables depend on this
DROP TABLE IF EXISTS "AuditLog" CASCADE;

-- Drop MultisigProposal table (multi-signature transactions)
-- No other tables depend on this
DROP TABLE IF EXISTS "MultisigProposal" CASCADE;

-- Drop BillingRecord table (usage tracking and billing)
-- No other tables depend on this
DROP TABLE IF EXISTS "BillingRecord" CASCADE;

-- Drop OrganizationPolicy table (spending limits and asset controls)
-- No other tables depend on this
DROP TABLE IF EXISTS "OrganizationPolicy" CASCADE;

-- Drop Invitation table (team member invitations)
-- No other tables depend on this
DROP TABLE IF EXISTS "Invitation" CASCADE;

-- Drop OrganizationMember table (team members and their roles)
-- Parent: Organization
DROP TABLE IF EXISTS "OrganizationMember" CASCADE;

-- ============================================================================
-- STAGE 2: Drop Parent Table
-- ============================================================================

-- Drop Organization table (core organization records)
-- All child tables already removed above
DROP TABLE IF EXISTS "Organization" CASCADE;

-- ============================================================================
-- STAGE 3: Drop Enum Type
-- ============================================================================

-- Drop OrgRole enum type (role-based access control)
-- This enum is no longer used after tables are dropped
DROP TYPE IF EXISTS "OrgRole" CASCADE;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- The following queries can be run to verify successful rollback:
-- 
-- SELECT COUNT(*) FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name IN ('Organization', 'OrganizationMember', 'Invitation', 
--                      'OrganizationPolicy', 'BillingRecord', 
--                      'MultisigProposal', 'AuditLog');
-- Should return: 0
--
-- SELECT COUNT(*) FROM information_schema.schemata 
-- WHERE schema_name = 'public' 
--   AND EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrgRole');
-- Should return: 0 or empty result

-- ============================================================================
-- END OF ROLLBACK SCRIPT
-- ============================================================================
-- 
-- Rollback completed. All organization management tables and types removed.
--
-- If rollback was executed unintentionally, restore from backup:
--   psql $DATABASE_URL < backup-before-rollback-YYYYMMDD-HHMMSS.sql
--
-- To re-apply the migration after rollback:
--   npx prisma migrate dev
--   OR
--   psql $DATABASE_URL < add_organization_management.sql
