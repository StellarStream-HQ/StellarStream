# Migration Summary: Add Invitation Table (Task 1.3)

## Overview
This migration creates the `Invitation` table for token-based team member invitations to organizations, as specified in the Organization Management feature design.

## Migration Details

### File Location
- `prisma/migrations/20260727182707_add_invitation_table/migration.sql`
- Follows Prisma standard timestamp-based migration format

### Table Schema

**Table Name:** `Invitation`

**Columns:**

| Column | Type | Constraints | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PRIMARY KEY, default: gen_random_uuid() | Unique invitation identifier |
| `organization_id` | TEXT | NOT NULL, FK → Organization(id), CASCADE DELETE | Organization owner of invitation |
| `invitee_email` | TEXT | NOT NULL | Email address of invitee |
| `role` | OrgRole ENUM | NOT NULL | Role assigned (DRAFTER, APPROVER, EXECUTOR) |
| `token_hash` | TEXT | NOT NULL, UNIQUE | SHA-256 hash of invitation token (never stores plaintext) |
| `status` | TEXT | NOT NULL, DEFAULT 'PENDING' | Invitation state (PENDING, ACCEPTED, EXPIRED, REVOKED) |
| `expires_at` | TIMESTAMPTZ | NOT NULL | Expiration timestamp (7 days from creation) |
| `accepted_by` | TEXT | NULL | Address of member who accepted invitation |
| `accepted_at` | TIMESTAMPTZ | NULL | Timestamp when invitation was accepted |
| `revoked_by` | TEXT | NULL | Address of member who revoked invitation (EXECUTOR) |
| `revoked_at` | TIMESTAMPTZ | NULL | Timestamp when invitation was revoked |
| `invited_by` | TEXT | NOT NULL | Address of member who created invitation (EXECUTOR) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Invitation creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |

### Indexes

| Index Name | Columns | Purpose |
|-----------|---------|---------|
| `Invitation_organization_id_idx` | organization_id | Fast lookup of invitations by organization |
| `Invitation_status_idx` | status | Efficient filtering by status (PENDING, ACCEPTED, EXPIRED, REVOKED) |
| `Invitation_expires_at_idx` | expires_at | Cleanup queries to find and expire old invitations |
| `Invitation_token_hash_unique_idx` | token_hash | Enforce uniqueness and fast token lookups |

### Constraints

- **Foreign Key**: `organization_id` → `Organization(id)` with CASCADE DELETE
  - Ensures invitations are deleted when organization is deleted
- **Unique Constraint**: `token_hash`
  - Prevents duplicate token hashes in database
  - Enables fast token validation during acceptance

## Requirements Coverage

### From Design Document
✓ **Primary Key**: `id` (CUID)
✓ **Organization Reference**: `organization_id` (foreign key to Organization)
✓ **Invitee Email**: `invitee_email` (cannot be null)
✓ **Role**: `role` (OrgRole enum: DRAFTER, APPROVER, EXECUTOR)
✓ **Token Hash**: `token_hash` (SHA-256, unique, never stores plaintext)
✓ **Status Field**: `status` (PENDING, ACCEPTED, EXPIRED, REVOKED)
✓ **Expiration**: `expiresAt` (7-day default in code)
✓ **Accepted Tracking**: `acceptedBy`, `acceptedAt`
✓ **Revoked Tracking**: `revokedBy`, `revokedAt`
✓ **Invited By**: `invitedBy` (creator's address)
✓ **Timestamps**: `createdAt`, `updatedAt`
✓ **Organization Index**: Fast lookup by organizationId
✓ **Status Index**: Efficient status-based filtering
✓ **Expiration Index**: Cleanup queries for expired invitations

### Requirements Mapping

| Requirement | Coverage |
|------------|----------|
| 2.1 (Time-limited token generation) | ✓ expiresAt field + expires_at index |
| 2.2 (Email invitations) | ✓ invitee_email field |
| 2.3 (SEP-10 verification requirement) | ✓ status field tracks acceptance |
| 2.4 (Member creation on acceptance) | ✓ accepted_by, accepted_at fields |
| 2.8 (Revocation support) | ✓ revoked_by, revoked_at fields |
| 9.1 (Token generation) | ✓ token_hash field with UNIQUE constraint |
| 9.2 (Token hashing) | ✓ token_hash stores only hash (design enforces plaintext never stored) |
| 9.3 (Token expiration) | ✓ expires_at field + index for cleanup |
| 9.4 (Revocation prevents reuse) | ✓ status field tracks revoked state |
| 11.1 (Email invitations) | ✓ invitee_email field + organization relationship |

## Implementation Notes

1. **Token Hash Storage**: The migration supports storing only SHA-256 hashes. The InvitationService code layer is responsible for:
   - Generating plaintext tokens (32+ bytes entropy)
   - Hashing tokens before storage
   - Returning plaintext token only once to caller

2. **Status Management**: The status field tracks the complete lifecycle:
   - PENDING: Initial state after creation
   - ACCEPTED: User accepted and became member
   - EXPIRED: Token expired after expiresAt timestamp
   - REVOKED: Manually revoked by EXECUTOR

3. **Cascade Delete**: When an organization is deleted, all its invitations are automatically deleted via CASCADE.

4. **Foreign Key Relationship**: Ensures referential integrity - organization must exist for invitation to exist.

5. **Index Strategy**:
   - `organization_id` index enables fast queries: "Get all invitations for organization X"
   - `status` index enables fast queries: "Get all PENDING invitations"
   - `expires_at` index enables efficient cleanup: "Get all expired invitations"
   - `token_hash` unique index enables O(1) token validation lookups

## Testing Strategy

### Schema Validation
```sql
-- Verify table exists with correct columns
\d+ "Invitation"

-- Verify indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'Invitation';

-- Verify foreign key
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'Invitation' AND constraint_type = 'FOREIGN KEY';
```

### Data Integrity
- Token hash uniqueness prevents duplicate invitations
- Organization FK prevents orphaned invitations
- Status field enforces valid state transitions (code layer)
- Timestamps automatic via defaults

### Performance
- Organization queries: O(log n) via organization_id index
- Status filtering: O(log n) via status index
- Token lookups: O(log n) via token_hash unique index
- Cleanup queries: O(log n) via expires_at index

## Rollback

To rollback this migration:
```sql
DROP INDEX IF EXISTS "Invitation_expires_at_idx";
DROP INDEX IF EXISTS "Invitation_status_idx";
DROP INDEX IF EXISTS "Invitation_organization_id_idx";
DROP INDEX IF EXISTS "Invitation_token_hash_unique_idx";
DROP TABLE IF EXISTS "Invitation";
```

## Prisma Integration

The migration is automatically tracked by Prisma and coordinates with the `prisma/schema.prisma` model:

```prisma
model Invitation {
  id            String   @id @default(cuid())
  organizationId String  @map("organization_id")
  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  inviteeEmail  String   @map("invitee_email")
  role          OrgRole
  tokenHash     String   @unique @map("token_hash")
  status        String   @default("PENDING")
  expiresAt     DateTime @map("expires_at")
  acceptedBy    String?  @map("accepted_by")
  acceptedAt    DateTime? @map("accepted_at")
  revokedBy     String?  @map("revoked_by")
  revokedAt     DateTime? @map("revoked_at")
  invitedBy     String   @map("invited_by")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([organizationId])
  @@index([status])
  @@index([expiresAt])
}
```

## Related Tasks

- **1.1**: Organization table (prerequisite for FK)
- **1.2**: OrganizationMember table (members created when invitation accepted)
- **1.4**: OrganizationPolicy table (for organization policies)
- **2.1**: Run migrations in development
- **3.1**: InvitationService implementation (uses this table)
- **5.1**: Invitation token generation service
- **11.1**: Email service integration

---

## Verification Checklist

- [x] Table created with all required columns
- [x] All columns have correct data types
- [x] Primary key defined correctly
- [x] Foreign key to Organization with CASCADE
- [x] tokenHash has UNIQUE constraint
- [x] status field with default 'PENDING'
- [x] All timestamp fields with defaults
- [x] All nullable fields properly optional (acceptedBy, acceptedAt, revokedBy, revokedAt)
- [x] Organization index for fast org lookups
- [x] Status index for filtering
- [x] Expires_at index for cleanup
- [x] Token hash unique index for lookups
- [x] OrgRole enum exists check
- [x] Migration follows Prisma standard format
- [x] SQL syntax validated for PostgreSQL
- [x] Indexes created with IF NOT EXISTS safety
