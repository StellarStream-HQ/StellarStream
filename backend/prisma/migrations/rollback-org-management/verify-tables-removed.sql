-- Verification Script: Organization Management Rollback Verification
--
-- This script verifies that the organization management tables and types
-- have been successfully removed from the database.
--
-- Execution: psql $DATABASE_URL -f verify-tables-removed.sql
--
-- Expected Output: All tables and types should NOT be found (empty results)

-- ============================================================================
-- VERIFY TABLE REMOVAL
-- ============================================================================

\echo '==== ORGANIZATION MANAGEMENT TABLE VERIFICATION ===='
\echo ''

-- Check if Organization table exists
\echo 'Checking Organization table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'Organization';

-- Check if OrganizationMember table exists
\echo 'Checking OrganizationMember table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'OrganizationMember';

-- Check if Invitation table exists
\echo 'Checking Invitation table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'Invitation';

-- Check if OrganizationPolicy table exists
\echo 'Checking OrganizationPolicy table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'OrganizationPolicy';

-- Check if BillingRecord table exists
\echo 'Checking BillingRecord table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'BillingRecord';

-- Check if MultisigProposal table exists
\echo 'Checking MultisigProposal table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'MultisigProposal';

-- Check if AuditLog table exists
\echo 'Checking AuditLog table...'
SELECT 
  table_name, 
  'FOUND - ROLLBACK INCOMPLETE' as status 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'AuditLog';

-- ============================================================================
-- VERIFY ENUM TYPE REMOVAL
-- ============================================================================

\echo ''
\echo '==== ENUM TYPE VERIFICATION ===='
\echo ''

-- Check if OrgRole enum exists
\echo 'Checking OrgRole enum type...'
SELECT 
  typname,
  'FOUND - ROLLBACK INCOMPLETE' as status
FROM pg_type 
WHERE typname = 'OrgRole' AND typtype = 'e';

-- ============================================================================
-- VERIFY INDEX REMOVAL
-- ============================================================================

\echo ''
\echo '==== INDEX VERIFICATION ===='
\echo ''

-- Check for any remaining org-related indexes
\echo 'Checking for remaining org-related indexes...'
SELECT 
  indexname,
  'FOUND - MAY NEED CLEANUP' as status
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE '%rgani%' 
OR indexname LIKE '%ultisig%' 
OR indexname LIKE '%nvitation%' 
OR indexname LIKE '%illingRecord%' 
OR indexname LIKE '%uditLog%';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '==== VERIFICATION SUMMARY ===='
\echo ''
\echo 'If all result sets above are empty, rollback was successful.'
\echo ''
\echo 'Table Summary:'
SELECT 
  COUNT(*) as remaining_org_tables
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('Organization', 'OrganizationMember', 'Invitation', 
                   'OrganizationPolicy', 'BillingRecord', 
                   'MultisigProposal', 'AuditLog');

\echo ''
\echo '==== END VERIFICATION ===='
