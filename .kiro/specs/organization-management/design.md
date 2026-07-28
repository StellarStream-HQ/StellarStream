# Organization Management Feature - Technical Design

## Overview

The Organization Management feature enables multi-tenant collaboration within StellarStream through organized team workspaces. This design translates the 14 requirements into an implementable architecture that integrates seamlessly with the existing StellarStream infrastructure.

The feature builds on:
- Stellar's G-address (group account) as unique organization identity
- SEP-10 wallet verification for member authentication
- Role-based access control (RBAC) with three roles: DRAFTER, APPROVER, EXECUTOR
- Immutable audit logging with cryptographic hash chains
- Multi-tenant isolation at the database query layer

## System Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        StellarStream Organization System                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐  │
│  │ Organization     │      │  Invitation      │      │  Authorization   │  │
│  │ Service          │──────│  Service         │      │  Service         │  │
│  │ • Create org     │      │ • Token gen      │      │ • Permission     │  │
│  │ • Manage members │      │ • Email send     │      │ • Role checks    │  │
│  │ • Policies       │      │ • Accept invite  │      │ • Access control │  │
│  └────────┬─────────┘      └────────┬─────────┘      └────────┬─────────┘  │
│           │                         │                         │             │
│           └──────────────┬──────────┴──────────────┬──────────┘             │
│                          │                         │                         │
│                   ┌──────▼──────────┐      ┌──────▼──────────┐             │
│                   │   Resource      │      │    Audit Log    │             │
│                   │   Service       │      │    Service      │             │
│                   │ • Ownership     │      │ • Hash chain    │             │
│                   │ • Multi-tenant  │      │ • Immutable log │             │
│                   │ • Sharing       │      │ • Export        │             │
│                   └────────┬────────┘      └────────┬────────┘             │
│                            │                        │                      │
│        ┌───────────────────┴────────────────────────┴────────┐             │
│        │                                                     │             │
│  ┌─────▼─────────────┐                      ┌──────▼────────────────┐    │
│  │ Policy Engine     │                      │  Email Service       │    │
│  │ • Spending limits │                      │ • Invitations        │    │
│  │ • Asset whitelist │                      │ • Notifications      │    │
│  │ • Quota enforce   │                      │ • Member updates     │    │
│  └─────┬─────────────┘                      └──────┬───────────────┘    │
│        │                                           │                      │
│        │                                    ┌──────▼──────────────┐      │
│        │                                    │  Billing Service    │      │
│        │                                    │ • Usage tracking    │      │
│        │                                    │ • Quota manage      │      │
│        └────────────────────────────────────│ • Free tier limits  │      │
│                                             └─────────────────────┘      │
│                                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                          Database Layer (Multi-Tenant)                       │
│                                                                               │
│  ┌─────────────────────┐  ┌──────────────────┐  ┌───────────────────┐     │
│  │  Organization       │  │ OrganizationMbr  │  │ Invitation        │     │
│  │  • gAddress (PK)    │  │ • orgId (FK)     │  │ • orgId (FK)      │     │
│  │  • name, desc       │  │ • memberAddr     │  │ • inviteeEmail    │     │
│  │  • metadata         │  │ • role (RBAC)    │  │ • tokenHash       │     │
│  │  • isActive         │  │ • status         │  │ • status, expires │     │
│  └─────────────────────┘  └──────────────────┘  └───────────────────┘     │
│                                                                               │
│  ┌──────────────────────┐  ┌─────────────────┐  ┌────────────────┐        │
│  │  OrganizationPolicy  │  │ BillingRecord   │  │  AuditLog      │        │
│  │  • orgId (FK)        │  │ • orgId (FK)    │  │ • orgId (FK)   │        │
│  │  • spendLimit        │  │ • period        │  │ • actionType   │        │
│  │  • assetWhitelist    │  │ • usage metrics │  │ • actor        │        │
│  │  • multisig config   │  │ • plan, status  │  │ • entryHash    │        │
│  └──────────────────────┘  └─────────────────┘  │ • parentHash   │        │
│                                                  └────────────────┘        │
│  ┌────────────────────────┐                                               │
│  │  MultisigProposal      │                                               │
│  │  • orgId (FK)          │                                               │
│  │  • txnXdr              │                                               │
│  │  • signatures (JSON)   │                                               │
│  │  • status, expires     │                                               │
│  └────────────────────────┘                                               │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Service Interactions

1. **User creates organization**
   - Organization Service validates input → Creates org record
   - Sets initial member (creator) as EXECUTOR
   - Initializes empty policy and billing record
   - Audit Log records creation event

2. **Admin invites team member**
   - Authorization Service verifies EXECUTOR role
   - Invitation Service generates token → Hashes it → Stores in DB
   - Email Service sends invitation with link + token
   - Audit Log records invitation event

3. **Member accepts invitation**
   - SEP-10 Validator verifies wallet ownership (always required)
   - Invitation Service validates token hash and expiry
   - Organization Member Service adds member to organization
   - Email Service notifies organization admins
   - Audit Log records acceptance

4. **Member accesses resource**
   - Authorization Service checks membership + role
   - Resource Service applies org-level query filters
   - Access Control ensures isolation (404 on cross-org access)
   - Audit Log records access attempt

5. **Policy enforced on transaction**
   - Policy Engine checks daily spending limits
   - Policy Engine validates asset whitelist
   - Transaction rejected if policy violated
   - Audit Log records policy check + decision

6. **Multisig transaction initiated**
   - Transaction Builder Service creates proposal
   - Notification Service alerts APPROVER/EXECUTOR members
   - Members sign via SEP-10 verification
   - When threshold reached → Transaction submitted
   - Audit Log records all signers + signatures

---

## Database Schema (Prisma Models)

### Core Organization Models

```prisma
// Organization model - represents team/business entity
model Organization {
  id            String   @id @default(cuid())
  gAddress      String   @unique  // Stellar G-address
  name          String
  description   String?
  logoUrl       String?
  customDomain  String?
  contactEmail  String?
  createdBy     String   // Creator's Stellar address
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members       OrganizationMember[]
  invitations   Invitation[]
  policies      OrganizationPolicy[]
  billingRecords BillingRecord[]
  multisigProposals MultisigProposal[]
  auditLogs     AuditLog[]

  @@index([gAddress])
  @@index([createdBy])
  @@index([isActive])
}

// Maps Stellar address to role within organization
model OrganizationMember {
  id            String   @id @default(cuid())
  organizationId String  @map("organization_id")
  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  orgAddress    String        // Organization's G-address
  memberAddress String        // Individual member's address
  role          OrgRole       // DRAFTER, APPROVER, EXECUTOR
  addedBy       String        // Who granted this membership
  isActive      Boolean  @default(true)
  lastActivityAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([organizationId, memberAddress])
  @@index([organizationId])
  @@index([memberAddress])
  @@index([role])
}

enum OrgRole {
  DRAFTER   // Can create/edit draft disbursements
  APPROVER  // Can review/approve pending disbursements
  EXECUTOR  // Can submit approved, manage settings
}

// Time-limited invitation tokens
model Invitation {
  id            String   @id @default(cuid())
  organizationId String  @map("organization_id")
  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  inviteeEmail  String
  role          OrgRole
  tokenHash     String   @unique  // SHA-256 hash (never plaintext)
  status        String   @default("PENDING")  // PENDING, ACCEPTED, EXPIRED, REVOKED
  expiresAt     DateTime
  acceptedBy    String?
  acceptedAt    DateTime?
  revokedBy     String?
  revokedAt     DateTime?
  invitedBy     String   // Creator of invitation
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([organizationId])
  @@index([status])
  @@index([expiresAt])
}
```

### Policy and Billing Models

```prisma
// Organization-level policies
model OrganizationPolicy {
  id                String   @id @default(cuid())
  organizationId    String   @unique @map("organization_id")
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  dailySpendLimitUsd Decimal?  // NULL = unlimited
  allowedAssets     String?    // JSON array of asset addresses; NULL = all
  requiresMultisig  Boolean  @default(false)
  multisigThreshold Int?
  updatedBy         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([organizationId])
}

// Usage tracking and billing
model BillingRecord {
  id                 String   @id @default(cuid())
  organizationId     String   @map("organization_id")
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  billingPeriod      String   // YYYY-MM format
  streamsCreated     Int      @default(0)
  disbursementsProcessed Int  @default(0)
  apiRequests        Int      @default(0)
  volumeUsd          Decimal  @default(0)
  chargeUsd          Decimal  @default(0)
  plan               String   @default("FREE")  // FREE, PRO, ENTERPRISE
  status             String   @default("ACTIVE")  // ACTIVE, PAST_DUE, SUSPENDED
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([organizationId, billingPeriod])
  @@index([organizationId])
  @@index([billingPeriod])
}

// Multi-signature transaction proposals
model MultisigProposal {
  id              String   @id @default(cuid())
  proposalId      String   @unique
  organizationId  String   @map("organization_id")
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  description     String?
  transactionXdr  String   // Transaction envelope XDR
  signatures      Json     @default("[]")  // [{signer, signature}, ...]
  requiredSigners Int
  status          String   @default("PENDING")  // PENDING, SIGNED, SUBMITTED, FAILED, EXPIRED
  submittedTxHash String?
  errorMessage    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  expiresAt       DateTime

  @@index([organizationId])
  @@index([status])
  @@index([createdAt])
}

// Immutable audit trail
model AuditLog {
  id            String   @id @default(cuid())
  organizationId String  @map("organization_id")
  organization  Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  
  actionType    String   // create, update, delete, access
  actor         String   // Member who performed action
  resourceId    String   // Affected resource ID
  resourceType  String   // organization, member, policy, etc.
  changes       Json?    // Pre/post state for updates
  entryHash     String?  // SHA-256 of this entry
  parentHash    String?  // SHA-256 of previous entry
  verified      Boolean  @default(false)
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime @default(now())

  @@index([organizationId])
  @@index([actionType])
  @@index([actor])
  @@index([createdAt, organizationId])
  @@index([resourceId])
}
```

---

## API Endpoints

### Organization Management


#### POST /api/organizations
Create a new organization

**Request:**
```json
{
  "name": "Acme Corp",
  "description": "Acme disbursement team",
  "gAddress": "GCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXW",
  "logoUrl": "https://...",
  "contactEmail": "contact@acme.com"
}
```

**Response (201):**
```json
{
  "id": "org-123",
  "gAddress": "GCXXX...",
  "name": "Acme Corp",
  "createdAt": "2025-01-15T10:00:00Z",
  "members": [{
    "memberAddress": "GXXX...",
    "role": "EXECUTOR"
  }]
}
```

#### GET /api/organizations/:organizationId
Get organization details

**Response (200):**
```json
{
  "id": "org-123",
  "gAddress": "GCXXX...",
  "name": "Acme Corp",
  "description": "...",
  "isActive": true,
  "memberCount": 5,
  "createdAt": "2025-01-15T10:00:00Z"
}
```

#### PUT /api/organizations/:organizationId/metadata
Update organization metadata (EXECUTOR only)

**Request:**
```json
{
  "name": "Acme Corporation",
  "logoUrl": "https://..."
}
```

#### GET /api/organizations/:organizationId/members
List organization members (any member can view)

**Response (200):**
```json
{
  "members": [
    {
      "memberAddress": "GXXX...",
      "role": "EXECUTOR",
      "joinDate": "2025-01-15T10:00:00Z",
      "lastActivityAt": "2025-01-20T15:30:00Z",
      "isActive": true
    }
  ]
}
```

#### POST /api/organizations/:organizationId/members/:memberAddress/role
Update member role (EXECUTOR only)

**Request:**
```json
{
  "role": "APPROVER"
}
```

#### DELETE /api/organizations/:organizationId/members/:memberAddress
Remove member from organization (EXECUTOR only)

**Response (204):** Member removed and notification email sent

---

### Invitation Management

#### POST /api/organizations/:organizationId/invitations
Create and send invitation (EXECUTOR only)

**Request:**
```json
{
  "inviteeEmail": "newmember@acme.com",
  "role": "APPROVER"
}
```

**Response (201):**
```json
{
  "id": "inv-123",
  "inviteeEmail": "newmember@acme.com",
  "role": "APPROVER",
  "token": "inv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // One-time only
  "expiresAt": "2025-01-22T10:00:00Z",
  "acceptUrl": "https://stellarstream.com/accept-invite?token=inv_xxx"
}
```

#### POST /api/invitations/:tokenHash/accept
Accept invitation (SEP-10 verified wallet required)

**Request:**
```json
{
  "walletAddress": "GXXX...",
  "sep10SignedChallenge": "AAAAAA..."
}
```

**Response (200):**
```json
{
  "organizationId": "org-123",
  "organizationName": "Acme Corp",
  "role": "APPROVER",
  "memberAddress": "GXXX...",
  "acceptedAt": "2025-01-20T10:00:00Z"
}
```

#### GET /api/organizations/:organizationId/invitations
List pending invitations (EXECUTOR only)

#### DELETE /api/organizations/:organizationId/invitations/:invitationId
Revoke invitation (EXECUTOR only)

---

### Resource Access & Sharing

#### GET /api/streams
List organization's streams (filtered by org)

**Query Parameters:**
- `organizationId`: Filter by organization
- `status`: Active, completed, etc.

**Response (200):**
```json
{
  "streams": [
    {
      "id": "stream-123",
      "sender": "GCXXX...",
      "receiver": "GYYY...",
      "amount": "1000000000",
      "status": "ACTIVE",
      "organizationId": "org-123",
      "createdBy": "GZZZ..."
    }
  ]
}
```

#### POST /api/streams
Create stream (organization-owned)

**Request:**
```json
{
  "organizationId": "org-123",
  "receiver": "GYYY...",
  "amount": "1000000000",
  "asset": "native"
}
```

**Note:** Stream is owned by organization (via G-address), all org members with appropriate roles can access it.

#### GET /api/disbursements
List organization's disbursements (filtered by org)

#### POST /api/disbursements
Create disbursement (organization-owned, EXECUTOR/DRAFTER role)

---

### Policy & Billing

#### GET /api/organizations/:organizationId/policy
Get organization policy (any member)

**Response (200):**
```json
{
  "id": "policy-123",
  "dailySpendLimitUsd": 10000,
  "allowedAssets": [
    "USDC:GBUQWP3BOUZX34ULNQG23RQ6F5LGXLQNUKMXONG5SJIQVOOOOP3TVLJQ",
    "native"
  ],
  "requiresMultisig": false,
  "updatedAt": "2025-01-15T10:00:00Z"
}
```

#### PUT /api/organizations/:organizationId/policy
Update organization policy (EXECUTOR only)

**Request:**
```json
{
  "dailySpendLimitUsd": 50000,
  "allowedAssets": [
    "USDC:G...",
    "native"
  ]
}
```

#### GET /api/organizations/:organizationId/billing
Get billing and usage (any member)

**Response (200):**
```json
{
  "billingPeriod": "2025-01",
  "plan": "PRO",
  "streamsCreated": 15,
  "streamsLimit": 100,
  "disbursementsProcessed": 245,
  "disbursementsLimit": null,
  "volumeUsd": 125000,
  "chargeUsd": 500
}
```

---

### Audit & Compliance

#### GET /api/organizations/:organizationId/audit-logs
Get audit logs (any member, filtered by org)

**Query Parameters:**
- `actionType`: create, update, delete
- `dateFrom`: ISO-8601 date
- `dateTo`: ISO-8601 date
- `limit`: Max 100

**Response (200):**
```json
{
  "logs": [
    {
      "id": "log-123",
      "actionType": "member_added",
      "actor": "GXXX...",
      "resourceId": "org-123",
      "resourceType": "member",
      "changes": {
        "memberAddress": "GYYY...",
        "role": "APPROVER"
      },
      "entryHash": "abc123def...",
      "parentHash": "xyz789...",
      "verified": true,
      "createdAt": "2025-01-20T10:00:00Z"
    }
  ]
}
```

#### GET /api/organizations/:organizationId/audit-logs/export
Export audit logs (EXECUTOR only)

**Query Parameters:**
- `format`: csv or json
- `dateFrom`: ISO-8601 date
- `dateTo`: ISO-8601 date

**Response (200):** CSV/JSON file download with cryptographic signature

---

### Multi-Signature Transactions

#### POST /api/organizations/:organizationId/multisig-proposals
Create multi-sig proposal (EXECUTOR only)

**Request:**
```json
{
  "description": "Large disbursement",
  "transactionXdr": "AAAAAgAAA...",
  "requiredSigners": 2
}
```

**Response (201):**
```json
{
  "proposalId": "prop-123",
  "status": "PENDING",
  "requiredSigners": 2,
  "currentSignatures": 0,
  "expiresAt": "2025-01-27T10:00:00Z"
}
```

#### POST /api/multisig-proposals/:proposalId/sign
Sign proposal (EXECUTOR/APPROVER, SEP-10 verified)

**Request:**
```json
{
  "signature": "AAAA...",
  "signerAddress": "GXXX..."
}
```

**Response (200):**
```json
{
  "proposalId": "prop-123",
  "status": "SIGNED",
  "currentSignatures": 2,
  "requiredSigners": 2,
  "submittedTxHash": "abc123..."
}
```

#### GET /api/organizations/:organizationId/multisig-proposals
List multi-sig proposals (any member)

---

## Service Layer Design

### 1. Organization Service

**Responsibilities:**
- Organization CRUD operations
- Member initialization
- Policy and billing record initialization
- Metadata management

**Key Methods:**
```typescript
class OrganizationService {
  async create(input: CreateOrganizationInput): Promise<OrganizationDTO>
  async getById(orgId: string): Promise<OrganizationDTO | null>
  async getByAddress(gAddress: string): Promise<OrganizationDTO | null>
  async updateMetadata(orgId: string, input: UpdateMetadataInput): Promise<OrganizationDTO>
  async isActive(orgId: string): Promise<boolean>
}
```

**Constraints:**
- G-address must be valid Stellar format (56 chars, starts with 'G')
- Organization name required (3-255 chars)
- Creator automatically becomes EXECUTOR
- Empty policy initialized (unlimited spending, all assets)

---

### 2. Invitation Service

**Responsibilities:**
- Token generation (32+ bytes entropy)
- Token hashing (SHA-256, never store plaintext)
- Email sending via Email Service
- Token validation and expiry checking
- Invitation acceptance and token revocation

**Key Methods:**
```typescript
class InvitationService {
  generateToken(): string  // Returns plaintext token (one-time)
  hashToken(token: string): string  // SHA-256 hash
  async createInvitation(input: CreateInvitationInput): Promise<InvitationWithToken>
  async acceptInvitation(tokenHash: string, memberAddress: string): Promise<OrganizationMember>
  async revokeInvitation(invitationId: string, revokedBy: string): Promise<void>
  async validateToken(tokenHash: string): Promise<boolean>
  isExpired(expiresAt: Date): boolean
  isRevoked(status: string): boolean
}
```

**Constraints:**
- Token valid for 7 days
- Token invalidated after acceptance (USED status)
- Token invalidated if revoked (REVOKED status)
- Token status updated to EXPIRED after expiry timestamp
- Email ALWAYS sent even if other errors occur

---

### 3. Authorization Service

**Responsibilities:**
- Role-based permission checks
- Cross-organization access prevention
- Permission matrix enforcement

**Permission Matrix:**

| Action | DRAFTER | APPROVER | EXECUTOR |
|--------|---------|----------|----------|
| Create stream | ✓ | ✓ | ✓ |
| Create disbursement draft | ✓ | ✓ | ✓ |
| Approve disbursement | | ✓ | ✓ |
| Execute/submit disbursement | | | ✓ |
| Manage members | | | ✓ |
| Manage policies | | | ✓ |
| View members | ✓ | ✓ | ✓ |
| View audit logs | ✓ | ✓ | ✓ |

**Key Methods:**
```typescript
class AuthorizationService {
  async authorize(orgId: string, memberAddress: string, action: Action): Promise<void>
  async getPermissions(orgId: string, memberAddress: string): Promise<Permission[]>
  async requirePermission(orgId: string, memberAddress: string, action: Action): Promise<void>
  async verifySameOrganization(orgId: string, memberAddress: string): Promise<void>
  async requireAdmin(orgId: string, memberAddress: string): Promise<void>
}
```

**Constraints:**
- All authorization checks throw AuthorizationError on failure
- Cross-org attempts return 404 (not 403) to avoid leaking org existence
- Permission checks are synchronous where possible (cached in org context)

---

### 4. Organization Member Service

**Responsibilities:**
- Member CRUD operations
- Role assignment and updates
- Permission lookups
- Member deactivation

**Key Methods:**
```typescript
class OrganizationMemberService {
  async addMember(orgId: string, memberAddress: string, role: OrgRole, addedBy: string): Promise<OrganizationMember>
  async getMember(orgId: string, memberAddress: string): Promise<OrganizationMember | null>
  async isMember(orgId: string, memberAddress: string): Promise<boolean>
  async getRole(orgId: string, memberAddress: string): Promise<OrgRole | null>
  async hasPermission(orgId: string, memberAddress: string, action: Action): Promise<boolean>
  async updateRole(orgId: string, memberAddress: string, newRole: OrgRole, updatedBy: string): Promise<OrganizationMember>
  async removeMember(orgId: string, memberAddress: string, removedBy: string): Promise<void>
  async listMembers(orgId: string): Promise<OrganizationMember[]>
}
```

**Constraints:**
- Member address must be unique per organization
- Role must be one of DRAFTER, APPROVER, EXECUTOR
- Removal sets isActive to false (soft delete)
- Cannot remove last EXECUTOR (checked at API level)
- Silent ignore on unauthorized removal attempts (no error response to requester)

---

### 5. Resource Service

**Responsibilities:**
- Resource ownership management
- Multi-tenant query filtering
- Access control enforcement
- Isolation verification

**Key Methods:**
```typescript
class ResourceService {
  async createStream(orgId: string, input: CreateStreamInput): Promise<Stream>
  async getStream(orgId: string, streamId: string): Promise<Stream | null>  // Filters by org
  async listStreams(orgId: string, filters?: StreamFilters): Promise<Stream[]>  // Auto-filters
  async createDisbursement(orgId: string, input: CreateDisbursementInput): Promise<Disbursement>
  async getDisbursement(orgId: string, disbursementId: string): Promise<Disbursement | null>
  async listDisbursements(orgId: string, filters?: DisbursementFilters): Promise<Disbursement[]>
  async verifyResourceOwnership(resourceId: string, orgId: string): Promise<boolean>
}
```

**Constraints:**
- All queries automatically filter by organization
- Non-existent or cross-org resources return 404 (not 403)
- Resource is created with org's G-address as owner
- All org members (with appropriate roles) get access
- Removed members lose access immediately

---

### 6. Policy Engine Service

**Responsibilities:**
- Daily spending limit enforcement
- Asset whitelist validation
- Quota checking

**Key Methods:**
```typescript
class PolicyEngineService {
  async checkDisbursementPolicy(orgId: string, amount: Decimal, asset: string): Promise<void>
  async checkQuota(orgId: string, resourceType: string): Promise<boolean>
  async getDailySpent(orgId: string, date: Date): Promise<Decimal>
  async getQuotaRemaining(orgId: string, resourceType: string): Promise<number>
}
```

**Constraints:**
- Spending limit checked as cumulative per calendar day (UTC)
- If amount == limit, allow transaction
- If amount > limit, reject
- Asset whitelist: if null, all assets allowed; if defined, only assets in list allowed
- Free tier quotas: 10 streams, 100 disbursements/month
- Non-free tiers: NO conservative limits regardless of payment status

---

### 7. Audit Log Service

**Responsibilities:**
- Immutable audit trail recording
- Hash chain computation and verification
- Audit log filtering and export
- Compliance reporting

**Key Methods:**
```typescript
class AuditLogService {
  async logAction(orgId: string, data: AuditActionData): Promise<AuditLog>
  async getOrgLogs(orgId: string, filters: AuditFilter): Promise<AuditLog[]>
  async exportLogs(orgId: string, format: 'csv' | 'json', filters: AuditFilter): Promise<Buffer>
  async verifyChain(startId?: string): Promise<VerifyResult>
  async computeEntryHash(entry: AuditLog, parentHash?: string): string
}
```

**Hash Chain Algorithm:**
```
entryHash = SHA-256(canonical(
  organizationId +
  actionType +
  actor +
  resourceId +
  resourceType +
  changes +
  timestamp +
  parentHash
))

Where parentHash is entryHash of previous entry (chronologically)
First entry has parentHash = null
```

**Constraints:**
- All actions logged before returning success to caller
- If logging fails, the action is rejected
- Logs include: orgId, actionType, actor, resourceId, resourceType, changes, IP, user agent
- Logs filtered by org when accessed (no cross-org log visibility)
- Logs immutable after creation (verify hash chain integrity)
- Export includes all fields + digital signature

---

### 8. Email Service

**Responsibilities:**
- Send invitation emails
- Send member notifications
- Send policy change alerts

**Key Methods:**
```typescript
class EmailService {
  async sendInvitation(inviteeEmail: string, inviteData: InvitationEmailData): Promise<void>
  async sendMemberRemoved(memberEmail: string, orgName: string): Promise<void>
  async sendRoleChanged(memberEmail: string, newRole: OrgRole, orgName: string): Promise<void>
  async sendPolicyUpdated(orgId: string, changes: PolicyChanges): Promise<void>
}
```

**Constraints:**
- Invitation email ALWAYS sent even if other errors occur in same request
- Email failures do NOT block the operation (best-effort delivery)
- Email includes invitation token in link
- Email includes 7-day expiry time
- Member email notifications are optional (org configurable, but invitations always sent)

---

## Multi-Tenancy Strategy

### Query Layer Isolation

All database queries include organization context filtering:

```typescript
// Example: Finding streams for a member
const streams = await prisma.stream.findMany({
  where: {
    OR: [
      { sender: { in: [org1Address, org2Address, ...] } },
      { receiver: { in: [org1Address, org2Address, ...] } }
    ]
  }
});
// Only streams where org is sender or receiver are returned
```

### Middleware Integration

Add to Express middleware chain:
```typescript
app.use((req, res, next) => {
  // Extract organization context from request
  req.organizationId = extractOrgIdFromAuth(req);
  req.memberAddress = extractMemberAddress(req);
  next();
});

// Verify membership before handlers
app.use(async (req, res, next) => {
  const isMember = await organizationMemberService.isMember(
    req.organizationId,
    req.memberAddress
  );
  if (!isMember) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});
```

### Database Constraints

- `OrganizationMember` has unique constraint on (organizationId, memberAddress)
- `Invitation` foreign key ensures invitations belong to existing orgs
- `AuditLog` includes organizationId in all queries
- Indexes on (organizationId, ...) for efficient filtering

---

## Resource Isolation

### Access Control Rules

1. **Query Phase**: All queries filtered by organization automatically
2. **Verification Phase**: Re-verify member belongs to resource's organization
3. **Error Response**: Return 404 for both "not found" and "cross-org access" (same response)
4. **Logging**: Log cross-org access attempts as security events

### Example: Getting a Stream

```typescript
async getStream(orgId: string, streamId: string): Promise<Stream> {
  // 1. Verify member belongs to org
  const isMember = await organizationMemberService.isMember(orgId, memberAddress);
  if (!isMember) throw new AuthorizationError('Not found', 404);
  
  // 2. Get org's G-address
  const org = await organizationService.getById(orgId);
  
  // 3. Query with org filter
  const stream = await prisma.stream.findUnique({
    where: { id: streamId },
    // Implicit: only return if sender or receiver is org's G-address
  });
  
  // 4. Verify org ownership
  if (!stream || (stream.sender !== org.gAddress && stream.receiver !== org.gAddress)) {
    return null;  // Return 404 to caller
  }
  
  return stream;
}
```

---

## Role-Based Access Control Details

### DRAFTER Permissions
- Create and edit draft disbursements
- View organization resources
- View audit logs (own org only)
- View member list
- Cannot approve, execute, or manage settings

### APPROVER Permissions
- Create disbursements (draft and final)
- Approve pending disbursements
- View organization resources and audit logs
- View member list
- Cannot execute, remove members, or manage policies

### EXECUTOR Permissions (Full Admin)
- All DRAFTER + APPROVER permissions
- Execute/submit disbursements
- Invite new members
- Remove members
- Update member roles
- Update organization policies
- Export organization data
- Access audit logs
- Create multi-signature proposals

---

## Security Considerations

### SEP-10 Verification

- **Required for**: Accepting invitations (always required, ignoring existing auth)
- **Process**: 
  1. Client requests challenge from `/auth/challenge`
  2. Client signs challenge with their Stellar wallet
  3. Client submits signed challenge to invitation acceptance endpoint
  4. Server verifies signature cryptographically
  5. Member added after verification

### Token Security

- **Generation**: Cryptographically random (32+ bytes)
- **Storage**: SHA-256 hash only (plaintext never stored)
- **Transmission**: Embedded in URLs (single-use)
- **Expiry**: 7 days
- **Revocation**: Mark status as USED or REVOKED (prevent replay)

### Cross-Organization Attack Prevention

- **404 Response**: All authorization failures return 404 (same as not-found)
- **No Information Leakage**: Cannot determine if org/resource exists
- **Query Filtering**: All queries automatically scoped to user's org
- **Audit Logging**: Cross-org access attempts logged as security events

### Silent Removal Behavior

- When non-EXECUTOR attempts to remove a member:
  - No error response (no 403)
  - Request silently ignored
  - Audit log records attempt
  - No feedback to requester

---

## Billing and Quota Management

### Free Tier Quotas

Organizations on the FREE plan have conservative limits enforced:

- **Streams**: Maximum 10 active streams
- **Disbursements**: Maximum 100 per calendar month
- **API requests**: No limit at service level (rate limited at gateway)

**Enforcement Rules:**
- Check quota BEFORE creating resource
- Return error if quota would be exceeded
- Monthly quotas reset at start of billing period (calendar month, UTC)
- Quotas are "soft" - allow UP TO the limit (e.g., 10 streams allowed)

**Quota Tracking:**
```sql
SELECT 
  COUNT(*) as active_streams
FROM Stream
WHERE organizationId = ? AND status = 'ACTIVE'

SELECT 
  COUNT(*) as disbursements_this_month
FROM Disbursement
WHERE organizationId = ? 
  AND YEAR(createdAt) = YEAR(NOW())
  AND MONTH(createdAt) = MONTH(NOW())
```

### Non-Free Tier Quotas

Organizations on PRO or ENTERPRISE plans:
- **NO conservative limits applied** under any circumstances
- Even during payment failures or plan downgrades
- Limits only in organization policies (daily spend, asset whitelist)

### Billing Period Tracking

- **Billing Period**: Calendar month (YYYY-MM format)
- **Period Start**: First day of month (00:00:00 UTC)
- **Period End**: Last day of month (23:59:59 UTC)
- **Usage Accumulated**: During period
- **Billing Calculated**: At end of period

**BillingRecord Table:**
```
billingPeriod: "2025-01"
streamsCreated: 5          // Cumulative during period
disbursementsProcessed: 42 // Cumulative during period
volumeUsd: 15000           // Total USD value
chargeUsd: 150             // Calculated at period end
plan: "FREE"
status: "ACTIVE"
```

---

## Multi-Signature Transactions

### Transaction Flow

1. **Proposal Creation** (EXECUTOR)
   - Create proposal with transaction XDR
   - Set required signature count (threshold)
   - Notify all APPROVER/EXECUTOR members
   - Set expiry (7 days from creation)

2. **Member Signing**
   - Each eligible member signs via SEP-10
   - Signature added to proposal.signatures array
   - Signer address + signature stored as JSON
   - Maximum one signature per member

3. **Threshold Check**
   - After each new signature, check if threshold reached
   - When threshold == current signatures, auto-submit to blockchain

4. **Submission**
   - Transaction envelope submitted to Stellar network
   - Transaction hash recorded in proposal.submittedTxHash
   - Status updated to SUBMITTED
   - All signers logged in audit trail

5. **Expiry Handling**
   - If proposal expires before collecting all signatures
   - Status updated to EXPIRED
   - Can create new proposal with same transaction
   - Transaction NOT submitted if expired

### Data Model

```typescript
interface MultisigProposal {
  proposalId: string;           // Unique ID
  organizationId: string;
  description: string;          // Human description
  transactionXdr: string;       // Full transaction envelope
  signatures: {
    signer: string;            // Member address
    signature: string;         // Signature bytes (base64)
    signedAt: Date;
  }[];
  requiredSigners: number;      // Threshold
  status: "PENDING" | "SIGNED" | "SUBMITTED" | "FAILED" | "EXPIRED";
  submittedTxHash: string | null;
  errorMessage: string | null;
  expiresAt: Date;
  createdAt: Date;
}
```

### Signature Verification

```typescript
import StellarSdk from 'stellar-sdk';

// Verify each signature cryptographically
function verifySignature(signer: string, signature: string, txXdr: string): boolean {
  const buffer = Buffer.from(signature, 'base64');
  const tx = new StellarSdk.TransactionBuilder.fromXDR(txXdr, StellarSdk.Networks.TESTNET_NETWORK_PASSPHRASE);
  
  return StellarSdk.Keypair.fromPublicKey(signer).verify(txXdr, buffer);
}
```

---

## Testing Strategy

### Unit Tests

**Test Coverage Areas:**

1. **Organization Service**
   - Create organization with valid/invalid G-address
   - Duplicate G-address prevention
   - Creator becomes EXECUTOR
   - Metadata updates

2. **Invitation Service**
   - Token generation (entropy check)
   - Token hashing consistency
   - Expiry checking
   - Token validation and revocation
   - Replay attack prevention

3. **Authorization Service**
   - Permission matrix enforcement
   - Cross-organization access prevention
   - 404 responses on unauthorized access
   - Silent removal for non-EXECUTOR

4. **Organization Member Service**
   - Add/remove member operations
   - Role updates
   - Permission lookups
   - Member deactivation

5. **Policy Engine Service**
   - Daily spending limit enforcement
   - Asset whitelist validation
   - Quota checking (free tier limits)
   - No limits for non-free tiers

6. **Audit Log Service**
   - Log entry creation
   - Hash chain computation
   - Chain verification
   - Organization filtering

### Integration Tests

1. **Invitation Flow**
   - Admin invites user
   - User accepts with SEP-10
   - User becomes member
   - Email sent
   - Audit logged

2. **Multi-Tenant Isolation**
   - Org A members cannot access Org B resources
   - Queries return only Org's data
   - Cross-org requests return 404

3. **Policy Enforcement**
   - Transaction rejected if limit exceeded
   - Transaction rejected if asset not whitelisted
   - Audit log records policy decision

4. **Multi-Signature**
   - Proposal creation
   - Member signing
   - Threshold collection
   - Auto-submission
   - Expiry handling

### End-to-End Tests

1. **Complete Organization Lifecycle**
   - Create organization
   - Invite members
   - Members join via SEP-10
   - Create resources
   - Export audit logs
   - Verify data isolation

2. **Multi-Signature Transaction**
   - Create proposal
   - Multiple members sign
   - Transaction submitted
   - Verify all signatures recorded

---

## Error Handling

### HTTP Status Codes

- **400 Bad Request**: Invalid input format
- **401 Unauthorized**: Missing/invalid authentication
- **403 Forbidden**: Insufficient permissions (EXECUTOR only operations, etc.)
- **404 Not Found**: Resource not found OR cross-organization access attempt
- **409 Conflict**: Duplicate G-address, member already exists
- **422 Unprocessable Entity**: Validation failure (policy violation, quota exceeded)
- **500 Internal Server Error**: Database/service failures

### Error Response Format

```json
{
  "error": "Insufficient permissions",
  "code": "FORBIDDEN",
  "details": {
    "resource": "organization",
    "action": "manage_policy"
  }
}
```

### Common Error Scenarios

| Scenario | Status | Response |
|----------|--------|----------|
| Non-EXECUTOR invites member | 403 | `Insufficient permissions` |
| User not in organization | 404 | `Not found` |
| Invalid token | 400 | `Invalid invitation token` |
| Token expired | 400 | `Invitation expired` |
| Policy violation (spend limit) | 422 | `Daily spending limit exceeded` |
| Quota exceeded (free tier) | 422 | `Stream limit reached for this month` |
| Duplicate member | 409 | `Member already exists` |
| Cross-org resource access | 404 | `Not found` (same as not exists) |

---

## Deployment Considerations

### Environment Variables

```bash
# Email service
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@stellarstream.com
SMTP_PASSWORD=***

# Stellar blockchain
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
STELLAR_RPC_URL="https://soroban-testnet.stellar.org"

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/stellarstream"

# Feature flags
ENABLE_MULTISIG=true
ENABLE_ORGANIZATION_BILLING=true
```

### Database Migrations

Required migrations:
1. Create Organization, OrganizationMember, Invitation tables
2. Create OrganizationPolicy, BillingRecord tables
3. Create MultisigProposal table
4. Create/enhance AuditLog table with hash chain fields
5. Add organizationId foreign keys to Stream, Disbursement, etc.
6. Add indexes for organization-filtered queries

### Monitoring

**Key Metrics:**
- Invitation acceptance rate
- Average member count per organization
- Policy violation frequency
- Multisig proposal approval time
- Audit log entry rate
- Cross-org access attempts (security)

**Alerts:**
- Frequent policy violations for an org
- Failed email deliveries
- Multisig proposal expiry rate
- Database query performance on multi-org filters

---

## Correctness Properties

This feature involves pure business logic (organization management, RBAC, policy enforcement) suitable for property-based testing.

### Property 1: Organization Creation Idempotence
*For any* valid organization input, creating an organization with the same G-address twice SHALL result in a conflict error on the second attempt and prevent duplicate organization records in the database.

**Validates: Requirement 1.5**

### Property 2: Member Access Isolation
*For any* two distinct organizations with different members, queries from Org A members SHALL never return resources belonging to Org B, and SHALL return 404 when accessing Org B resources.

**Validates: Requirement 5 (Resource Isolation and Multi-Tenancy)**

### Property 3: Role-Based Permission Enforcement
*For any* member with a specific role performing an action, the authorization service SHALL grant permission if and only if that action is in the member's role permissions.

**Validates: Requirement 3 (Role-Based Access Control)**

### Property 4: Invitation Token Replay Prevention
*For any* accepted invitation token, attempting to use that same token again SHALL return an invalid token error.

**Validates: Requirement 9.4 (Token Replay Prevention)**

### Property 5: Daily Spending Limit Round-trip
*For any* disbursement amount that equals the daily spending limit, the transaction SHALL be allowed; but any additional disbursement on the same day SHALL be rejected.

**Validates: Requirement 6.4 (Spending Limits)**

### Property 6: Free Tier Quota Enforcement
*For any* organization on the FREE plan, attempting to create more than 10 active streams SHALL result in a quota exceeded error.

**Validates: Requirement 7.7 (Free Tier Quotas)**

### Property 7: Audit Log Hash Chain Integrity
*For any* sequence of audit log entries, computing and verifying the hash chain SHALL detect any tampering or reordering of entries.

**Validates: Requirement 10.3 (Audit Log Hash Chain)**

### Property 8: Multi-Signature Threshold Collection
*For any* multi-signature proposal requiring N signatures, the transaction SHALL not be submitted until exactly N signatures are collected.

**Validates: Requirement 8.5 (Signature Collection)**

---

## Conclusion

This design provides a comprehensive, production-ready architecture for organization management in StellarStream. It integrates seamlessly with existing services while maintaining:

- **Multi-tenant isolation** through query-layer filtering and 404 responses
- **Security** through SEP-10 verification, token hashing, and cryptographic audit logging
- **Compliance** via immutable audit trails with hash chain verification
- **Scalability** through role-based access and efficient database indexing
- **Observability** through comprehensive audit logging and exportable reports

All 14 requirements are addressed across the service layer, database schema, API endpoints, and security controls.



---

## Correctness Properties - Property Reflection & Refinement

After analyzing all 14 requirements and their 93 acceptance criteria, I've identified which criteria are suitable for property-based testing and which require example-based or integration testing.

**PBT Applicability**: This feature has significant PBT-suitable criteria because it involves:
- Pure business logic (RBAC permissions, quota enforcement, policy checks)
- Universal rules that should hold across all inputs (org isolation, spending limits)
- Sufficient input variation to warrant 100+ iterations (random role/action pairs, spending amounts, etc.)

**Test Distribution:**
- **Testable as Properties**: 42 criteria
- **Testable as Examples**: 28 criteria  
- **Testable as Integration**: 15 criteria
- **Not Testable**: 8 criteria (external service behavior, UI/UX, optional features)

### Property Reflection - Redundancy Analysis

Reviewing all properties for logical overlap:

1. **Isolation Properties** (5.1, 5.3, 5.5) → Consolidated into **Property 2: Multi-Tenant Isolation**
   - All test the same concept: org data is isolated across queries
   
2. **Token Security Properties** (9.1, 9.2, 9.3, 9.4) → Consolidated into **Property 4: Token Security**
   - All test token generation, hashing, verification, and replay prevention
   
3. **Audit Logging Properties** (10.1, 10.3, 10.4, 10.5) → Consolidated into **Property 7: Audit Integrity**
   - All test audit log creation, hash chain, and org-scoped access
   
4. **Policy Enforcement Properties** (6.3, 6.4, 6.5) → Consolidated into **Property 5: Policy Enforcement**
   - All test spending limits and asset whitelist validation
   
5. **Access Control Properties** (3.2, 3.3, 4.4) → Consolidated into **Property 3: Permission Matrix**
   - All test authorization against the role permission matrix

---

## Final Correctness Properties

### Property 1: Duplicate Prevention
*For any* organization creation attempt with an existing G-address, the system SHALL reject the creation with a conflict error and prevent duplicate organization records in the database.

**Validates: Requirements 1.5**

### Property 2: Multi-Tenant Isolation
*For any* two distinct organizations with different members, queries from Organization A members SHALL exclusively return resources belonging to Organization A, and SHALL return 404 for any cross-organization resource access attempts (whether the resource exists or not).

**Validates: Requirements 5.1, 5.2, 5.3, 5.5**

### Property 3: Permission Matrix Enforcement
*For any* member with a specific role attempting a specific action, the authorization service SHALL permit the action if and only if that action is within the role's permission matrix, AND SHALL reject with 403 Forbidden for all unauthorized action attempts.

**Validates: Requirements 3.2, 3.3**

### Property 4: Token Security & Replay Prevention
*For any* generated invitation token, the system SHALL: (1) generate with cryptographic entropy (32+ bytes), (2) store only the SHA-256 hash, (3) accept the token until expiry or usage, and (4) reject any reuse attempt after acceptance or revocation.

**Validates: Requirements 9.1, 9.2, 9.4, 2.1**

### Property 5: Policy Enforcement
*For any* disbursement attempt within an organization, the system SHALL: (1) allow transactions with amounts at or below daily spending limits, (2) reject transactions exceeding limits, and (3) reject transactions using non-whitelisted assets regardless of amount.

**Validates: Requirements 6.3, 6.4, 6.5**

### Property 6: Quota Enforcement (Free Tier)
*For any* organization on the FREE billing plan, the system SHALL prevent creation of additional resources once quotas are reached (10 streams, 100 disbursements per calendar month), while allowing non-FREE tier organizations unlimited resource creation without conservative limits.

**Validates: Requirements 7.5, 7.7**

### Property 7: Audit Log Integrity
*For any* sequence of audit log entries created within an organization, the system SHALL maintain an unbroken hash chain where each entry's hash is computed from its data and the previous entry's hash, and SHALL detect any tampering or reordering through chain verification.

**Validates: Requirements 10.1, 10.3, 10.5**

### Property 8: Role-Based Resource Sharing
*For any* resource (stream or disbursement) created by an organization member, all organization members SHALL be able to access the resource according to their roles, regardless of who created it, and removed members SHALL immediately lose access to all organization resources.

**Validates: Requirements 4.1, 4.2, 4.5**

### Property 9: Multi-Signature Threshold Collection
*For any* multi-signature proposal requiring N signatures within an organization with multisig enabled, the system SHALL reject submission attempts until exactly N signatures are collected, and SHALL auto-submit the transaction immediately upon collecting the Nth signature.

**Validates: Requirements 8.1, 8.5, 8.6**

### Property 10: Creator Becomes Initial EXECUTOR
*For any* organization creation, the creator of that organization SHALL automatically become a member with the EXECUTOR role, and this membership relationship SHALL be queryable and immutable for that creation event.

**Validates: Requirements 1.2**

### Property 11: Member Deactivation on Removal
*For any* member removal from an organization by an EXECUTOR member, the system SHALL: (1) set the member's isActive flag to false, (2) make all subsequent access attempts by that member return 404, and (3) create an audit log entry recording the removal action.

**Validates: Requirements 3.5, 4.5, 12.3**

### Property 12: Spending Limit Boundary Behavior
*For any* organization with a configured daily spending limit L, disbursements with amount exactly equal to L SHALL succeed, while disbursements with amount greater than L on the same day SHALL fail, creating precise boundary behavior.

**Validates: Requirements 6.4**

### Property 13: Organization Policy Initialization
*For any* organization created, the system SHALL automatically initialize an OrganizationPolicy record with: (1) unlimited spending (NULL dailySpendLimitUsd), (2) unrestricted assets (NULL allowedAssets), and (3) multisig disabled by default.

**Validates: Requirements 1.4**

### Property 14: Cross-Organization Transaction Prevention
*For any* transaction initiated by a member of Organization A attempting to execute against resources owned by Organization B, the system SHALL reject the transaction with a 404 response (never 403), and SHALL log the attempt as a security event.

**Validates: Requirements 5.6**

---

## Testing Strategy - Implementation Guidance

### Unit Tests with Property-Based Testing

Use a property-based testing library (e.g., fast-check for Node.js/TypeScript):

```typescript
// Example: Test Property 3 (Permission Matrix)
import * as fc from 'fast-check';

describe('Authorization Service', () => {
  // Property 3: Permission Matrix Enforcement
  test('should enforce role permission matrix for all role/action combinations', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ role: 'DRAFTER', action: 'create_stream', shouldAllow: true }),
          fc.constant({ role: 'DRAFTER', action: 'execute_disbursement', shouldAllow: false }),
          fc.constant({ role: 'APPROVER', action: 'approve_disbursement', shouldAllow: true }),
          fc.constant({ role: 'APPROVER', action: 'manage_members', shouldAllow: false }),
          fc.constant({ role: 'EXECUTOR', action: 'manage_policy', shouldAllow: true }),
          // ... more combinations
        )
      ),
      async (testCase) => {
        const hasPermission = await authService.hasPermission(
          testCase.role,
          testCase.action
        );
        expect(hasPermission).toBe(testCase.shouldAllow);
      },
      { numRuns: 100 }
    );
  });
});
```

### Example-Based Tests

For criteria better tested with specific examples:

```typescript
describe('Invitation Service - Email Sending', () => {
  // Requirement 2.2: Email sent even if other errors occur
  test('should send invitation email even if metadata update fails', async () => {
    const emailSpy = jest.spyOn(emailService, 'send');
    
    // Mock metadata save to fail
    jest.spyOn(db, 'saveMetadata').mockRejectedValueOnce(new Error('DB error'));
    
    const invitation = await invitationService.createInvitation({
      organizationId: 'org-123',
      inviteeEmail: 'user@example.com',
      role: 'APPROVER'
    });
    
    expect(emailSpy).toHaveBeenCalled();
    expect(invitation).toBeDefined();
  });
});
```

### Integration Tests

For external service interactions:

```typescript
describe('Organization Service - Email & Audit Integration', () => {
  // Requirement 11.1: Email sent with correct content
  test('should send invitation email with org details and link', async () => {
    const mockEmailService = {
      send: jest.fn().mockResolvedValue(undefined)
    };
    
    await invitationService.createInvitation(
      {
        organizationId: 'org-123',
        inviteeEmail: 'user@example.com',
        role: 'APPROVER'
      },
      mockEmailService
    );
    
    expect(mockEmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: expect.stringContaining('invited')
      })
    );
  });
});
```

### Test Coverage Requirements

- **Unit Tests**: 80%+ code coverage on core services
- **Property Tests**: Minimum 100 iterations per property
- **Integration Tests**: At least 1-3 examples per external service interaction
- **End-to-End**: Full invite-to-access workflow

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Run property-based tests
  run: npm test -- --testNamePattern="Property|PROPERTY" --coverage
  
- name: Verify PBT minimum iterations
  run: npm test -- --config pbt.jest.config.js
```

---

## Summary

The Organization Management feature provides:

✓ Complete multi-tenant architecture with query-layer isolation  
✓ 14 requirements translated into 93 testable acceptance criteria  
✓ 14 correctness properties with universal quantification  
✓ 42 properties, 28 examples, 15 integration tests, 8 non-testable criteria  
✓ RBAC with three roles and comprehensive permission matrix  
✓ Cryptographic security (token hashing, audit hash chains, SEP-10)  
✓ Immutable audit logging with hash chain verification  
✓ Free tier quota enforcement (10 streams, 100 disbursements/month)  
✓ Multi-signature transaction support for high-security operations  
✓ 404 responses for both not-found and cross-org access (security by design)  

All 14 requirements are addressed comprehensively across the service layer, database schema, API design, and security controls. The design integrates seamlessly with the existing StellarStream infrastructure.

