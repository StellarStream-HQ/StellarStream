# Implementation Guide: Invitation Table Migration (Task 1.3)

## Overview

This migration creates the database foundation for token-based team member invitations in the StellarStream Organization Management feature. It enables organizations to invite team members via email with time-limited tokens.

## Migration Location

```
prisma/migrations/20260727182707_add_invitation_table/
├── migration.sql           # SQL migration file
├── MIGRATION_SUMMARY.md    # Detailed schema documentation
├── VERIFICATION.md         # Verification and testing procedures
└── IMPLEMENTATION_GUIDE.md # This file
```

## How This Migration Integrates

### 1. Database Schema Layer
The migration creates the persistent storage for invitations in PostgreSQL with:
- Encrypted token hashing (SHA-256)
- Invitation lifecycle tracking (PENDING → ACCEPTED/EXPIRED/REVOKED)
- Referential integrity via foreign keys
- Performance-optimized indexes

### 2. Prisma ORM Layer
The migration corresponds to the Prisma model:
```prisma
model Invitation {
  id             String
  organizationId String
  organization   Organization
  inviteeEmail   String
  role           OrgRole
  tokenHash      String (unique)
  status         String
  expiresAt      DateTime
  acceptedBy     String?
  acceptedAt     DateTime?
  revokedBy      String?
  revokedAt      DateTime?
  invitedBy      String
  createdAt      DateTime
  updatedAt      DateTime
}
```

### 3. Service Layer Dependencies

#### InvitationService
Uses the Invitation table for:
- **Token Generation**: Generates plaintext tokens (code layer)
- **Token Storage**: Stores SHA-256 hash via this table
- **Expiration Tracking**: Queries expires_at index for cleanup
- **Status Management**: Updates status field through lifecycle

```typescript
// Example usage in InvitationService
const invitation = await prisma.invitation.create({
  data: {
    organizationId: org.id,
    inviteeEmail: 'user@example.com',
    role: OrgRole.APPROVER,
    tokenHash: hashToken(plainToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    invitedBy: creatorAddress,
  },
});
```

#### Organization Service
Uses the Invitation table for:
- **Querying Pending Invitations**: Via organizationId index
- **Invitation History**: Via status and createdAt

```typescript
// Example: List pending invitations for organization
const pending = await prisma.invitation.findMany({
  where: {
    organizationId: orgId,
    status: 'PENDING',
  },
  orderBy: { createdAt: 'desc' },
});
```

#### Authorization Service
Uses the Invitation table for:
- **Invitation Acceptance**: Verifying token not already accepted
- **Revocation Checks**: Ensuring revoked invitations cannot be accepted

```typescript
// Example: Check if invitation can be accepted
const invitation = await prisma.invitation.findUnique({
  where: { tokenHash: hashedToken },
});

if (invitation?.status !== 'PENDING') {
  throw new InvalidInvitationError('Invitation already accepted or revoked');
}
```

### 4. API Endpoint Layer

The migration enables these endpoints:

#### POST /api/v1/organizations/{id}/invitations
Creates invitation → Stores in this table
```typescript
await prisma.invitation.create({
  data: {
    organizationId,
    inviteeEmail,
    role,
    tokenHash: hashToken(generatedToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    invitedBy: memberAddress,
  },
});
```

#### POST /api/v1/invitations/{token}/accept
Accepts invitation → Updates status field
```typescript
const updated = await prisma.invitation.update({
  where: { tokenHash: hashedToken },
  data: {
    status: 'ACCEPTED',
    acceptedBy: memberAddress,
    acceptedAt: new Date(),
  },
});
```

#### DELETE /api/v1/organizations/{id}/invitations/{id}
Revokes invitation → Updates status field
```typescript
await prisma.invitation.update({
  where: { id: invitationId },
  data: {
    status: 'REVOKED',
    revokedBy: memberAddress,
    revokedAt: new Date(),
  },
});
```

#### GET /api/v1/organizations/{id}/invitations
Lists invitations → Queries via organizationId index
```typescript
const invitations = await prisma.invitation.findMany({
  where: { organizationId },
  orderBy: { createdAt: 'desc' },
});
```

### 5. Email Service Integration

The migration enables email sending:
1. **Invitation Created** → Email Service reads this table
2. **Email Sent** → Contains token in link
3. **Link Clicked** → Token is hashed and looked up
4. **Token Validated** → Checked against tokenHash in this table

## Security Considerations

### Token Security
```
plaintext token (32+ bytes)
    ↓
SHA-256 hash
    ↓
stored in token_hash column (unique)
    ↓
never stored or logged as plaintext
```

### Referential Integrity
- Organization deletion cascades to delete all invitations
- Prevents orphaned invitation records
- Maintains data consistency

### Access Control
- Invitation acceptance requires fresh SEP-10 wallet verification
- Status prevents replay attacks (can't accept twice)
- Organization context ensures cross-org access prevention

## Performance Optimization

### Index Strategy

| Index | Query Pattern | Performance |
|-------|--------------|-------------|
| organization_id | "List all invitations for org X" | O(log n) + O(k) where k is result count |
| status | "Find all PENDING invitations" | O(log n) + O(k) |
| expires_at | "Find expired invitations" | O(log n) + O(k) for cleanup |
| token_hash | "Lookup invitation by token" | O(log n) unique index |

### Cleanup Query Example
```sql
-- Find and mark expired invitations (runs periodically)
UPDATE "Invitation"
SET status = 'EXPIRED'
WHERE status = 'PENDING' AND expires_at < NOW()
-- Uses expires_at index for fast scan
```

## Data Retention Policy

### Default Behavior
- Invitations retained indefinitely
- Status updated to EXPIRED after expiration
- No automatic deletion (maintains audit trail)

### Cleanup (Optional)
```sql
-- Archive expired invitations older than 90 days
DELETE FROM "Invitation" 
WHERE status = 'EXPIRED' 
  AND expires_at < NOW() - INTERVAL '90 days';
```

## Monitoring and Observability

### Key Metrics
```sql
-- Invitation creation rate
SELECT DATE_TRUNC('day', created_at), COUNT(*) 
FROM "Invitation" 
GROUP BY DATE_TRUNC('day', created_at);

-- Acceptance rate
SELECT status, COUNT(*) 
FROM "Invitation" 
GROUP BY status;

-- Pending invitations by organization
SELECT organization_id, COUNT(*) 
FROM "Invitation" 
WHERE status = 'PENDING' 
GROUP BY organization_id;
```

### Audit Logging
All invitation operations should be logged to AuditLog table:
- Invitation creation
- Invitation acceptance
- Invitation revocation
- Invitation expiration (batch)

```sql
-- Correlate with audit logs
SELECT 
  i.id,
  i.status,
  i.created_at,
  al.created_at as audit_time,
  al.action_type
FROM "Invitation" i
LEFT JOIN "AuditLog" al ON al.resource_id = i.id
WHERE al.organization_id = i.organization_id;
```

## Migration Lifecycle

### Deployment Steps
1. Create migration file (this file) ✓
2. Test migration syntax ✓
3. Run: `npx prisma migrate deploy` 
4. Verify: `npx prisma db push --skip-generate`
5. Generate client: `npx prisma generate`
6. Run tests: `npm test`
7. Deploy to production

### Rollback (if needed)
```bash
# Mark migration as rolled back
npx prisma migrate resolve --rolled-back 20260727182707_add_invitation_table

# Or manually: Drop table
DROP TABLE IF EXISTS "Invitation" CASCADE;
```

## Related Migrations

### Dependencies (Must Run First)
- **1.1**: Organization table migration
  - Required for foreign key constraint
- **OrgRole enum**: Must exist
  - Created in organization_management migration

### Subsequent Migrations
- **1.4**: OrganizationPolicy (policy enforcement for invitations)
- **1.5**: BillingRecord (usage tracking when invitations accepted)
- **1.6**: AuditLog enhancements (audit trail for invitations)

## Testing Strategy

### Unit Tests
```typescript
describe('Invitation Table', () => {
  it('should create invitation with tokenHash uniqueness', async () => {
    const inv = await prisma.invitation.create({
      data: {
        organizationId: 'org-1',
        inviteeEmail: 'test@example.com',
        role: 'APPROVER',
        tokenHash: 'unique-hash-123',
        expiresAt: new Date(),
        invitedBy: 'creator',
      },
    });
    expect(inv.status).toBe('PENDING');
    expect(inv.tokenHash).toBe('unique-hash-123');
  });

  it('should enforce tokenHash uniqueness', async () => {
    await expect(
      prisma.invitation.create({
        data: {
          organizationId: 'org-2',
          inviteeEmail: 'other@example.com',
          role: 'APPROVER',
          tokenHash: 'unique-hash-123', // Duplicate
          expiresAt: new Date(),
          invitedBy: 'creator',
        },
      })
    ).rejects.toThrow('unique constraint');
  });

  it('should cascade delete on organization deletion', async () => {
    // Verify invitation is deleted when org is deleted
  });
});
```

### Integration Tests
```typescript
describe('Invitation Lifecycle', () => {
  it('should create, accept, and mark invitation as accepted', async () => {
    // Create
    const inv = await prisma.invitation.create({...});
    expect(inv.status).toBe('PENDING');

    // Accept
    const updated = await prisma.invitation.update({...});
    expect(updated.status).toBe('ACCEPTED');
    expect(updated.acceptedAt).toBeDefined();
  });

  it('should prevent acceptance of expired invitation', async () => {
    // Create with past expiresAt
    const inv = await prisma.invitation.create({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Acceptance should fail
  });
});
```

## Troubleshooting

### Common Issues

#### 1. Foreign Key Constraint Error
```
ERROR: insert or update on table "Invitation" violates foreign key constraint
```
**Cause**: Organization with organizationId doesn't exist
**Solution**: Create Organization first or check organizationId value

#### 2. Unique Constraint Error
```
ERROR: duplicate key value violates unique constraint "Invitation_token_hash_unique_idx"
```
**Cause**: Token hash already exists in table
**Solution**: Generate different token or use UUID for testing

#### 3. Enum Type Not Found
```
ERROR: type "OrgRole" does not exist
```
**Cause**: Migration run before OrgRole enum created
**Solution**: Run organization_management migration first

### Debug Queries
```sql
-- Check table structure
\d+ "Invitation"

-- Check indexes
SELECT * FROM pg_indexes WHERE tablename = 'Invitation';

-- Check foreign keys
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'Invitation';

-- Check data
SELECT id, status, expires_at FROM "Invitation" LIMIT 10;

-- Check cascade behavior
DELETE FROM "Organization" WHERE id = 'test-org';
SELECT COUNT(*) FROM "Invitation" WHERE organization_id = 'test-org';
-- Should return 0
```

## Next Steps

After this migration:

1. **Task 2.1**: Run migrations in development
   - Deploy to dev database
   - Run verification suite

2. **Task 3.1**: Implement InvitationService
   - Token generation and hashing
   - Email sending
   - Token validation

3. **Task 5.1**: Implement invitation endpoints
   - POST /invitations (create)
   - POST /invitations/{token}/accept (accept)
   - DELETE /invitations/{id} (revoke)

4. **Task 11.1**: Email service integration
   - Send invitation emails with tokens
   - Send notifications on acceptance

## References

### Design Document
- Section: "Invitation Link Security and Token Management" (Requirement 9)
- Section: "Team Member Invitations" (Requirement 2)

### Schema Definition
- `prisma/schema.prisma`: Invitation model definition
- `add_organization_management.sql`: Comprehensive organization schema

### Related Services
- `InvitationService`: Token generation and management
- `EmailService`: Invitation email sending
- `AuthorizationService`: SEP-10 verification

---

**Migration ID**: 20260727182707_add_invitation_table
**Target Database**: PostgreSQL 13+
**Prisma Version**: 5.22.0+
**Status**: Ready for deployment
