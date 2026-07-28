# Migration Verification: Add Invitation Table (Task 1.3)

## Verification Steps

### 1. Migration Deployment
```bash
cd backend
npx prisma migrate deploy
```

Expected output:
```
Your database is now in sync with your Prisma schema.
1 migration(s) have been successfully applied.
```

### 2. Database Schema Verification

Verify the Invitation table was created:
```sql
\d+ "Invitation"
```

Expected output:
```
                    Table "public.Invitation"
    Column    |           Type           | Collation | Nullable | Default 
---------------+---------------------------+-----------+----------+---------
 id            | text                     |           | not null | 
 organization_ | text                     |           | not null | 
 invitee_email | text                     |           | not null | 
 role          | "OrgRole"                |           | not null | 
 token_hash    | text                     |           | not null | 
 status        | text                     |           | not null | 'PENDING'
 expires_at    | timestamp with time zone |           | not null | 
 accepted_by   | text                     |           |          | 
 accepted_at   | timestamp with time zone |           |          | 
 revoked_by    | text                     |           |          | 
 revoked_at    | timestamp with time zone |           |          | 
 invited_by    | text                     |           | not null | 
 created_at    | timestamp with time zone |           | not null | now()
 updated_at    | timestamp with time zone |           | not null | now()
Indexes:
    "Invitation_pkey" PRIMARY KEY, btree (id)
    "Invitation_organization_id_idx" btree (organization_id)
    "Invitation_status_idx" btree (status)
    "Invitation_expires_at_idx" btree (expires_at)
    "Invitation_token_hash_unique_idx" UNIQUE, btree (token_hash)
Foreign-key constraints:
    "Invitation_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES "Organization"(id) ON DELETE CASCADE
```

### 3. Index Verification

Verify all indexes are created:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'Invitation' 
ORDER BY indexname;
```

Expected indexes:
- `Invitation_pkey` (primary key on id)
- `Invitation_organization_id_idx` (on organization_id)
- `Invitation_status_idx` (on status)
- `Invitation_expires_at_idx` (on expires_at)
- `Invitation_token_hash_unique_idx` (UNIQUE on token_hash)

### 4. Foreign Key Verification

Verify the foreign key constraint:
```sql
SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name
FROM information_schema.key_column_usage
WHERE table_name = 'Invitation' AND constraint_name LIKE '%fkey%';
```

Expected result:
```
         constraint_name          | table_name | column_name | foreign_table_name | foreign_column_name
---------------------------------+------------+-------------+--------------------+---------------------
 Invitation_organization_id_fkey  | Invitation | organization_id    | Organization       | id
```

### 5. Default Values Verification

Verify defaults are properly set:
```sql
SELECT column_name, column_default 
FROM information_schema.columns 
WHERE table_name = 'Invitation' AND column_default IS NOT NULL;
```

Expected results:
- `status`: 'PENDING'::text
- `created_at`: now()
- `updated_at`: now()

### 6. Unique Constraint Verification

Verify token_hash uniqueness:
```sql
SELECT constraint_name 
FROM information_schema.table_constraints 
WHERE table_name = 'Invitation' AND constraint_type = 'UNIQUE';
```

Expected result:
```
 constraint_name
-----------------
 Invitation_token_hash_unique_idx
```

### 7. Enum Type Verification

Verify OrgRole enum is properly created:
```sql
SELECT typname, typtype 
FROM pg_type 
WHERE typname = 'OrgRole';
```

Expected result:
```
 typname | typtype
---------+---------
 OrgRole | e
```

### 8. Prisma Client Generation

Verify Prisma client can access the new table:
```bash
npx prisma generate
```

Expected: Generated Prisma Client successfully.

### 9. Data Integrity Tests

#### Test 9.1: Insert valid invitation
```sql
INSERT INTO "Invitation" (
  "organization_id", 
  "invitee_email", 
  "role", 
  "token_hash", 
  "expires_at", 
  "invited_by"
) VALUES (
  'org-123',
  'test@example.com',
  'APPROVER',
  'sha256abcd1234567890',
  NOW() + INTERVAL '7 days',
  'creator-address'
)
RETURNING id, status, created_at;
```

Expected: Insertion succeeds, status defaults to 'PENDING', created_at is set.

#### Test 9.2: Token hash uniqueness
```sql
-- Try to insert duplicate token_hash
INSERT INTO "Invitation" (
  "organization_id", 
  "invitee_email", 
  "role", 
  "token_hash", 
  "expires_at", 
  "invited_by"
) VALUES (
  'org-456',
  'another@example.com',
  'DRAFTER',
  'sha256abcd1234567890',  -- Duplicate token_hash
  NOW() + INTERVAL '7 days',
  'another-creator'
);
```

Expected: ERROR - duplicate key value violates unique constraint

#### Test 9.3: Foreign key constraint
```sql
-- Try to insert with invalid organization_id
INSERT INTO "Invitation" (
  "organization_id", 
  "invitee_email", 
  "role", 
  "token_hash", 
  "expires_at", 
  "invited_by"
) VALUES (
  'invalid-org-id',
  'test@example.com',
  'APPROVER',
  'sha256xyz',
  NOW() + INTERVAL '7 days',
  'creator-address'
);
```

Expected: ERROR - insert or update on table "Invitation" violates foreign key constraint

#### Test 9.4: Organization deletion cascades
```sql
-- Create organization and invitation
INSERT INTO "Organization" (id, gAddress, name, createdBy)
VALUES ('cascade-test-org', 'GXXXXX', 'Test Org', 'test-creator');

INSERT INTO "Invitation" (
  "organization_id", 
  "invitee_email", 
  "role", 
  "token_hash", 
  "expires_at", 
  "invited_by"
) VALUES (
  'cascade-test-org',
  'test@example.com',
  'APPROVER',
  'cascade-token-hash',
  NOW() + INTERVAL '7 days',
  'test-creator'
);

-- Delete organization
DELETE FROM "Organization" WHERE id = 'cascade-test-org';

-- Verify invitation is deleted
SELECT COUNT(*) FROM "Invitation" WHERE organization_id = 'cascade-test-org';
```

Expected: Count returns 0 (invitation cascaded deleted)

### 10. Index Performance

Verify indexes are being used:
```sql
EXPLAIN SELECT * FROM "Invitation" WHERE organization_id = 'org-123';
```

Expected: Should show "Index Scan" on Invitation_organization_id_idx

```sql
EXPLAIN SELECT * FROM "Invitation" WHERE status = 'PENDING';
```

Expected: Should show "Index Scan" on Invitation_status_idx

```sql
EXPLAIN SELECT * FROM "Invitation" WHERE expires_at < NOW();
```

Expected: Should show "Index Scan" on Invitation_expires_at_idx

### 11. Prisma Validation

Test Prisma type checking:
```typescript
import { PrismaClient, OrgRole } from '@prisma/client';

const prisma = new PrismaClient();

// Type-safe create
const invitation = await prisma.invitation.create({
  data: {
    organizationId: 'org-123',
    inviteeEmail: 'test@example.com',
    role: OrgRole.APPROVER,
    tokenHash: 'sha256hash',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    invitedBy: 'creator-address',
  },
});

// Type-safe queries
const pending = await prisma.invitation.findMany({
  where: { status: 'PENDING' },
});

const byOrg = await prisma.invitation.findMany({
  where: { organizationId: 'org-123' },
});
```

Expected: All queries compile and execute without errors.

### 12. Migration Rollback Test (Optional)

To test rollback capability:
```bash
# Rollback the migration
npx prisma migrate resolve --rolled-back 20260727182707_add_invitation_table

# Verify table is removed
psql -d stellarstream -c "\d Invitation"
```

Expected: "Did not find any relation named \"Invitation\"."

Then reapply:
```bash
npx prisma migrate deploy
```

## Comparison Matrix

| Aspect | Expected | Actual | Status |
|--------|----------|--------|--------|
| Table created | "Invitation" table exists | | ✓/✗ |
| Columns | 14 columns per schema | | ✓/✗ |
| Primary key | id (TEXT, DEFAULT gen_random_uuid()) | | ✓/✗ |
| Foreign key | organization_id → Organization(id) CASCADE | | ✓/✗ |
| Unique constraint | token_hash UNIQUE | | ✓/✗ |
| Default status | 'PENDING' | | ✓/✗ |
| Indexes | 5 indexes created | | ✓/✗ |
| organization_id index | Present and functional | | ✓/✗ |
| status index | Present and functional | | ✓/✗ |
| expires_at index | Present and functional | | ✓/✗ |
| token_hash unique index | Present and functional | | ✓/✗ |
| OrgRole enum | Exists with 3 values | | ✓/✗ |
| Prisma client | Generated successfully | | ✓/✗ |
| Type safety | Types compile and validate | | ✓/✗ |

## Success Criteria

✓ All schema columns match design specification
✓ All indexes created as specified
✓ Foreign key constraint enforced
✓ Token hash uniqueness enforced
✓ Cascade delete works on organization deletion
✓ Indexes are being used for queries
✓ Prisma types are correct
✓ Migration is reversible
✓ No data loss on reapply

---

## Run Verification Command

To run all verification checks in one command:
```bash
psql -d stellarstream << EOF
-- 1. Table exists
\dt+ "Invitation"

-- 2. Columns
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Invitation' 
ORDER BY ordinal_position;

-- 3. Indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'Invitation' 
ORDER BY indexname;

-- 4. Foreign keys
SELECT constraint_name, table_name, column_name, foreign_table_name, foreign_column_name
FROM information_schema.key_column_usage
WHERE table_name = 'Invitation';

-- 5. OrgRole enum
SELECT enum_range(NULL::"OrgRole");
EOF
```

Expected: All queries return results matching the migration schema.
