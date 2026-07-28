# Organization Management Migration Rollback Procedure

## Overview

This document provides comprehensive procedures for rolling back the Organization Management feature migrations in the StellarStream backend. These migrations introduce multi-tenant organization support, role-based access control, and audit logging capabilities.

**Important**: Rollback operations are destructive and will result in permanent data loss. They should only be performed in development environments or as part of a carefully planned recovery procedure in production with explicit authorization and backups.

## Migration Components

The Organization Management feature introduces the following database objects:

### Enum Types
- `OrgRole` - Enum for role-based access control (DRAFTER, APPROVER, EXECUTOR)

### Tables (in dependency order)
1. **Organization** - Core organization records
2. **OrganizationMember** - Team member records with role assignments
3. **Invitation** - Email invitation tokens for joining organizations
4. **OrganizationPolicy** - Spending limits and asset whitelists
5. **BillingRecord** - Usage tracking and quota management
6. **MultisigProposal** - Multi-signature transaction proposals
7. **AuditLog** - Immutable audit trail with hash chain

### Indexes
- Multiple indexes on Organization, OrganizationMember, Invitation, OrganizationPolicy, BillingRecord, MultisigProposal, and AuditLog tables

## Rollback Strategy

### Two-Stage Rollback Process

#### Stage 1: Data Preservation (Optional)
Before destroying tables, optionally export data for analysis or recovery:
```bash
# Export tables to CSV or JSON
psql $DATABASE_URL -c "\COPY Organization TO 'org-backup.csv' WITH (FORMAT csv, HEADER);"
psql $DATABASE_URL -c "\COPY OrganizationMember TO 'members-backup.csv' WITH (FORMAT csv, HEADER);"
# ... export other tables as needed
```

#### Stage 2: Table Removal
Execute rollback script in the following order to respect foreign key dependencies:

**Dependency Tree:**
```
Organization (no dependencies)
  ├── OrganizationMember (FK: organization_id)
  ├── Invitation (FK: organization_id)
  ├── OrganizationPolicy (FK: organization_id)
  ├── BillingRecord (FK: organization_id)
  ├── MultisigProposal (FK: organization_id)
  └── AuditLog (FK: organization_id)
```

**Rollback Order:**
1. Drop AuditLog (no other tables depend on it)
2. Drop MultisigProposal (no other tables depend on it)
3. Drop BillingRecord (no other tables depend on it)
4. Drop OrganizationPolicy (no other tables depend on it)
5. Drop Invitation (no other tables depend on it)
6. Drop OrganizationMember (no other tables depend on it)
7. Drop Organization (all child tables removed)
8. Drop OrgRole enum type (only used in these tables)

## Data Loss Implications

### Critical Data Loss

Executing rollback will permanently delete:

| Data Category | Scope | Recovery Possibility |
|---------------|-------|----------------------|
| Organization Records | All organization metadata, names, descriptions, settings | Lost unless backed up separately |
| Team Memberships | All member-organization relationships | Lost unless backed up separately |
| Audit Logs | All audit trail entries and immutable hash chains | Lost unless backed up separately |
| Invitation Tokens | All pending and historical invitations | Lost unless backed up separately |
| Policy Settings | All spending limits, asset whitelists, multisig configs | Lost unless backed up separately |
| Billing Records | All usage metrics and quota tracking data | Lost unless backed up separately |
| Multisig Proposals | All pending transaction proposals and signature collections | Lost unless backed up separately |

### System Impact

After rollback:
- **Organization Features Disabled**: Users cannot create or manage organizations
- **Multi-Tenancy Removed**: System reverts to single-tenant mode
- **Authorization Reset**: Role-based access control unavailable
- **Audit Trail Lost**: No ability to query historical organization actions
- **Billing Disabled**: Usage tracking and quota enforcement non-functional
- **Multisig Disabled**: Multi-signature transaction capability unavailable
- **Integration Gaps**: Other services depending on org context may fail

### Reverification Requirements

After rollback and before production use:
1. Verify all dependent services have handled the missing tables
2. Test streams and disbursements work without organization context
3. Verify user authentication still functions
4. Check all API endpoints for graceful degradation or errors
5. Run integration tests with organization feature disabled
6. Review application logs for orphaned references to org tables

## Manual Rollback Procedure

### Prerequisites
- Database credentials with admin or owner role
- Backup of all organization-related data completed
- Approval from database administrator
- Maintenance window scheduled
- Notification to all dependent services

### Execution Steps

1. **Enable Maintenance Mode** (optional but recommended)
   ```bash
   # Set application to maintenance mode to prevent concurrent access
   export MAINTENANCE_MODE=true
   ```

2. **Create Pre-Rollback Backup** (mandatory)
   ```bash
   # Create full database backup
   pg_dump $DATABASE_URL > backup-before-rollback-$(date +%Y%m%d-%H%M%S).sql
   
   # Verify backup is valid
   pg_restore --list backup-before-rollback-*.sql | head -20
   ```

3. **Execute Rollback Script**
   ```bash
   # Execute the rollback script (see rollback-org-management.sql below)
   psql $DATABASE_URL < rollback-org-management.sql
   ```

4. **Verify Rollback Completion**
   ```bash
   # Check that tables no longer exist
   psql $DATABASE_URL -c "
     SELECT tablename FROM pg_tables 
     WHERE schemaname = 'public' 
     AND tablename IN ('Organization', 'OrganizationMember', 'Invitation', 
                       'OrganizationPolicy', 'BillingRecord', 'MultisigProposal', 
                       'AuditLog');
   " 
   # Should return empty result set
   
   # Check that OrgRole enum is removed
   psql $DATABASE_URL -c "
     SELECT typname FROM pg_type WHERE typname = 'OrgRole';
   "
   # Should return empty result set
   ```

5. **Run Migration Verification**
   ```bash
   # If using Prisma, run introspection to verify schema
   npx prisma db execute --stdin < verify-no-org-tables.sql
   ```

6. **Run Application Tests**
   ```bash
   # Execute test suite to verify application handles missing tables
   npm run test
   ```

7. **Disable Maintenance Mode**
   ```bash
   export MAINTENANCE_MODE=false
   ```

8. **Document Rollback**
   - Record timestamp of rollback
   - Document reason for rollback
   - List anyone notified of rollback
   - Save pre-rollback backup in secure location

## Rollback Script (SQL)

See `rollback-org-management.sql` for the complete SQL script that performs all rollback operations.

## Automated Rollback Integration

### Prisma Migration Rollback

If using Prisma migrations:

```bash
# List all migrations
npx prisma migrate status

# Reset to a specific migration (WARNING: Destructive!)
npx prisma migrate resolve --rolled-back <migration_name>

# Full database reset (WARNING: Destroys all data!)
npx prisma migrate reset
```

### Recovery After Rollback

If rollback was unintended:

1. **Stop Application** immediately to prevent write operations
2. **Restore Database** from pre-rollback backup:
   ```bash
   # Restore from backup
   psql $DATABASE_URL < backup-before-rollback-*.sql
   ```
3. **Verify Restoration** by checking table counts and sample data
4. **Restart Application** after verification
5. **Investigate Root Cause** before attempting rollback again

## Testing Rollback in Development

### Test Procedure

1. **Set Up Test Environment**
   ```bash
   # Create test database
   createdb stellarstream_test_rollback
   
   # Initialize with forward migrations
   psql stellarstream_test_rollback < forward-migrations.sql
   ```

2. **Verify Pre-Rollback State**
   ```bash
   # Check tables exist
   psql stellarstream_test_rollback -c "\dt"
   
   # Count records in each table
   psql stellarstream_test_rollback -c "
     SELECT 'Organization' as table_name, count(*) FROM \"Organization\"
     UNION ALL
     SELECT 'OrganizationMember', count(*) FROM \"OrganizationMember\"
     UNION ALL
     SELECT 'Invitation', count(*) FROM \"Invitation\"
     UNION ALL
     SELECT 'OrganizationPolicy', count(*) FROM \"OrganizationPolicy\"
     UNION ALL
     SELECT 'BillingRecord', count(*) FROM \"BillingRecord\"
     UNION ALL
     SELECT 'MultisigProposal', count(*) FROM \"MultisigProposal\"
     UNION ALL
     SELECT 'AuditLog', count(*) FROM \"AuditLog\";
   "
   ```

3. **Execute Rollback**
   ```bash
   psql stellarstream_test_rollback < rollback-org-management.sql
   ```

4. **Verify Post-Rollback State**
   ```bash
   # Verify all tables are removed
   psql stellarstream_test_rollback -c "\dt"
   # Should not show Organization, OrganizationMember, Invitation, etc.
   
   # Verify enum type is removed
   psql stellarstream_test_rollback -c "
     SELECT typname FROM pg_type WHERE typname = 'OrgRole';
   "
   # Should return empty result set
   ```

5. **Test Application Behavior**
   ```bash
   # Set DATABASE_URL to test database
   export DATABASE_URL="postgresql://user:pass@localhost/stellarstream_test_rollback"
   
   # Run application tests
   npm run test
   
   # Check for errors related to missing tables
   ```

6. **Clean Up Test Database**
   ```bash
   dropdb stellarstream_test_rollback
   ```

## Version Control and Documentation

### Storing Rollback Scripts

Rollback scripts are stored in: `backend/prisma/migrations/rollback-org-management/`

Files included:
- `ROLLBACK_PROCEDURE.md` - This document (procedure and implications)
- `rollback-org-management.sql` - Complete SQL rollback script
- `verify-tables-removed.sql` - Verification script to confirm successful rollback
- `test-rollback.sh` - Bash script to test rollback in development

### Version Tracking

Each rollback script is versioned alongside the corresponding forward migrations:
- Forward migration: `add_organization_management.sql` (v1.0)
- Corresponding rollback: `rollback-org-management.sql` (v1.0)

When forward migrations are updated, the rollback script must be updated in parallel.

## Emergency Contacts and Escalation

For rollback-related issues in production:

1. **Database Administrator**: Approve and execute rollback
2. **Application Owner**: Handle service disruption and recovery
3. **Security Team**: Review data loss and compliance implications
4. **Development Team**: Update application code and restart services

## Checklist for Safe Rollback

- [ ] Backup completed and verified
- [ ] Maintenance window scheduled and communicated
- [ ] Dependent services notified
- [ ] Rollback procedure reviewed with DBA
- [ ] Test rollback executed successfully in development
- [ ] Post-rollback application testing plan ready
- [ ] Recovery procedure documented
- [ ] All stakeholders on standby
- [ ] Approval obtained from authorized personnel
- [ ] Post-rollback verification checklist prepared

## FAQ

**Q: Can I rollback only specific tables?**
A: No. Due to foreign key dependencies, all organization management tables must be rolled back together. Rolling back individual tables will cause foreign key constraint violations.

**Q: How long does rollback take?**
A: Approximately 30-60 seconds depending on database size and performance. Dropping tables is fast; the main delay is in backups and verification.

**Q: Can I re-apply the migration after rollback?**
A: Yes. After rollback, you can re-apply the forward migration with `npx prisma migrate dev` or `psql < add_organization_management.sql`. All tables will be recreated.

**Q: What if rollback fails partway through?**
A: Check the error message and the tables that remain. In most cases, it's safe to simply run the rollback script again. If foreign key violations occur, manually drop remaining tables in dependency order.

**Q: Will rollback affect other tables?**
A: No. Rollback only affects the organization management tables and the OrgRole enum type. All other tables (streams, disbursements, etc.) remain untouched.

**Q: How do I know which data to back up?**
A: Back up all seven tables: Organization, OrganizationMember, Invitation, OrganizationPolicy, BillingRecord, MultisigProposal, and AuditLog. These contain all organization-related data.

---

**Last Updated:** January 2025
**Maintained By:** Development Team
**Review Frequency:** Quarterly or after migration changes
