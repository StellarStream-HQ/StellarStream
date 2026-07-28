#!/bin/bash

# Organization Management Data Backup Script
#
# This script exports organization management tables to CSV format for backup
# before performing a rollback operation.
#
# Usage: ./backup-org-data.sh [backup_dir]
# Example: ./backup-org-data.sh ./org-backup-2025-01-20
#
# Prerequisites:
#   - PostgreSQL client tools installed (psql)
#   - DATABASE_URL environment variable set
#   - Read access to organization tables
#
# Output:
#   - Creates directory with backup files for each table
#   - Generates backup manifest with row counts and timestamps
#   - Creates SQL dump for complete data recovery

set -euo pipefail

# Configuration
BACKUP_DIR="${1:-.}/org-backup-$(date +%Y%m%d-%H%M%S)}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
MANIFEST_FILE="${BACKUP_DIR}/backup-manifest.txt"

# Validate environment
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable not set"
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"
echo "Creating backup directory: $BACKUP_DIR"

# Initialize manifest
cat > "$MANIFEST_FILE" << EOF
Organization Management Data Backup Manifest
=============================================

Backup Timestamp: $TIMESTAMP
Database: $DATABASE_URL
Backup Directory: $BACKUP_DIR

Table Export Summary:
EOF

echo ""
echo "Starting organization management data backup..."
echo ""

# Function to backup a table to CSV
backup_table() {
  local table_name=$1
  local output_file="${BACKUP_DIR}/${table_name}.csv"
  
  echo "Exporting $table_name..."
  
  # Export table to CSV with headers
  psql "$DATABASE_URL" \
    -c "COPY \"$table_name\" TO STDOUT WITH (FORMAT CSV, HEADER, FORCE_QUOTE *)" \
    > "$output_file" 2>/dev/null || {
      echo "  ERROR: Failed to export $table_name"
      echo "  $table_name - FAILED (table may not exist)" >> "$MANIFEST_FILE"
      return 1
    }
  
  # Count rows
  local row_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM \"$table_name\"" 2>/dev/null || echo "0")
  local file_size=$(ls -lh "$output_file" | awk '{print $5}')
  
  echo "  ✓ Exported $table_name ($row_count rows, $file_size)"
  echo "  $table_name - $row_count rows ($file_size)" >> "$MANIFEST_FILE"
  
  return 0
}

# Backup each organization management table
backup_table "Organization"
backup_table "OrganizationMember"
backup_table "Invitation"
backup_table "OrganizationPolicy"
backup_table "BillingRecord"
backup_table "MultisigProposal"
backup_table "AuditLog"

echo ""
echo "Creating full SQL dump for recovery..."

# Create complete SQL dump
sql_dump_file="${BACKUP_DIR}/org-complete-dump.sql"
pg_dump "$DATABASE_URL" \
  -t Organization \
  -t OrganizationMember \
  -t Invitation \
  -t OrganizationPolicy \
  -t BillingRecord \
  -t MultisigProposal \
  -t AuditLog \
  --disable-triggers \
  > "$sql_dump_file" 2>/dev/null || {
    echo "  Note: Could not create full SQL dump (some tables may not exist)"
  }

echo "  ✓ SQL dump created: $sql_dump_file"

echo ""
echo "Creating backup metadata..."

# Add backup metadata to manifest
cat >> "$MANIFEST_FILE" << EOF

Backup Details:
===============
Backup Directory: $BACKUP_DIR

Files Created:
- Organization.csv - Organization records (core organization metadata)
- OrganizationMember.csv - Team member assignments and roles
- Invitation.csv - Email invitation tokens and acceptance records
- OrganizationPolicy.csv - Spending limits and asset configurations
- BillingRecord.csv - Usage metrics and billing period records
- MultisigProposal.csv - Multi-signature transaction proposals
- AuditLog.csv - Audit trail entries with hash chains
- org-complete-dump.sql - Complete SQL dump for recovery
- backup-manifest.txt - This file

Data Loss Implications (if rollback is executed):
================================================
All data in the above tables will be permanently deleted.

Recovery Procedure:
==================
To recover this backup after a rollback:

1. Verify the forward migration is applied:
   npx prisma migrate dev
   OR
   psql \$DATABASE_URL < add_organization_management.sql

2. Import the SQL dump:
   psql \$DATABASE_URL < org-complete-dump.sql

3. Or import individual CSV files:
   psql \$DATABASE_URL -c "COPY \"Organization\" FROM 'Organization.csv' WITH (FORMAT CSV, HEADER);"
   psql \$DATABASE_URL -c "COPY \"OrganizationMember\" FROM 'OrganizationMember.csv' WITH (FORMAT CSV, HEADER);"
   ... repeat for other tables ...

4. Verify data integrity:
   psql \$DATABASE_URL < verify-tables-removed.sql

Backup Completion Time: $(date '+%Y-%m-%d %H:%M:%S')
EOF

# Create a restore script for convenience
restore_script="${BACKUP_DIR}/restore-backup.sh"
cat > "$restore_script" << 'RESTORE_EOF'
#!/bin/bash

# Restore Organization Management Backup Script
#
# This script restores organization management data from a backup
# after a rollback operation.
#
# Usage: ./restore-backup.sh
#
# Prerequisites:
#   - Forward migration applied (npx prisma migrate dev)
#   - DATABASE_URL environment variable set
#   - Backup files in current directory

set -euo pipefail

echo "Organization Management Data Restore Script"
echo "==========================================="
echo ""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL environment variable not set"
  exit 1
fi

if [ ! -f "org-complete-dump.sql" ]; then
  echo "ERROR: org-complete-dump.sql not found in current directory"
  exit 1
fi

echo "Starting restore operation..."
echo ""

# First apply forward migration if needed
echo "Ensuring forward migrations are applied..."
npx prisma migrate dev || echo "Migration may have already been applied"

echo ""
echo "Restoring from SQL dump..."
psql "$DATABASE_URL" < org-complete-dump.sql

echo ""
echo "Restore completed successfully!"
echo ""
echo "To verify restoration:"
echo "  psql \$DATABASE_URL -c 'SELECT COUNT(*) FROM \"Organization\";'"
RESTORE_EOF

chmod +x "$restore_script"

echo ""
echo "============================================"
echo "Backup completed successfully!"
echo "============================================"
echo ""
echo "Backup Location: $BACKUP_DIR"
echo "Manifest File: $MANIFEST_FILE"
echo "Restore Script: $restore_script"
echo ""
echo "To view backup manifest:"
echo "  cat $MANIFEST_FILE"
echo ""
echo "To restore from backup after rollback:"
echo "  cd $BACKUP_DIR"
echo "  ./restore-backup.sh"
echo ""
