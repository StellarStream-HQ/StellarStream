#!/bin/bash

# Rollback Test Script for Organization Management Migrations
#
# This script tests the rollback procedure in a development environment
# to ensure safe execution in production.
#
# Usage: ./test-rollback.sh [test_db_name]
# Example: ./test-rollback.sh stellarstream_test_rollback
#
# Prerequisites:
#   - PostgreSQL server running and accessible
#   - psql command-line tool installed
#   - DATABASE_URL set to a test database or use temporary test database
#   - Backup of production database (always!)
#
# This script:
# 1. Creates a test database
# 2. Applies all organization management migrations
# 3. Seeds test data
# 4. Verifies pre-rollback state
# 5. Executes rollback
# 6. Verifies post-rollback state
# 7. Cleans up test database
#
# Exit Codes:
#   0 - Test passed, rollback successful
#   1 - Test failed, check output for errors

set -euo pipefail

# Configuration
TEST_DB="${1:-stellarstream_test_rollback}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_LOG="/tmp/rollback-test-${TEST_DB}-$$.log"
COLORS_ENABLED=true

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
  if [ "$COLORS_ENABLED" = true ]; then
    echo -e "${BLUE}[INFO]${NC} $*" | tee -a "$TEMP_LOG"
  else
    echo "[INFO] $*" | tee -a "$TEMP_LOG"
  fi
}

log_success() {
  if [ "$COLORS_ENABLED" = true ]; then
    echo -e "${GREEN}[✓]${NC} $*" | tee -a "$TEMP_LOG"
  else
    echo "[✓] $*" | tee -a "$TEMP_LOG"
  fi
}

log_warning() {
  if [ "$COLORS_ENABLED" = true ]; then
    echo -e "${YELLOW}[WARNING]${NC} $*" | tee -a "$TEMP_LOG"
  else
    echo "[WARNING] $*" | tee -a "$TEMP_LOG"
  fi
}

log_error() {
  if [ "$COLORS_ENABLED" = true ]; then
    echo -e "${RED}[ERROR]${NC} $*" | tee -a "$TEMP_LOG"
  else
    echo "[ERROR] $*" | tee -a "$TEMP_LOG"
  fi
}

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  local test_name=$1
  local test_command=$2
  
  TESTS_RUN=$((TESTS_RUN + 1))
  log_info "Test $TESTS_RUN: $test_name"
  
  if eval "$test_command" >> "$TEMP_LOG" 2>&1; then
    log_success "$test_name"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_error "$test_name"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# ============================================================================
# TEST SETUP
# ============================================================================

log_info "Organization Management Rollback Test Suite"
log_info "============================================"
log_info ""
log_info "Test Configuration:"
log_info "  Test Database: $TEST_DB"
log_info "  Script Directory: $SCRIPT_DIR"
log_info "  Log File: $TEMP_LOG"
log_info ""

# Check PostgreSQL availability
log_info "Verifying PostgreSQL connectivity..."
if ! psql -U postgres -c "SELECT version();" > /dev/null 2>&1; then
  log_error "Cannot connect to PostgreSQL. Ensure server is running."
  exit 1
fi
log_success "PostgreSQL is accessible"

# ============================================================================
# STAGE 1: CREATE TEST DATABASE
# ============================================================================

log_info ""
log_info "STAGE 1: Test Database Setup"
log_info "=============================="

# Drop test database if it exists
log_info "Dropping existing test database (if exists)..."
psql -U postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE);" 2>/dev/null || true

# Create test database
run_test "Create test database" \
  "psql -U postgres -c \"CREATE DATABASE \\\"$TEST_DB\\\";\""

if [ $? -ne 0 ]; then
  log_error "Failed to create test database"
  exit 1
fi

# Set DATABASE_URL for test database
export TEST_DATABASE_URL="postgresql://postgres@localhost/$TEST_DB"
log_info "TEST_DATABASE_URL=$TEST_DATABASE_URL"

# ============================================================================
# STAGE 2: APPLY FORWARD MIGRATIONS
# ============================================================================

log_info ""
log_info "STAGE 2: Apply Forward Migrations"
log_info "=================================="

log_info "Applying organization management migration..."
if psql "$TEST_DATABASE_URL" < "${SCRIPT_DIR}/../add_organization_management.sql" > /dev/null 2>&1; then
  log_success "Organization management migration applied"
else
  log_error "Failed to apply migration"
  psql -U postgres -c "DROP DATABASE \"$TEST_DB\" WITH (FORCE);" 2>/dev/null || true
  exit 1
fi

# ============================================================================
# STAGE 3: VERIFY PRE-ROLLBACK STATE
# ============================================================================

log_info ""
log_info "STAGE 3: Verify Pre-Rollback State"
log_info "=================================="

# Verify tables exist
run_test "Organization table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"Organization\\\"\" | grep -q Organization"

run_test "OrganizationMember table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"OrganizationMember\\\"\" | grep -q OrganizationMember"

run_test "Invitation table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"Invitation\\\"\" | grep -q Invitation"

run_test "OrganizationPolicy table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"OrganizationPolicy\\\"\" | grep -q OrganizationPolicy"

run_test "BillingRecord table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"BillingRecord\\\"\" | grep -q BillingRecord"

run_test "MultisigProposal table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"MultisigProposal\\\"\" | grep -q MultisigProposal"

run_test "AuditLog table exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"AuditLog\\\"\" | grep -q AuditLog"

# Verify OrgRole enum exists
run_test "OrgRole enum type exists" \
  "psql \"$TEST_DATABASE_URL\" -c \"\\dT \\\"OrgRole\\\"\" | grep -q OrgRole"

# ============================================================================
# STAGE 4: SEED TEST DATA
# ============================================================================

log_info ""
log_info "STAGE 4: Seed Test Data"
log_info "======================"

log_info "Inserting test data into organization tables..."

psql "$TEST_DATABASE_URL" << 'SEED_SQL' >> "$TEMP_LOG" 2>&1
-- Insert test organization
INSERT INTO "Organization" (id, "gAddress", name, description, "createdBy", "is_active")
VALUES ('org-test-1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'Test Org', 'Test Organization', 'GTEST1', true);

-- Insert test member
INSERT INTO "OrganizationMember" (id, organization_id, "orgAddress", "memberAddress", role, "addedBy", "is_active")
VALUES ('member-1', 'org-test-1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', 'GTEST1', 'EXECUTOR', 'GTEST1', true);

-- Insert test invitation
INSERT INTO "Invitation" (id, organization_id, invitee_email, role, token_hash, status, "expires_at", "invited_by")
VALUES ('inv-1', 'org-test-1', 'test@example.com', 'APPROVER', 'abc123', 'PENDING', NOW() + interval '7 days', 'GTEST1');

-- Insert test policy
INSERT INTO "OrganizationPolicy" (id, organization_id, "daily_spend_limit_usd", "requires_multisig")
VALUES ('policy-1', 'org-test-1', 10000.00, false);

-- Insert test billing record
INSERT INTO "BillingRecord" (id, organization_id, billing_period, "streams_created", "disbursements_processed", "api_requests", volume_usd, charge_usd, plan, status)
VALUES ('bill-1', 'org-test-1', '2025-01', 5, 10, 100, 5000.00, 100.00, 'FREE', 'ACTIVE');

-- Insert test multisig proposal
INSERT INTO "MultisigProposal" (id, proposal_id, organization_id, transaction_xdr, required_signers, status, "expires_at")
VALUES ('prop-1', 'prop-123', 'org-test-1', 'AAAAAgAAA...', 2, 'PENDING', NOW() + interval '7 days');

-- Insert test audit log entry
INSERT INTO "AuditLog" (id, organization_id, action_type, actor, resource_id, resource_type)
VALUES ('log-1', 'org-test-1', 'create', 'GTEST1', 'org-test-1', 'organization');
SEED_SQL

run_test "Test data inserted successfully" \
  "psql \"$TEST_DATABASE_URL\" -c \"SELECT COUNT(*) FROM \\\"Organization\\\"\" | grep -q 1"

log_info "Verifying test data row counts..."
psql "$TEST_DATABASE_URL" << 'VERIFY_SQL' | tee -a "$TEMP_LOG"
SELECT 'Organization' as table_name, COUNT(*) as row_count FROM "Organization"
UNION ALL
SELECT 'OrganizationMember', COUNT(*) FROM "OrganizationMember"
UNION ALL
SELECT 'Invitation', COUNT(*) FROM "Invitation"
UNION ALL
SELECT 'OrganizationPolicy', COUNT(*) FROM "OrganizationPolicy"
UNION ALL
SELECT 'BillingRecord', COUNT(*) FROM "BillingRecord"
UNION ALL
SELECT 'MultisigProposal', COUNT(*) FROM "MultisigProposal"
UNION ALL
SELECT 'AuditLog', COUNT(*) FROM "AuditLog";
VERIFY_SQL

# ============================================================================
# STAGE 5: EXECUTE ROLLBACK
# ============================================================================

log_info ""
log_info "STAGE 5: Execute Rollback"
log_info "=========================="

log_info "Executing rollback script..."
if psql "$TEST_DATABASE_URL" < "${SCRIPT_DIR}/rollback-org-management.sql" >> "$TEMP_LOG" 2>&1; then
  log_success "Rollback script executed successfully"
else
  log_error "Rollback script failed"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# ============================================================================
# STAGE 6: VERIFY POST-ROLLBACK STATE
# ============================================================================

log_info ""
log_info "STAGE 6: Verify Post-Rollback State"
log_info "===================================="

# Verify tables are removed
run_test "Organization table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"Organization\\\"\" 2>&1 | grep -q Organization"

run_test "OrganizationMember table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"OrganizationMember\\\"\" 2>&1 | grep -q OrganizationMember"

run_test "Invitation table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"Invitation\\\"\" 2>&1 | grep -q Invitation"

run_test "OrganizationPolicy table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"OrganizationPolicy\\\"\" 2>&1 | grep -q OrganizationPolicy"

run_test "BillingRecord table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"BillingRecord\\\"\" 2>&1 | grep -q BillingRecord"

run_test "MultisigProposal table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"MultisigProposal\\\"\" 2>&1 | grep -q MultisigProposal"

run_test "AuditLog table removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dt \\\"AuditLog\\\"\" 2>&1 | grep -q AuditLog"

# Verify OrgRole enum is removed
run_test "OrgRole enum type removed" \
  "! psql \"$TEST_DATABASE_URL\" -c \"\\dT\" 2>&1 | grep -q OrgRole"

# ============================================================================
# STAGE 7: RUN VERIFICATION SCRIPT
# ============================================================================

log_info ""
log_info "STAGE 7: Run Verification Script"
log_info "==============================="

log_info "Running verification script..."
if psql "$TEST_DATABASE_URL" < "${SCRIPT_DIR}/verify-tables-removed.sql" >> "$TEMP_LOG" 2>&1; then
  log_success "Verification script completed"
else
  log_warning "Verification script had issues (may be expected)"
fi

# ============================================================================
# STAGE 8: CLEANUP
# ============================================================================

log_info ""
log_info "STAGE 8: Cleanup"
log_info "==============="

log_info "Dropping test database..."
if psql -U postgres -c "DROP DATABASE \"$TEST_DB\" WITH (FORCE);" 2>/dev/null; then
  log_success "Test database dropped"
else
  log_warning "Could not drop test database (may already be cleaned up)"
fi

# ============================================================================
# TEST RESULTS
# ============================================================================

log_info ""
log_info "Test Results"
log_info "============"
log_info "Tests Run: $TESTS_RUN"
log_info "Tests Passed: $TESTS_PASSED"
log_info "Tests Failed: $TESTS_FAILED"

if [ $TESTS_FAILED -eq 0 ]; then
  log_success ""
  log_success "ALL TESTS PASSED!"
  log_success ""
  log_info "Full log available at: $TEMP_LOG"
  exit 0
else
  log_error ""
  log_error "SOME TESTS FAILED"
  log_error ""
  log_info "Full log available at: $TEMP_LOG"
  log_info "View log with: cat $TEMP_LOG"
  exit 1
fi
