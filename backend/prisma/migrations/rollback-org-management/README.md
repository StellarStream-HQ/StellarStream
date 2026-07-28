# Organization Management Migration Rollback Resources

This directory contains comprehensive documentation and scripts for rolling back the Organization Management feature migrations in StellarStream.

## Contents

### Documentation

#### `ROLLBACK_PROCEDURE.md` (Primary Reference)
Complete procedural documentation for safely rolling back organization management tables. Includes:
- Overview of migration components
- Two-stage rollback strategy
- Detailed data loss implications
- Manual rollback procedures
- Testing procedures for development
- Recovery and emergency procedures
- FAQ and troubleshooting

**When to use:** Before executing any rollback operations, review this document thoroughly.

### SQL Scripts

#### `rollback-org-management.sql` (Production Rollback)
The main SQL script that removes all organization management tables and types. This script:
- Respects foreign key dependencies
- Removes tables in correct order: AuditLog → MultisigProposal → BillingRecord → OrganizationPolicy → Invitation → OrganizationMember → Organization
- Drops OrgRole enum type
- Includes inline documentation

**When to use:** Execute this after creating a full database backup in production or development rollback scenarios.

**How to use:**
```bash
# Connect to database and execute
psql $DATABASE_URL < rollback-org-management.sql

# Or with environment variable
psql < rollback-org-management.sql
```

#### `verify-tables-removed.sql` (Verification)
Verification script that confirms successful rollback by checking:
- All 7 organization tables are removed
- OrgRole enum type is removed
- Remaining organization-related indexes (if any)
- Summary of tables remaining

**When to use:** After executing rollback script to confirm success.

**How to use:**
```bash
psql $DATABASE_URL -f verify-tables-removed.sql
```

### Bash Scripts

#### `backup-org-data.sh` (Data Backup)
Automated bash script to backup all organization management tables before rollback. This script:
- Exports each table to CSV format with headers
- Creates complete SQL dump for recovery
- Generates backup manifest with row counts
- Creates restore script for convenience

**When to use:** Execute this BEFORE any rollback operation to preserve data.

**How to use:**
```bash
# Make script executable
chmod +x backup-org-data.sh

# Run backup (creates backup-org-YYYYMMDD-HHMMSS directory)
./backup-org-data.sh

# Or specify custom backup directory
./backup-org-data.sh ./my-backup-directory

# View backup contents
ls -la backup-org-*/

# Restore from backup (after forward migration reapplied)
cd backup-org-*/
chmod +x restore-backup.sh
./restore-backup.sh
```

#### `test-rollback.sh` (Development Testing)
Comprehensive test script for validating rollback procedure in development. This script:
- Creates temporary test database
- Applies forward migrations
- Seeds test data
- Executes rollback
- Verifies post-rollback state
- Provides detailed test results
- Cleans up test database

**When to use:** Before executing rollback in production, run this in development to verify procedure.

**How to use:**
```bash
# Make script executable
chmod +x test-rollback.sh

# Run with default test database name
./test-rollback.sh

# Or specify custom test database name
./test-rollback.sh custom_test_db_name

# View results during execution
tail -f /tmp/rollback-test-*.log
```

## Quick Reference

### Pre-Rollback Checklist

- [ ] Read `ROLLBACK_PROCEDURE.md` completely
- [ ] Execute `backup-org-data.sh` to backup all tables
- [ ] Run `test-rollback.sh` in development environment
- [ ] Verify test results pass (all tests green)
- [ ] Create full database backup: `pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql`
- [ ] Schedule maintenance window
- [ ] Notify dependent services
- [ ] Get approval from DBA/management

### Rollback Execution

1. **Backup Data**
   ```bash
   ./backup-org-data.sh
   ```

2. **Create Database Backup**
   ```bash
   pg_dump $DATABASE_URL > backup-before-rollback-$(date +%Y%m%d-%H%M%S).sql
   ```

3. **Execute Rollback**
   ```bash
   psql $DATABASE_URL < rollback-org-management.sql
   ```

4. **Verify Rollback**
   ```bash
   psql $DATABASE_URL -f verify-tables-removed.sql
   ```

5. **Restart Application**
   ```bash
   # Restart application services
   systemctl restart stellarstream
   ```

### Recovery from Backup

1. **Re-apply Forward Migration**
   ```bash
   npx prisma migrate dev
   # OR
   psql $DATABASE_URL < ../add_organization_management.sql
   ```

2. **Restore Data**
   ```bash
   cd backup-org-YYYYMMDD-HHMMSS/
   ./restore-backup.sh
   ```

## Tables Affected by Rollback

| Table | Purpose | Rows Deleted |
|-------|---------|--------------|
| `AuditLog` | Immutable audit trail | ❌ All |
| `MultisigProposal` | Multi-signature transactions | ❌ All |
| `BillingRecord` | Usage tracking & billing | ❌ All |
| `OrganizationPolicy` | Spending limits & policies | ❌ All |
| `Invitation` | Email invitations | ❌ All |
| `OrganizationMember` | Team member assignments | ❌ All |
| `Organization` | Organization records | ❌ All |

## Data Loss Implications

⚠️ **WARNING**: Executing rollback will permanently delete all organization management data including:
- All organizations and their metadata
- All team member assignments and roles
- All pending and historical invitations
- All organization policies and spending controls
- All usage metrics and billing records
- All multisig proposals and signatures
- All audit log entries and hash chains

**This is irreversible without backups.**

## System Impact After Rollback

After successful rollback:
- ❌ Organization features are disabled
- ❌ Multi-tenancy is removed
- ❌ Role-based access control unavailable
- ❌ Audit logging non-functional
- ❌ Billing and quota enforcement disabled
- ❌ Multisig capabilities removed
- ✅ All other StellarStream features continue functioning

## Emergency Recovery

If rollback was executed unintentionally:

1. **Stop application immediately**
   ```bash
   systemctl stop stellarstream
   ```

2. **Restore from backup**
   ```bash
   # Use the pre-rollback backup created in stage 2
   psql $DATABASE_URL < backup-before-rollback-YYYYMMDD-HHMMSS.sql
   ```

3. **Verify restoration**
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Organization\";"
   ```

4. **Restart application**
   ```bash
   systemctl start stellarstream
   ```

## File Structure

```
rollback-org-management/
├── README.md                    # This file
├── ROLLBACK_PROCEDURE.md        # Complete procedure documentation
├── rollback-org-management.sql  # Main rollback SQL script
├── verify-tables-removed.sql    # Verification SQL script
├── backup-org-data.sh           # Data backup bash script
└── test-rollback.sh             # Rollback test bash script
```

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string (format: `postgresql://user:pass@host:port/database`)

### Optional (for backup script)
- `BACKUP_DIR` - Custom backup directory (default: `./org-backup-YYYYMMDD-HHMMSS`)

### Optional (for test script)
- `TEST_DB` - Custom test database name (default: `stellarstream_test_rollback`)

## Prerequisites

### System Requirements
- PostgreSQL 10+ (tested on 12, 13, 14, 15)
- psql command-line tool installed
- Bash shell (for bash scripts)
- Read/write access to database and filesystem

### Permissions
- Database owner or admin role (for table drops and enum removal)
- Directory write permissions (for backup files)
- File execute permissions (for bash scripts): `chmod +x *.sh`

## Support and Issues

### Common Issues

**Issue: Permission denied on bash scripts**
```bash
chmod +x *.sh
./test-rollback.sh
```

**Issue: Cannot connect to database**
```bash
# Verify DATABASE_URL format
echo $DATABASE_URL
# Verify PostgreSQL is running
psql -c "SELECT version();"
```

**Issue: Foreign key constraint violations**
- Ensure tables are dropped in correct order (handled automatically by script)
- Check for orphaned references in other tables (unlikely with CASCADE constraints)

### Getting Help

1. Review `ROLLBACK_PROCEDURE.md` FAQ section
2. Check script output and logs for specific error messages
3. Contact database administrator
4. Review database logs: `tail -f /var/log/postgresql/`

## Rollback Testing Results

### Expected Test Output

```
[INFO] Organization Management Rollback Test Suite
[✓] Create test database
[✓] Organization management migration applied
[✓] Organization table exists
[✓] OrganizationMember table exists
... (all table existence tests)
[✓] OrgRole enum type exists
[✓] Test data inserted successfully
[✓] Rollback script executed successfully
[✓] Organization table removed
[✓] OrganizationMember table removed
... (all table removal tests)
[✓] OrgRole enum type removed
[✓] Test database dropped

Test Results
============
Tests Run: 24
Tests Passed: 24
Tests Failed: 0

ALL TESTS PASSED!
```

## Documentation Maintenance

- **Last Updated:** January 2025
- **Reviewed:** Monthly
- **Related Files:**
  - `../add_organization_management.sql` - Forward migration
  - `../../ORGANIZATION_SCHEMA_SUMMARY.md` - Schema overview
  - `../migration_verification.md` - Migration verification

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2025 | Initial rollback procedure and scripts |

---

**For critical issues, contact the database administration team immediately.**
