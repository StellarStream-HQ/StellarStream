# Organization Management Feature - Implementation Plan

## Overview

This implementation plan breaks down the organization management feature into discrete, sequentially-buildable tasks. The tasks are organized in logical waves that allow parallel work where possible, with each task building incrementally on previous work.

**Status**: Database schema ✅ COMPLETE | Services ~40% | API Endpoints 20% | Integration 0%

---

## Phase 2: Service Layer Implementation

### Wave 0: Foundation & Core Services Setup

- [ ] 1. Implement Organization Service - Create operations
  - Implement `create()` method with G-address validation
  - Validate G-address format (56 chars, starts with 'G')
  - Create organization record with unique gAddress
  - Set creator as initial EXECUTOR member
  - Initialize empty OrganizationPolicy record
  - Initialize OrganizationPolicy with unlimited spending/all assets
  - Return OrganizationDTO with member details
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [ ] 2. Implement Organization Service - Read operations
  - Implement `getById()` to retrieve org by ID
  - Implement `getByAddress()` to retrieve org by G-address
  - Implement `isActive()` status check
  - Add organization DTO mapping with member count
  - Return null for non-existent organizations
  - _Requirements: 1.1, 1.4_

- [ ] 3. Implement Organization Member Service - Membership queries
  - Implement `listMembers()` for organization
  - Implement `getMember()` for specific member lookup
  - Implement `isMember()` boolean check
  - Implement `getRole()` to retrieve member role
  - Filter inactive members from list results
  - Return null for non-existent members
  - _Requirements: 3.1, 3.2, 12.1_

- [ ] 4. Implement Organization Member Service - Permission matrix
  - Build permission lookup table (DRAFTER/APPROVER/EXECUTOR → actions)
  - Implement `hasPermission()` method for action validation
  - Implement `getPermissions()` to list all member permissions
  - Create permission constants (create_stream, approve_disbursement, etc.)
  - _Requirements: 3.1, 3.2, 3.3_

### Wave 1: Core Service Methods

- [ ] 5. Implement Authorization Service - Core authorization checks
  - Implement `authorize()` method with org context
  - Implement `requirePermission()` for action enforcement
  - Implement `verifySameOrganization()` for cross-org prevention
  - Implement `requireAdmin()` for EXECUTOR-only actions
  - Throw AuthorizationError with appropriate HTTP status codes
  - Return 404 on cross-org access (not 403)
  - _Requirements: 3.1, 3.2, 3.3, 5.6_

- [ ] 6. Implement Organization Member Service - Member management
  - Implement `addMember()` to create new member records
  - Implement `updateRole()` to change member roles
  - Implement `removeMember()` to soft-delete members (set isActive=false)
  - Implement member deactivation and access revocation
  - Update lastActivityAt on member queries
  - _Requirements: 3.1, 3.4, 3.5, 4.5_

- [ ] 7. Implement Audit Log Service - Basic logging
  - Implement `logAction()` to record organization events
  - Create audit log entries with actor, actionType, resourceId, resourceType
  - Include changes JSON for update operations
  - Include ipAddress and userAgent from request context
  - Create new entry with parentHash reference
  - _Requirements: 10.1, 10.2_

- [ ] 8. Implement Audit Log Service - Hash chain
  - Implement hash chain algorithm (SHA-256 of entry + parentHash)
  - Implement `computeEntryHash()` method
  - Store entryHash and parentHash in audit records
  - Implement `verifyChain()` for hash integrity verification
  - Test chain verification with multiple entries
  - _Requirements: 10.3, 10.4, 10.5_

### Wave 2: Policy & Billing Services

- [ ] 9. Implement Policy Engine Service - Spending limits
  - Implement `checkDisbursementPolicy()` method
  - Calculate daily USD spending by organization
  - Query disbursements created on current calendar day (UTC)
  - Check amount against daily spend limit
  - Throw error if amount + existing spend > limit
  - Allow transaction if amount == limit exactly
  - _Requirements: 6.1, 6.3, 6.4, 6.5_

- [ ] 10. Implement Policy Engine Service - Asset whitelist
  - Validate asset against organization's allowed assets list
  - Parse JSON array of allowed asset addresses
  - Allow all assets if whitelist is null
  - Reject if asset not in whitelist and list is defined
  - Throw error immediately for non-whitelisted assets
  - _Requirements: 6.2, 6.5_

- [ ] 11. Implement Organization Policy Service - CRUD operations
  - Implement `getPolicy()` for organization
  - Implement `updatePolicy()` with validation
  - Update dailySpendLimitUsd (can be null for unlimited)
  - Update allowedAssets as JSON array (can be null for all)
  - Support multisig configuration (requiresMultisig, multisigThreshold)
  - Record updatedBy and update timestamps
  - _Requirements: 6.1, 6.2, 6.6_

- [ ] 12. Implement Billing Service - Usage tracking
  - Implement `incrementUsageMetric()` for streams/disbursements/API
  - Create or update BillingRecord for current period (YYYY-MM)
  - Track: streamsCreated, disbursementsProcessed, apiRequests, volumeUsd
  - Initialize new billing periods on first usage
  - Associate with free/pro/enterprise plans
  - _Requirements: 7.1, 7.3_

- [ ] 13. Implement Billing Service - Quota enforcement
  - Implement `checkQuota()` to verify usage limits
  - Get organization's current plan from BillingRecord
  - For FREE tier: enforce limits (10 streams, 100 disbursements/month)
  - For PRO/ENTERPRISE: NO conservative limits regardless of payment status
  - Return remaining quota
  - _Requirements: 7.5, 7.7_

### Wave 3: Invitation Service

- [ ] 14. Implement Invitation Service - Token generation
  - Implement `generateToken()` for cryptographically secure tokens
  - Generate 32+ bytes of entropy (minimum)
  - Return plaintext token (one-time only to caller)
  - Implement `hashToken()` using SHA-256
  - Never store plaintext tokens in database
  - _Requirements: 9.1, 9.2_

- [ ] 15. Implement Invitation Service - Create invitation
  - Implement `createInvitation()` method
  - Generate and hash token
  - Create Invitation record with status=PENDING
  - Set expiresAt to 7 days in future
  - Store invitedBy and organizationId
  - Return InvitationWithToken (includes plaintext token)
  - _Requirements: 2.1, 9.3_

- [ ] 16. Implement Invitation Service - Validation checks
  - Implement `validateToken()` for token hash matching
  - Implement `isExpired()` check against current time
  - Implement `isRevoked()` status check
  - Implement `getInvitationByTokenHash()` for lookup
  - Return null for non-existent or expired tokens
  - _Requirements: 2.5_

- [ ] 17. Implement Invitation Service - Acceptance workflow
  - Implement `acceptInvitation()` method
  - Validate token hash exists and is PENDING
  - Check expiration date
  - Create OrganizationMember with pre-assigned role
  - Update Invitation status to ACCEPTED
  - Set acceptedBy and acceptedAt
  - Return InvitationDTO with success
  - _Requirements: 2.3, 2.4, 2.7_

- [ ] 18. Implement Invitation Service - Revocation
  - Implement `revokeInvitation()` method
  - Update Invitation status to REVOKED
  - Set revokedBy and revokedAt
  - Prevent future acceptance of revoked invitations
  - _Requirements: 2.8_

### Wave 4: Email & Notification Integration

- [ ] 19. Implement Email Service - Invitation emails
  - Implement `sendInvitation()` method
  - Build invitation email template with acceptance link
  - Include token in URL: `https://stellarstream.com/accept-invite?token={token}`
  - Include 7-day expiry in email body
  - Include organization name and role in email
  - Send even if other errors occur in same transaction (ALWAYS send)
  - Handle email failures gracefully (log but don't block)
  - _Requirements: 2.1, 2.2_

- [ ] 20. Implement Email Service - Member notification emails
  - Implement `sendMemberRemoved()` notification
  - Implement `sendRoleChanged()` notification
  - Implement `sendPolicyUpdated()` notification
  - Build notification templates for each event
  - Send to affected members' email addresses
  - Handle email failures gracefully (best-effort)
  - _Requirements: 3.5, 6.6_

- [ ] 21. Implement Notification Service - Rate limit warnings
  - Implement `sendQuotaWarning()` when approaching limits
  - Send when usage > 75% of quota
  - Include current usage and remaining quota
  - Send to organization admins (EXECUTOR members)
  - Allow optional email disable for notification type
  - _Requirements: 7.4_

---

## Phase 3: API Endpoint Implementation

### Wave 5: Organization Endpoints

- [ ] 22. Create POST /api/organizations endpoint
  - Validate request body: name (required), description, gAddress (optional), logoUrl, contactEmail
  - Call OrganizationService.create() with SEP-10 verified caller
  - Return 201 Created with OrganizationDTO
  - Handle 409 Conflict for duplicate gAddress
  - Log creation to audit trail
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 23. Create GET /api/organizations/:organizationId endpoint
  - Verify caller is member of organization (or 404)
  - Return organization details with member count
  - Include isActive status and policy summary
  - _Requirements: 1.1_

- [ ] 24. Create PUT /api/organizations/:organizationId/metadata endpoint
  - Verify caller is EXECUTOR in organization
  - Update name, description, logoUrl, customDomain, contactEmail
  - Return updated OrganizationDTO
  - Log update to audit trail
  - _Requirements: 1.3_

- [ ] 25. Create GET /api/organizations/:organizationId/members endpoint
  - Verify caller is member (any role)
  - Return list of active members with roles
  - Include joinDate, lastActivityAt, isActive
  - Return 404 for non-existent or cross-org access
  - _Requirements: 4.2, 5.3_

### Wave 6: Member Management Endpoints

- [ ] 26. Create POST /api/organizations/:organizationId/members endpoint
  - Verify caller is EXECUTOR
  - Accept memberAddress and role in request body
  - Call OrganizationMemberService.addMember()
  - Return 201 Created with member details
  - Log member addition to audit trail
  - _Requirements: 3.4, 3.5_

- [ ] 27. Create PUT /api/organizations/:organizationId/members/:memberAddress/role endpoint
  - Verify caller is EXECUTOR
  - Update member role (DRAFTER, APPROVER, or EXECUTOR)
  - Prevent removing last EXECUTOR (return 400)
  - Log role change to audit trail
  - Send notification email to member
  - _Requirements: 3.4_

- [ ] 28. Create DELETE /api/organizations/:organizationId/members/:memberAddress endpoint
  - Verify caller is EXECUTOR
  - Silently ignore if not EXECUTOR (no error to requester)
  - Deactivate member (set isActive=false)
  - Revoke all resource access immediately
  - Log removal to audit trail
  - Send removal notification email
  - _Requirements: 3.5, 4.5_

### Wave 7: Invitation Endpoints

- [ ] 29. Create POST /api/organizations/:organizationId/invitations endpoint
  - Verify caller is EXECUTOR
  - Accept inviteeEmail and role in request body
  - Call InvitationService.createInvitation()
  - Send invitation email (ALWAYS send)
  - Return 201 Created with invitation details and token
  - Log invitation to audit trail
  - _Requirements: 2.1, 2.2_

- [ ] 30. Create GET /api/organizations/:organizationId/invitations endpoint
  - Verify caller is EXECUTOR
  - Return list of pending invitations for organization
  - Include inviteeEmail, role, expiresAt, acceptUrl
  - Filter by status (PENDING, ACCEPTED, EXPIRED, REVOKED)
  - _Requirements: 2.1_

- [ ] 31. Create DELETE /api/organizations/:organizationId/invitations/:invitationId endpoint
  - Verify caller is EXECUTOR
  - Call InvitationService.revokeInvitation()
  - Update status to REVOKED
  - Return 204 No Content
  - Log revocation to audit trail
  - _Requirements: 2.8_

- [ ] 32. Create POST /api/invitations/accept endpoint
  - No SEP-10 requirement (different from POST accept endpoint pattern)
  - Accept tokenHash and memberAddress in request body
  - ALWAYS require SEP-10 verification (ignore existing auth state)
  - Call InvitationService.acceptInvitation()
  - Create OrganizationMember with pre-assigned role
  - Return 200 OK with organization details
  - Send acceptance notification to admins
  - _Requirements: 2.3, 2.4, 2.7_

### Wave 8: Policy & Billing Endpoints

- [ ] 33. Create GET /api/organizations/:organizationId/policy endpoint
  - Verify caller is member (any role)
  - Return current organization policy
  - Include dailySpendLimitUsd, allowedAssets, multisigConfig
  - Return empty/default policy if not set
  - _Requirements: 6.1, 6.2_

- [ ] 34. Create PUT /api/organizations/:organizationId/policy endpoint
  - Verify caller is EXECUTOR
  - Accept dailySpendLimitUsd, allowedAssets, requiresMultisig, multisigThreshold
  - Call OrganizationPolicyService.updatePolicy()
  - Validate spending limit is positive (or null for unlimited)
  - Validate allowed assets are valid addresses (or null for all)
  - Return 200 OK with updated policy
  - Log update to audit trail and send notifications
  - _Requirements: 6.1, 6.2, 6.6_

- [ ] 35. Create GET /api/organizations/:organizationId/billing endpoint
  - Verify caller is member (any role)
  - Return current billing period (YYYY-MM)
  - Include usage metrics: streamsCreated, disbursementsProcessed, apiRequests, volumeUsd
  - Include plan (FREE, PRO, ENTERPRISE) and status
  - Include usage limits and remaining quota
  - _Requirements: 7.1, 7.7_

### Wave 9: Audit Endpoints

- [ ] 36. Create GET /api/organizations/:organizationId/audit-logs endpoint
  - Verify caller is member (any role)
  - Accept query params: actionType, dateFrom, dateTo, limit (max 100)
  - Return paginated audit logs for organization only
  - Include actionType, actor, resourceId, resourceType, changes, timestamp
  - Verify hash chain integrity on return
  - Return 404 for cross-org access attempts
  - _Requirements: 10.1, 10.6_

- [ ] 37. Create GET /api/organizations/:organizationId/audit-logs/export endpoint
  - Verify caller is EXECUTOR
  - Accept query params: format (csv|json), dateFrom, dateTo
  - Export audit logs filtered by date range
  - Include all fields plus entryHash and parentHash
  - Add cryptographic signature to export
  - Return file download with appropriate content-type
  - _Requirements: 10.6, 10.7_

### Wave 10: Multi-Signature Endpoints

- [ ] 38. Create POST /api/organizations/:organizationId/multisig-proposals endpoint
  - Verify caller is EXECUTOR
  - Accept description, transactionXdr, requiredSigners in request body
  - Generate unique proposalId
  - Create MultisigProposal record with status=PENDING
  - Set expiresAt to 7 days in future
  - Notify EXECUTOR and APPROVER members
  - Return 201 Created with proposal details
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 39. Create POST /api/multisig-proposals/:proposalId/sign endpoint
  - Accept signerAddress and signature in request body
  - ALWAYS require SEP-10 verification
  - Validate signature using Stellar's verification
  - Store signature in proposals' signatures JSON array
  - Check if required signatures count reached
  - If reached, submit transaction to Stellar network
  - Return 200 OK with proposal status
  - Log all signers in audit trail
  - _Requirements: 8.4, 8.5, 8.7_

- [ ] 40. Create GET /api/organizations/:organizationId/multisig-proposals endpoint
  - Verify caller is member (any role)
  - Return list of proposals for organization
  - Include status, description, currentSignatures, requiredSigners, expiresAt
  - Allow filtering by status (PENDING, SIGNED, SUBMITTED, FAILED, EXPIRED)
  - _Requirements: 8.1_

### Wave 11: Resource Integration Endpoints

- [ ] 41. Update POST /api/streams endpoint for org ownership
  - Accept organizationId in request body (optional)
  - If organizationId provided, verify caller is member with appropriate role
  - Create stream with organization's G-address as sender (not individual)
  - All org members get access based on their roles
  - Log stream creation to audit trail
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 42. Update GET /api/streams endpoint for org filtering
  - Auto-filter by organization membership
  - Return only streams where org is sender/receiver
  - Apply org-level access control
  - Return 404 for cross-org resource access
  - _Requirements: 4.2, 5.1, 5.2, 5.3_

- [ ] 43. Update POST /api/disbursements endpoint for org ownership
  - Accept organizationId in request body (optional)
  - If organizationId provided, verify caller is member with appropriate role
  - Call PolicyEngineService to check spending limits and assets
  - Create disbursement with organization's G-address as sender
  - All org members get access based on their roles
  - Log disbursement creation and policy checks to audit trail
  - _Requirements: 4.1, 4.2, 4.3, 6.3, 6.4, 6.5_

- [ ] 44. Update GET /api/disbursements endpoint for org filtering
  - Auto-filter by organization membership
  - Return only disbursements where org is sender/receiver
  - Apply org-level access control
  - Return 404 for cross-org resource access
  - _Requirements: 4.2, 5.1, 5.2, 5.3_

---

## Phase 4: Security & Integration

### Wave 12: Authorization Middleware

- [ ] 45. Create requireOrgMembership middleware
  - Extract organizationId from request params/body
  - Verify SEP-10 verified caller is member of organization
  - Attach member details to request context
  - Return 404 if not member (no 403 to avoid leaking org existence)
  - _Requirements: 5.1, 5.3_

- [ ] 46. Create requireOrgRole middleware
  - Verify caller's role satisfies minimum requirement
  - Accept role parameter: DRAFTER, APPROVER, EXECUTOR
  - Return 403 Forbidden if role insufficient
  - _Requirements: 3.2, 3.3_

- [ ] 47. Create orgResourceFilter middleware
  - Automatically filter database queries by organization
  - Apply to Stream, Disbursement, and related models
  - Enforce multi-tenant isolation at query layer
  - Prevent cross-org data leakage
  - _Requirements: 5.1, 5.2_

### Wave 13: SEP-10 Integration

- [ ] 48. Implement SEP-10 verification for invitations
  - Create sep10InvitationVerifier middleware
  - ALWAYS require SEP-10 verification on invitation acceptance
  - Ignore existing authentication state for invitations
  - Accept signed challenge from client
  - Verify signature using Stellar SDK
  - Verify wallet address matches acceptor
  - _Requirements: 2.3, 9.3_

- [ ] 49. Implement SEP-10 verification for multi-sig
  - Create sep10MultisigVerifier middleware
  - ALWAYS require SEP-10 verification on signature submission
  - Verify each signer's wallet ownership
  - Validate signature using Stellar's tools
  - _Requirements: 8.4_

### Wave 14: Stream/Disbursement Service Integration

- [ ] 50. Integrate ResourceService with existing Stream service
  - Add organizationId support to Stream model (through ownership)
  - Update Stream creation to support org ownership
  - Update Stream queries to filter by org membership
  - Migrate existing individual streams (no change needed if no org specified)
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 51. Integrate ResourceService with Disbursement service
  - Add organizationId support to Disbursement model (through ownership)
  - Update Disbursement creation to support org ownership
  - Update Disbursement queries to filter by org membership
  - Apply PolicyEngine checks during creation
  - Migrate existing individual disbursements
  - _Requirements: 4.1, 4.2, 4.3, 6.3_

### Wave 15: Billing Integration

- [ ] 52. Hook billing tracking to stream creation
  - On POST /api/streams, increment streamsCreated in BillingRecord
  - Create BillingRecord if not exists for current month
  - Track volume from stream amount
  - _Requirements: 7.1, 7.3_

- [ ] 53. Hook billing tracking to disbursement execution
  - On disbursement completion, increment disbursementsProcessed
  - Accumulate volumeUsd from disbursement amounts
  - Check quotas before completion (if applicable)
  - _Requirements: 7.1, 7.3_

- [ ] 54. Implement quota enforcement hooks
  - On stream creation, check quota and reject if exceeded
  - On disbursement creation, check quota and reject if exceeded
  - Return 400 Bad Request with quota limit message
  - Allow up to limit, reject after exceeding
  - _Requirements: 7.5, 7.7_

### Wave 16: Comprehensive Testing

- [ ] 55. Write integration tests for organization creation flow
  - Test org creation with valid inputs
  - Test duplicate G-address prevention (409)
  - Test creator becomes EXECUTOR
  - Test policy initialization
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [ ] 56. Write integration tests for invitation workflow
  - Test invitation creation and email sending
  - Test token generation and hashing
  - Test 7-day expiry validation
  - Test acceptance with SEP-10 verification
  - Test revocation prevents acceptance
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 9.1, 9.2, 9.3_

- [ ] 57. Write integration tests for RBAC enforcement
  - Test DRAFTER permissions (create drafts)
  - Test APPROVER permissions (approve)
  - Test EXECUTOR permissions (execute + manage)
  - Test unauthorized access returns 403
  - Test non-members return 404
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 58. Write integration tests for resource isolation
  - Test member cannot access other org's streams
  - Test cross-org queries return 404
  - Test org members can access shared resources
  - Test removed members lose access immediately
  - _Requirements: 4.5, 5.1, 5.2, 5.3_

- [ ] 59. Write integration tests for policy enforcement
  - Test daily spending limit rejection
  - Test asset whitelist rejection
  - Test NULL spending limit (unlimited)
  - Test NULL asset list (all assets allowed)
  - Test amount == limit allows transaction
  - _Requirements: 6.3, 6.4, 6.5_

- [ ] 60. Write integration tests for billing & quotas
  - Test FREE tier limit enforcement (10 streams, 100 disbursements)
  - Test PRO tier (no conservative limits)
  - Test ENTERPRISE tier (no conservative limits)
  - Test quota warnings sent
  - _Requirements: 7.1, 7.3, 7.5, 7.7_

- [ ] 61. Write integration tests for multi-signature
  - Test proposal creation and expiry
  - Test signature collection
  - Test transaction submission on threshold
  - Test audit logging of signers
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_

- [ ] 62. Write integration tests for audit logging
  - Test all actions logged with actor
  - Test hash chain integrity
  - Test export functionality
  - Test cross-org log prevention
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

### Wave 17: Documentation & Deployment

- [ ] 63. Create API documentation for organization endpoints
  - Document all endpoints in Swagger/OpenAPI
  - Include request/response examples
  - Include error codes and messages
  - Include authorization requirements
  - _Requirements: All_

- [ ] 64. Create user guide for organization management
  - Step-by-step: create organization
  - Step-by-step: invite team members
  - Step-by-step: manage member roles
  - Step-by-step: set policies and quotas
  - _Requirements: 1.0, 2.0, 3.0, 6.0, 7.0_

- [ ] 65. Create deployment guide
  - Database migration procedures
  - Schema verification steps
  - Feature flag configuration (if needed)
  - Rollback procedures
  - _Requirements: 1.7, 5.4_

- [ ] 66. Create security and compliance documentation
  - SEP-10 verification flow
  - Multi-tenant isolation guarantees
  - Audit logging and export procedures
  - Data retention and privacy policies
  - _Requirements: 5.0, 9.0, 10.0_

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3", "4"] },
    { "id": 1, "tasks": ["5", "6", "7", "8"] },
    { "id": 2, "tasks": ["9", "10", "11", "12", "13"] },
    { "id": 3, "tasks": ["14", "15", "16", "17", "18"] },
    { "id": 4, "tasks": ["19", "20", "21"] },
    { "id": 5, "tasks": ["22", "23", "24", "25"] },
    { "id": 6, "tasks": ["26", "27", "28"] },
    { "id": 7, "tasks": ["29", "30", "31", "32"] },
    { "id": 8, "tasks": ["33", "34", "35"] },
    { "id": 9, "tasks": ["36", "37"] },
    { "id": 10, "tasks": ["38", "39", "40"] },
    { "id": 11, "tasks": ["41", "42", "43", "44"] },
    { "id": 12, "tasks": ["45", "46", "47"] },
    { "id": 13, "tasks": ["48", "49"] },
    { "id": 14, "tasks": ["50", "51"] },
    { "id": 15, "tasks": ["52", "53", "54"] },
    { "id": 16, "tasks": ["55", "56", "57", "58", "59", "60", "61", "62"] },
    { "id": 17, "tasks": ["63", "64", "65", "66"] }
  ]
}
```

---

## Notes

### Task Prioritization

**Critical Path (MVP):**
- Waves 0-1: Core services foundation
- Wave 3: Invitation workflow (enable member joining)
- Wave 5-6: Organization and member management
- Wave 7: Invitation acceptance
- Partial Wave 8: Basic policy support
- Wave 12-13: Authorization and security

**Enhanced Features:**
- Wave 2: Policy and billing
- Wave 8-10: Advanced features (audit, multisig)
- Wave 11: Resource integration
- Wave 15-17: Comprehensive testing and documentation

### Implementation Guidelines

1. **Database First**: All queries must be reviewed for multi-tenant safety
2. **SEP-10 Always**: Every sensitive operation requires explicit verification
3. **Audit Trail**: Log everything with actionType, actor, resourceId, resourceType
4. **Email Sending**: Always use try-catch, never block on email failures
5. **Cross-Org Prevention**: Use 404, not 403, to avoid leaking org existence
6. **Error Handling**: Specific error messages in logs, generic in responses

### Testing Strategy

- **Unit tests** (individual methods, mocked dependencies)
- **Integration tests** (service interactions, real database)
- **End-to-end tests** (full API workflows, simulated client)
- **Security tests** (authorization bypass attempts, cross-org access)
- **Audit tests** (hash chain integrity, log completeness)

---

**Status**: Ready for Phase 2 implementation
**Estimated Duration**: 8-12 weeks for MVP (Waves 0-7 + core testing)
**Dependencies**: Existing StellarStream backend, Stellar SDK, PostgreSQL

