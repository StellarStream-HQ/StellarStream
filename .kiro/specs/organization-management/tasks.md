# Implementation Plan: Organization Management Feature

## Overview

This implementation plan provides a comprehensive guide for building the multi-tenant Organization Management feature for StellarStream. The feature enables team collaboration through organizations, role-based access control, and shared resource management using Stellar G-addresses as organizational identities.

The implementation follows a phased approach: infrastructure setup → core services → API endpoints → advanced features → testing → production rollout. Each task includes property-based tests aligned with the correctness properties defined in the design document.

## Phase 1: Database Schema and Migrations

- [ ] 1. Create database schema for organization tables
  - [x] 1.1 Create Organization table migration (gAddress, name, description, logo, metadata)
    - Write Prisma schema for Organization model with unique G-address constraint
    - Add indexes for gAddress, createdBy, isActive
    - _Requirements: 1.1, 1.2, 14.1_
  
  - [x] 1.2 Create OrganizationMember table migration (role-based membership)
    - Write Prisma schema with foreign key to Organization
    - Add unique constraint on (organizationId, memberAddress)
    - Add indexes for organization lookup and role-based queries
    - _Requirements: 2.1, 3.1, 12.1_
  
  - [x] 1.3 Create Invitation table migration (token-based invitations)
    - Write Prisma schema with tokenHash (never store plaintext), expiration, status tracking
    - Add unique index on tokenHash for lookups
    - Add indexes for status and expiresAt for cleanup queries
    - _Requirements: 2.1, 2.2, 9.1_
  
  - [x] 1.4 Create OrganizationPolicy table migration (spending limits and asset controls)
    - Write Prisma schema for policies with dailySpendLimitUsd and allowedAssets (JSON array)
    - Add unique constraint on organizationId (one policy per org)
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 1.5 Create BillingRecord table migration (usage tracking and quotas)
    - Write Prisma schema with billing period (YYYY-MM), usage metrics, and plan info
    - Add unique constraint on (organizationId, billingPeriod)
    - Add indexes for period and org lookups
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 1.6 Create AuditLog table enhancement (immutable audit trail)
    - Extend existing AuditLog table with organizationId, actionType, actor, entryHash, parentHash
    - Add indexes for org-scoped queries and timestamp-based lookups
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [x] 1.7 Create MultisigProposal table (multi-signature support)
    - Write Prisma schema with transactionXdr, signatures (JSON), requiredSigners, status
    - Add indexes for organization and status
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 2. Execute database migrations and seed data
  - [x] 2.1 Run migrations in development environment
    - Execute `prisma migrate dev` to create all new tables
    - Verify schema reflects all requirements
    - _Requirements: 1.1, 2.1, 5.1_
  
  - [x] 2.2 Create migration rollback testing
    - Verify all migrations have proper rollback capability
    - Test reversibility for all schema changes
    - _Requirements: 1.1_
  
  - [ ]* 2.3 Write property tests for schema consistency
    - **Property 1: Organization Creation Uniqueness**
    - **Validates: Requirements 1.1, 1.5**
    - Test that duplicate G-addresses cannot be created in the database schema
  
  - [ ]* 2.4 Write property tests for table relationships
    - **Property 23: Usage Metric Accumulation**
    - **Validates: Requirements 7.3_



## Phase 2: Core Service Implementations

- [x] 3. Implement Organization Service
  - [x] 3.1 Create OrganizationService class with creation and retrieval methods
    - Implement `create()` method with G-address validation and uniqueness check
    - Implement `getById()` and `getByAddress()` for retrieval
    - Add creator as initial EXECUTOR member
    - Initialize default OrganizationPolicy with unlimited spending
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 3.2 Implement organization metadata update functionality
    - Implement `updateMetadata()` for name, description, logo, domain configuration
    - Add audit logging for all metadata changes
    - _Requirements: 1.3, 14.1_
  
  - [ ]* 3.3 Write property tests for organization creation
    - **Property 1: Organization Creation Uniqueness**
    - **Validates: Requirements 1.1, 1.5**
    - Test that creating with same G-address returns conflict error
    - **Property 2: Creator Gets EXECUTOR Role**
    - **Validates: Requirements 1.2**
    - Test that creator automatically receives EXECUTOR role
    - **Property 3: Metadata Round-Trip Preservation**
    - **Validates: Requirements 1.3, 14.1**

- [x] 4. Implement Organization Member Service
  - [x] 4.1 Create OrganizationMemberService for membership management
    - Implement `listMembers()` with organization address filter
    - Implement `getMember()` and `getRole()` for role retrieval
    - Implement `isMember()` and `hasPermission()` checks
    - _Requirements: 3.1, 3.2, 12.1_
  
  - [x] 4.2 Implement member role update and removal
    - Implement `upsertMember()` for role changes with audit logging
    - Implement `removeMember()` with deactivation and access revocation
    - Validate that at least one EXECUTOR remains before allowing self-removal
    - _Requirements: 3.4, 3.5, 12.2, 12.3, 12.4_
  
  - [ ]* 4.3 Write property tests for member management
    - **Property 8: Duplicate Member Prevention**
    - **Validates: Requirements 2.6, 3.1**
    - Test that adding same member twice fails on second attempt
    - **Property 12: Role Change Audit Logging**
    - **Validates: Requirements 3.4**
    - Test that role changes are logged with correct details
    - **Property 13: Member Removal Access Revocation**
    - **Validates: Requirements 3.5**

- [x] 5. Implement Invitation Service
  - [x] 5.1 Create InvitationService for token generation and validation
    - Implement cryptographically secure token generation (32+ bytes entropy)
    - Implement SHA-256 token hashing for database storage
    - Implement 7-day expiration logic
    - _Requirements: 2.1, 2.2, 9.1, 9.2_
  
  - [x] 5.2 Implement invitation acceptance with SEP-10 verification
    - Implement `acceptInvitation()` requiring fresh SEP-10 wallet verification
    - Implement token hash verification against stored value
    - Create OrganizationMember record with assigned role on acceptance
    - Prevent acceptance if invitation already used or revoked
    - _Requirements: 2.3, 2.4, 2.6, 2.7_
  
  - [x] 5.3 Implement invitation revocation and cleanup
    - Implement `revokeInvitation()` to mark tokens as revoked
    - Implement scheduled task to expire old invitations
    - _Requirements: 2.8, 9.3, 9.4_
  
  - [ ]* 5.4 Write property tests for invitation security
    - **Property 5: Invitation Token Uniqueness & Determinism**
    - **Validates: Requirements 2.1, 9.1**
    - Test that repeated invitation requests generate different tokens
    - **Property 6: SEP-10 Always Required**
    - **Validates: Requirements 2.3**
    - Test that acceptance always requires fresh SEP-10 verification
    - **Property 7: Accepted Invitation Creates Member Record**
    - **Validates: Requirements 2.4, 2.7**
    - **Property 9: Revoked Invitation Prevents Acceptance**
    - **Validates: Requirements 2.8**

- [x] 6. Implement Authorization Service
  - [x] 6.1 Create AuthorizationService for role-based permission checks
    - Implement role-permission matrix (DRAFTER, APPROVER, EXECUTOR actions)
    - Implement `authorize()` method with action validation per role
    - Implement `getPermissions()` to return member's available actions
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [x] 6.2 Implement cross-organization access prevention
    - Implement `verifySameOrganization()` to prevent cross-org access
    - Return 404 (not 403) for cross-organization attempts to avoid information leakage
    - _Requirements: 5.3, 5.6_
  
  - [ ]* 6.3 Write property tests for authorization
    - **Property 10: Authorization Matrix Consistency**
    - **Validates: Requirements 3.1, 3.2**
    - Test that authorization results are deterministic
    - **Property 11: Unauthorized Action Rejection**
    - **Validates: Requirements 3.3**
    - Test that unauthorized actions always fail
    - **Property 16: Cross-Organization Access Returns 404**
    - **Validates: Requirements 5.3**

- [x] 7. Implement Organization Policy Service
  - [x] 7.1 Create OrganizationPolicyService for spending and asset controls
    - Implement `getPolicy()` to retrieve current organization policy
    - Implement `updatePolicy()` with EXECUTOR-only access and audit logging
    - Initialize default policy with unlimited spending (null) and all assets allowed
    - _Requirements: 6.1, 6.2, 6.6_
  
  - [x] 7.2 Implement policy validation for disbursements
    - Implement `validateDisbursement()` checking daily limit and asset whitelist
    - Implement daily spend total calculation with date-based filtering
    - Return PolicyViolation with specific error type (DAILY_LIMIT_EXCEEDED, ASSET_NOT_WHITELISTED)
    - _Requirements: 6.3, 6.4, 6.5_
  
  - [ ]* 7.3 Write property tests for policy enforcement
    - **Property 4: Default Policy Initialization**
    - **Validates: Requirements 6.2, 6.4_
    - Test that default policy has unlimited spending and all assets allowed
    - **Property 20: Asset Whitelist Enforcement**
    - **Validates: Requirements 6.5**
    - Test that non-whitelisted assets are rejected immediately
    - **Property 21: Daily Spend Limit Enforcement**
    - **Validates: Requirements 6.3**
    - Test that exceeding daily limit prevents disbursement

- [x] 8. Implement Billing and Quota Service
  - [x] 8.1 Create BillingService for usage tracking and quota enforcement
    - Implement `recordUsage()` to log usage events (streams created, disbursements, etc.)
    - Implement `getCurrentUsage()` with billing period aggregation
    - Implement `getPlan()` and `updatePlan()` for subscription management
    - _Requirements: 7.1, 7.3_
  
  - [x] 8.2 Implement quota limit enforcement
    - Implement `isQuotaExceeded()` to check against plan limits
    - Support FREE tier with conservative limits (10 streams, 100 disbursements)
    - Support PRO and ENTERPRISE tiers with higher limits
    - Prevent resource creation when quota exceeded
    - _Requirements: 7.5, 7.7_
  
  - [x] 8.3 Implement usage reporting and analytics
    - Implement `generateUsageReport()` with daily breakdown and top recipients
    - Include asset-level usage and charge details
    - _Requirements: 7.1, 13.1_
  
  - [ ]* 8.4 Write property tests for billing and quotas
    - **Property 23: Usage Metric Accumulation**
    - **Validates: Requirements 7.3**
    - Test that metrics increment by exactly 1 per resource created
    - **Property 24: Quota Blocking Enforcement**
    - **Validates: Requirements 7.5**
    - Test that exceeding quota prevents resource creation
    - **Property 25: Free Tier Quota Stricter Than Paid**
    - **Validates: Requirements 7.7**

- [x] 9. Implement Multi-Signature Service
  - [x] 9.1 Create MultisigService for multi-signature transaction handling
    - Implement `createProposal()` storing transaction XDR and required signature count
    - Implement `addSignature()` with Stellar signature validation
    - Implement `isReady()` to check if threshold reached
    - _Requirements: 8.1, 8.2, 8.4_
  
  - [x] 9.2 Implement multi-signature transaction submission
    - Implement `submitTransaction()` only when threshold reached
    - Implement Stellar transaction submission to blockchain
    - Return transaction hash and error handling
    - _Requirements: 8.2, 8.3, 8.5_
  
  - [x] 9.3 Implement proposal expiration and cleanup
    - Implement `expireProposal()` for time-based expiration
    - Implement scheduled tasks to mark expired proposals
    - _Requirements: 8.6_
  
  - [ ]* 9.4 Write property tests for multi-signature
    - **Property 26: Multisig Threshold Enforcement**
    - **Validates: Requirements 8.1**
    - Test that proposal is not submittable until threshold reached
    - **Property 27: Signature Validation**
    - **Validates: Requirements 8.4**
    - Test that invalid signatures are rejected
    - **Property 28: Expired Proposal Prevention**
    - **Validates: Requirements 8.6**

- [x] 10. Implement Audit Log Service
  - [x] 10.1 Create AuditLogService with immutable logging
    - Implement `logEvent()` with SHA-256 hash chain creation
    - Store each entry's hash and previous entry's hash for chain integrity
    - Include organization ID, actor, action type, resource, timestamp in all entries
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [x] 10.2 Implement audit log querying and filtering
    - Implement `queryLogs()` with filters (org, action, actor, date range, resource)
    - Enforce org-scoped queries to prevent cross-org log access
    - _Requirements: 10.4, 10.5_
  
  - [x] 10.3 Implement audit log integrity verification
    - Implement `verifyIntegrity()` to validate hash chain
    - Detect tampering by checking hash chain continuity
    - _Requirements: 10.3_
  
  - [x] 10.4 Implement audit log export functionality
    - Implement `exportLogs()` with CSV and JSON formats
    - Include all available fields and digital signature for verification
    - _Requirements: 10.7_
  
  - [ ]* 10.5 Write property tests for audit logging
    - **Property 18: Audit Logs Org-Scoped**
    - **Validates: Requirements 10.4, 10.5**
    - Test that queries return only logs from member's organization
    - **Property 19: Cross-Organization Attempts Logged**
    - **Validates: Requirements 5.6, 10.6**
    - Test that unauthorized access attempts are logged
    - **Property 29: Multisig Audit Logging**
    - **Validates: Requirements 8.7**

- [x] 11. Implement Email Service
  - [x] 11.1 Create EmailService for invitations and notifications
    - Implement `sendInvitation()` with template rendering
    - Include organization name, role permissions, expiration, and invitation link
    - _Requirements: 2.2, 11.1_
  
  - [x] 11.2 Implement member notification emails
    - Implement `sendMemberRemoved()` for removal notifications
    - Implement `sendPolicyUpdate()` for optional policy change notifications
    - Implement `sendQuotaWarning()` when approaching limits
    - _Requirements: 11.3, 11.4_
  
  - [ ]* 11.3 Write integration tests for email delivery
    - Test that invitations are sent with correct content
    - Mock email service for test reliability
    - _Requirements: 11.1, 11.2



## Phase 3: API Endpoints Implementation

- [x] 12. Implement Organization Management Endpoints
  - [x] 12.1 Implement POST /api/v1/organizations (create organization)
    - Validate request with required name, optional description, logo, G-address
    - Call OrganizationService.create() with creator address from auth context
    - Return 201 with created organization and initial member
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 12.2 Implement GET /api/v1/organizations/:orgId (retrieve organization)
    - Verify member belongs to organization
    - Return organization details with current membership
    - _Requirements: 1.1_
  
  - [x] 12.3 Implement GET /api/v1/organizations (list user's organizations)
    - Return all organizations where authenticated member is active
    - Include member count and current role
    - _Requirements: 1.1_
  
  - [x] 12.4 Implement PUT /api/v1/organizations/:orgId (update organization)
    - Require EXECUTOR role
    - Allow name, description, logo, custom domain updates
    - Log changes to audit trail
    - _Requirements: 1.3, 14.1_
  
  - [x] 12.5 Implement DELETE /api/v1/organizations/:orgId (soft delete)
    - Require EXECUTOR role
    - Mark organization as inactive (soft delete)
    - _Requirements: 1.1_

- [x] 13. Implement Member Management Endpoints
  - [x] 13.1 Implement GET /api/v1/orgs/:gAddress/members (list members)
    - Require DRAFTER or higher role
    - Return member list with roles and join dates
    - _Requirements: 12.1, 3.1_
  
  - [x] 13.2 Implement POST /api/v1/orgs/:gAddress/members (add/update member)
    - Require EXECUTOR role
    - Validate role is valid (DRAFTER, APPROVER, EXECUTOR)
    - Create or update member role
    - Audit log the change
    - _Requirements: 3.4, 12.2_
  
  - [x] 13.3 Implement DELETE /api/v1/orgs/:gAddress/members (remove member)
    - Require EXECUTOR role
    - Prevent removing only EXECUTOR
    - Mark member as inactive and revoke access
    - Audit log the removal
    - _Requirements: 3.5, 12.3_
  
  - [x] 13.4 Implement GET /api/v1/orgs/:gAddress/role (get caller's role)
    - Return authenticated member's role in organization
    - Return 404 if member not in organization
    - _Requirements: 3.1_

- [x] 14. Implement Invitation Endpoints
  - [~] 14.1 Implement POST /api/v1/orgs/:gAddress/invitations (send invitation)
    - Require EXECUTOR role
    - Validate email and role
    - Generate unique token with 7-day expiration
    - Send email invitation
    - Return invitation details (without token)
    - _Requirements: 2.1, 2.2, 11.1_
  
  - [~] 14.2 Implement GET /api/v1/invitations/:token/details (get invitation preview)
    - No authentication required
    - Return organization details and role permissions
    - Return time remaining until expiration
    - _Requirements: 2.1_
  
  - [~] 14.3 Implement POST /api/v1/invitations/:token/accept (accept invitation)
    - Require SEP-10 signed challenge verification
    - Validate token (not expired, not revoked, not already used)
    - Create OrganizationMember with assigned role
    - Return member details
    - _Requirements: 2.3, 2.4, 2.7_
  
  - [~] 14.4 Implement DELETE /api/v1/orgs/:gAddress/invitations/:invitationId (revoke invitation)
    - Require EXECUTOR role
    - Mark invitation as revoked
    - Prevent future acceptance
    - _Requirements: 2.8, 9.3_

- [x] 15. Implement Policy and Spending Endpoints
  - [~] 15.1 Implement GET /api/v1/orgs/:gAddress/policy (retrieve policy)
    - Require DRAFTER or higher role
    - Return current organization policy
    - _Requirements: 6.1_
  
  - [~] 15.2 Implement PUT /api/v1/orgs/:gAddress/policy (update policy)
    - Require EXECUTOR role
    - Allow updating daily spend limit and allowed assets
    - Allow enabling/configuring multi-signature
    - Log policy changes to audit trail
    - _Requirements: 6.1, 6.2, 6.6_
  
  - [~] 15.3 Implement GET /api/v1/orgs/:gAddress/spending (get daily spending)
    - Require DRAFTER or higher role
    - Return today's cumulative disbursements and remaining budget
    - _Requirements: 6.3_

- [x] 16. Implement Billing and Usage Endpoints
  - [~] 16.1 Implement GET /api/v1/orgs/:gAddress/billing/current (current usage)
    - Require EXECUTOR role
    - Return current billing period metrics
    - _Requirements: 7.1, 7.2_
  
  - [~] 16.2 Implement GET /api/v1/orgs/:gAddress/billing/history (billing history)
    - Require EXECUTOR role
    - Return past billing periods with charges
    - _Requirements: 7.2_
  
  - [~] 16.3 Implement GET /api/v1/orgs/:gAddress/billing/plan (get plan)
    - Require DRAFTER or higher role
    - Return subscription plan with limits
    - _Requirements: 7.4_
  
  - [~] 16.4 Implement POST /api/v1/orgs/:gAddress/billing/plan (update plan)
    - Require EXECUTOR role
    - Support FREE, PRO, ENTERPRISE plan changes
    - Apply changes at next billing period
    - _Requirements: 7.6_
  
  - [~] 16.5 Implement GET /api/v1/orgs/:gAddress/billing/report (export usage report)
    - Require EXECUTOR role
    - Return comprehensive usage report with daily breakdown
    - _Requirements: 13.1_

- [x] 17. Implement Multi-Signature Endpoints
  - [~] 17.1 Implement POST /api/v1/orgs/:gAddress/multisig/proposals (create proposal)
    - Require EXECUTOR role
    - Accept transaction XDR and signature threshold
    - Create proposal and notify eligible signers
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [~] 17.2 Implement GET /api/v1/orgs/:gAddress/multisig/proposals/:proposalId (get proposal)
    - Require DRAFTER or higher role
    - Return proposal details with current signature count
    - _Requirements: 8.2_
  
  - [~] 17.3 Implement POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/sign (add signature)
    - Require APPROVER or EXECUTOR role
    - Validate signature against transaction XDR
    - Add signature to proposal
    - _Requirements: 8.4_
  
  - [~] 17.4 Implement POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/submit (submit)
    - Require EXECUTOR role
    - Check if signature threshold reached
    - Submit transaction to Stellar network
    - Return transaction hash
    - _Requirements: 8.2, 8.5_

- [x] 18. Implement Audit Log Endpoints
  - [~] 18.1 Implement GET /api/v1/orgs/:gAddress/audit-logs (query audit logs)
    - Require EXECUTOR role
    - Support filtering by action, actor, date range, resource
    - Return paginated results
    - _Requirements: 10.1, 10.4_
  
  - [~] 18.2 Implement GET /api/v1/orgs/:gAddress/audit-logs/:entryId (get entry)
    - Require EXECUTOR role
    - Return single audit log entry with hash chain details
    - _Requirements: 10.1_
  
  - [~] 18.3 Implement GET /api/v1/orgs/:gAddress/audit-logs/export (export logs)
    - Require EXECUTOR role
    - Return CSV or JSON with all fields and digital signature
    - _Requirements: 10.7_



## Phase 4: Multi-Tenancy Enforcement and Integration

- [x] 19. Implement Multi-Tenancy Middleware
  - [x] 19.1 Create organization context middleware
    - Extract organization from route parameters or authenticated member context
    - Inject organizationId into request context for downstream access
    - Validate member belongs to organization before proceeding
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [x] 19.2 Implement query filtering middleware
    - Automatically inject organizationId filter into all database queries
    - Wrap Prisma queries with org context verification
    - Return 404 instead of 403 for cross-org attempts
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 20. Integrate Organization Ownership into Stream and Disbursement Creation
  - [x] 20.1 Update Stream creation to support organization ownership
    - When stream created by organization member, set organizationId
    - Associate stream with organization's G-address as sender/receiver
    - Grant all organization members access based on their roles
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [x] 20.2 Update Disbursement creation to support organization ownership
    - When disbursement created by organization member, set organizationId
    - Use organization's G-address as source for transaction execution
    - Enforce organization policies (spending limits, asset whitelist)
    - _Requirements: 4.1, 4.2, 4.3, 6.3_
  
  - [x] 20.3 Implement resource access control
    - Verify member belongs to resource-owning organization
    - Return 404 for cross-organization access attempts
    - _Requirements: 4.4, 4.5, 4.6_

- [x] 21. Implement Policy Enforcement in Disbursement Flow
  - [~] 21.1 Create policy validation middleware for disbursements
    - Before creating or executing disbursement, validate against policy
    - Check daily spend limit and asset whitelist
    - Return specific violation error
    - _Requirements: 6.3, 6.4, 6.5_
  
  - [~] 21.2 Implement spending calculation and enforcement
    - Aggregate disbursements by organization and date
    - Calculate daily total in USD
    - Prevent disbursement if limit exceeded
    - _Requirements: 6.3, 6.4_

- [x] 22. Integrate Organization Context into Existing Features
  - [~] 22.1 Update Stream queries to use organization context
    - Filter streams by member's organization
    - Exclude streams from other organizations
    - _Requirements: 5.1, 5.2_
  
  - [~] 22.2 Update Disbursement queries to use organization context
    - Filter disbursements by member's organization
    - Exclude disbursements from other organizations
    - _Requirements: 5.1, 5.2_
  
  - [~] 22.3 Update API endpoints to support organization context
    - Accept organization ID or G-address in request routing
    - Populate organization context for authorization checks
    - _Requirements: 4.1, 4.2, 5.1_

- [x] 23. Checkpoint - Verify Multi-Tenancy Isolation
  - Ensure multi-tenancy filters are applied to all database queries
  - Verify cross-organization access attempts return 404
  - Ensure organization policies enforce spending and asset controls
  - Ask the user if questions arise about multi-tenancy implementation

- [x] 24. Implement Billing Integration
  - [~] 24.1 Add usage tracking to resource creation
    - Record usage event when stream created
    - Record usage event when disbursement processed
    - Track API request counts per organization
    - _Requirements: 7.3_
  
  - [~] 24.2 Add usage tracking for quotas
    - Track metrics against organization's current plan
    - Check quota before allowing resource creation
    - Return QUOTA_EXCEEDED error when limit reached
    - _Requirements: 7.3, 7.5_
  
  - [~] 24.3 Implement billing period calculations
    - Calculate current billing period (calendar month)
    - Generate monthly usage summaries
    - Calculate charges based on plan and usage
    - _Requirements: 7.2, 7.3_



## Phase 5: Advanced Features and Testing

- [x] 25. Implement Authorization Enforcement Across Endpoints
  - [~] 25.1 Create authorization middleware for role-based access
    - Check member's role before allowing action
    - Enforce DRAFTER, APPROVER, EXECUTOR permission matrix
    - Return 403 Forbidden if unauthorized
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [~] 25.2 Add audit logging for authorization failures
    - Log unauthorized access attempts with actor, action, resource
    - Log any cross-organization access attempts as security events
    - _Requirements: 5.6, 10.1_

- [x] 26. Implement Comprehensive Unit Tests
  - [x] 26.1 Write unit tests for OrganizationService
    - Test organization creation with valid inputs
    - Test duplicate G-address prevention
    - Test creator gets EXECUTOR role
    - Test metadata updates and audit logging
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [~] 26.2 Write unit tests for MemberService
    - Test member list and retrieval
    - Test role updates with audit logging
    - Test member removal and deactivation
    - Test duplicate member prevention
    - _Requirements: 3.1, 3.4, 3.5_
  
  - [~] 26.3 Write unit tests for InvitationService
    - Test token generation and uniqueness
    - Test token hashing and storage
    - Test invitation expiration
    - Test SEP-10 verification requirement
    - Test revocation functionality
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [~] 26.4 Write unit tests for AuthorizationService
    - Test role-permission matrix
    - Test action authorization for each role
    - Test cross-organization access prevention
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [~] 26.5 Write unit tests for PolicyService
    - Test policy creation and updates
    - Test spending limit enforcement
    - Test asset whitelist enforcement
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [~] 26.6 Write unit tests for BillingService
    - Test usage metric recording
    - Test quota limit checks
    - Test billing period calculations
    - Test free tier vs paid tier quotas
    - _Requirements: 7.1, 7.3, 7.5, 7.7_
  
  - [~] 26.7 Write unit tests for MultisigService
    - Test proposal creation and storage
    - Test signature validation and collection
    - Test submission when threshold reached
    - Test expiration logic
    - _Requirements: 8.1, 8.2, 8.4_
  
  - [~] 26.8 Write unit tests for AuditLogService
    - Test event logging with hash chain
    - Test log querying and filtering
    - Test org-scoped access
    - Test integrity verification
    - _Requirements: 10.1, 10.3, 10.4_

- [x] 27. Implement Integration Tests
  - [x] 27.1 Write integration tests for organization creation flow
    - Test full organization creation from API to database
    - Test initial member creation and permissions
    - Verify audit logs created
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [~] 27.2 Write integration tests for member invitation flow
    - Test invitation creation and email sending
    - Test token validation and SEP-10 verification
    - Test member addition on acceptance
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [~] 27.3 Write integration tests for resource creation within org
    - Test stream creation with organization context
    - Test disbursement creation with organization context
    - Verify all members can access org resources
    - _Requirements: 4.1, 4.2, 4.3_
  
  - [~] 27.4 Write integration tests for multi-tenancy isolation
    - Test cross-organization query filtering
    - Test 404 responses for cross-org access
    - Test member removal revokes access
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [~] 27.5 Write integration tests for policy enforcement
    - Test spending limit prevents disbursement
    - Test asset whitelist enforcement
    - Verify policy violations logged
    - _Requirements: 6.3, 6.4, 6.5_
  
  - [~] 27.6 Write integration tests for multi-signature flow
    - Test proposal creation and notification
    - Test signature collection and validation
    - Test transaction submission
    - Test expiration blocking submission
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 28. Implement End-to-End API Tests
  - [x] 28.1 Write e2e tests for organization management endpoints
    - Test complete organization lifecycle (create, update, delete)
    - Test member management (add, update, remove)
    - Verify proper status codes and responses
    - _Requirements: 1.1, 3.1, 3.4, 3.5_
  
  - [~] 28.2 Write e2e tests for invitation endpoints
    - Test invitation creation and sending
    - Test invitation acceptance with SEP-10
    - Test revocation prevention
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [~] 28.3 Write e2e tests for policy endpoints
    - Test policy retrieval and updates
    - Test spending limit query
    - Verify audit logging of policy changes
    - _Requirements: 6.1, 6.2, 6.6_
  
  - [~] 28.4 Write e2e tests for billing endpoints
    - Test current usage retrieval
    - Test billing history query
    - Test plan upgrade/downgrade
    - Test usage report generation
    - _Requirements: 7.1, 7.2, 7.6_
  
  - [~] 28.5 Write e2e tests for audit endpoints
    - Test audit log querying with filters
    - Test export functionality
    - Verify org-scoped access
    - _Requirements: 10.1, 10.4, 10.7_

- [x] 29. Checkpoint - Ensure All Tests Pass
  - Run full test suite including unit, integration, and e2e tests
  - Ensure all property-based tests pass with coverage
  - Verify test coverage above 80% for critical paths
  - Ask the user if questions arise about test results



## Phase 6: Documentation and Production Readiness

- [ ] 30. Create API Documentation
  - [x] 30.1 Document all organization endpoints
    - Add OpenAPI/Swagger documentation for all organization endpoints
    - Include request/response examples and error codes
    - Document authentication requirements per endpoint
    - _Requirements: 1.1, 12.1_
  
  - [~] 30.2 Document member management endpoints
    - Document role-based access requirements
    - Document role permission matrix
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [~] 30.3 Document invitation flow endpoints
    - Document SEP-10 verification requirement
    - Document token expiration and revocation behavior
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [~] 30.4 Document policy and billing endpoints
    - Document spending limit and quota enforcement
    - Document plan types and limits
    - _Requirements: 6.1, 7.1_

- [ ] 31. Create User and Administrator Guides
  - [~] 31.1 Write organization creation guide
    - Step-by-step guide for creating organization
    - Explain G-address requirement
    - Explain creator's initial EXECUTOR role
    - _Requirements: 1.1_
  
  - [~] 31.2 Write member invitation guide
    - Guide for inviting team members
    - Explain role assignments and permissions
    - Explain 7-day invitation expiration
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_
  
  - [~] 31.3 Write policy configuration guide
    - Guide for setting spending limits
    - Guide for configuring asset whitelist
    - Guide for enabling multi-signature
    - _Requirements: 6.1, 6.2, 8.1_
  
  - [~] 31.4 Write audit and compliance guide
    - Guide for querying audit logs
    - Guide for exporting audit trails
    - Guide for compliance reporting
    - _Requirements: 10.1, 10.4, 10.7_

- [ ] 32. Prepare Deployment Configuration
  - [~] 32.1 Create database migration scripts for production
    - Prepare migration scripts for all new tables
    - Document rollback procedures
    - Test migrations on staging environment
    - _Requirements: 1.1_
  
  - [~] 32.2 Create environment configuration
    - Document required environment variables
    - Document email service configuration
    - Document Stellar network configuration
    - _Requirements: 2.2, 11.1_
  
  - [~] 32.3 Create monitoring and alerting configuration
    - Set up audit log monitoring for security events
    - Set up quota warning alerts
    - Set up failed multisig proposal alerts
    - _Requirements: 10.1, 7.4_

- [x] 33. Implement Security Hardening
  - [~] 33.1 Implement rate limiting per organization
    - Rate limit API endpoints per organization
    - Track API request usage for quota enforcement
    - _Requirements: 7.1_
  
  - [~] 33.2 Implement input validation
    - Validate all organization inputs
    - Validate email addresses for invitations
    - Validate amounts for spending limits
    - _Requirements: 1.1, 2.1, 6.1_
  
  - [~] 33.3 Implement security headers and CORS
    - Add security headers to all responses
    - Configure CORS for multi-domain support
    - _Requirements: 5.1_
  
  - [~] 33.4 Implement token and credential protection
    - Ensure invitation tokens never logged in plaintext
    - Ensure all sensitive data encrypted at rest
    - _Requirements: 9.1, 9.2_

- [ ] 34. Perform Security Testing
  - [~] 34.1 Test multi-tenancy boundary enforcement
    - Attempt cross-organization access with various techniques
    - Verify 404 response on all cross-org attempts
    - Verify security events logged
    - _Requirements: 5.1, 5.2, 5.3, 5.6_
  
  - [~] 34.2 Test authorization enforcement
    - Attempt unauthorized actions for each role
    - Verify 403 Forbidden responses
    - Verify failed attempts logged
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [~] 34.3 Test invitation token security
    - Attempt token reuse
    - Attempt expired token acceptance
    - Attempt revoked token acceptance
    - Verify plaintext token never stored or logged
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [~] 34.4 Test policy enforcement
    - Attempt disbursement exceeding daily limit
    - Attempt disbursement with non-whitelisted asset
    - Verify policy violations logged
    - _Requirements: 6.3, 6.4, 6.5_

- [x] 35. Checkpoint - Security and Compliance Review
  - Review all multi-tenancy isolation implementations
  - Review all authorization logic
  - Review audit logging completeness
  - Verify compliance with all requirements
  - Ask the user if questions arise about security posture

- [ ] 36. Performance Optimization
  - [~] 36.1 Optimize organization queries
    - Add indexes on frequently queried fields
    - Optimize member lookup queries
    - Profile query performance
    - _Requirements: 5.1_
  
  - [~] 36.2 Optimize audit log queries
    - Create indexes on organization, timestamp, action type
    - Implement query pagination for large result sets
    - _Requirements: 10.1, 10.4_
  
  - [~] 36.3 Optimize billing calculations
    - Cache billing period totals
    - Implement efficient daily spending calculation
    - _Requirements: 6.3, 7.3_

- [ ] 37. Load and Stress Testing
  - [~] 37.1 Test organization operations under load
    - Test concurrent organization creation
    - Test concurrent member operations
    - Verify database constraints prevent conflicts
    - _Requirements: 1.1, 1.5_
  
  - [~] 37.2 Test API endpoints under load
    - Load test organization endpoints
    - Load test member management endpoints
    - Verify rate limiting works correctly
    - _Requirements: 3.1, 3.4, 3.5_
  
  - [~] 37.3 Test multi-signature under load
    - Test concurrent signature submissions
    - Test proposal expiration under load
    - _Requirements: 8.1, 8.4_



## Phase 7: Production Rollout and Validation

- [ ] 38. Pre-Production Validation
  - [~] 38.1 Validate all database migrations
    - Run migrations on staging database
    - Verify schema matches design specifications
    - Test rollback capability
    - _Requirements: 1.1_
  
  - [~] 38.2 Validate all API endpoints
    - Verify all endpoints documented and tested
    - Verify all error codes documented
    - Verify authentication on all protected endpoints
    - _Requirements: 12.1, 14.1, 15.1, 16.1, 17.1, 18.1_
  
  - [~] 38.3 Validate multi-tenancy in staging
    - Test organization isolation in production-like environment
    - Test cross-organization access prevention
    - Test member removal access revocation
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [~] 38.4 Validate audit trail in staging
    - Test audit logging functionality
    - Test audit log export
    - Verify hash chain integrity
    - _Requirements: 10.1, 10.3, 10.7_

- [x] 39. Staged Production Rollout
  - [x] 39.1 Phase 1: Organization core features
    - Deploy organization creation and retrieval
    - Deploy member management endpoints
    - Monitor for errors and performance issues
    - _Requirements: 1.1, 1.2, 1.3, 3.1_
  
  - [x] 39.2 Phase 2: Invitation system
    - Deploy invitation endpoints
    - Deploy email service integration
    - Monitor invitation acceptance success rates
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 39.3 Phase 3: Policies and billing
    - Deploy policy management endpoints
    - Deploy billing and quota system
    - Monitor policy enforcement and quota accuracy
    - _Requirements: 6.1, 6.2, 7.1, 7.3, 7.5_
  
  - [x] 39.4 Phase 4: Advanced features
    - Deploy multi-signature system
    - Deploy audit log system
    - Monitor multi-sig proposal flow and audit logging
    - _Requirements: 8.1, 8.2, 10.1, 10.3_
  
  - [x] 39.5 Phase 5: Integration with existing resources
    - Deploy organization ownership for streams and disbursements
    - Deploy multi-tenancy filters to all queries
    - Monitor for 404 responses and cross-org attempt detection
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

- [ ] 40. Production Monitoring and Support
  - [~] 40.1 Monitor organization operations
    - Track organization creation success rate
    - Monitor member management operation performance
    - Alert on organization errors
    - _Requirements: 1.1, 3.1_
  
  - [~] 40.2 Monitor invitation system
    - Track invitation email delivery success
    - Track invitation acceptance success rate
    - Alert on invitation failures
    - _Requirements: 2.1, 2.2_
  
  - [~] 40.3 Monitor policy enforcement
    - Track policy violation occurrences
    - Monitor daily spending patterns
    - Alert on unusual spending activity
    - _Requirements: 6.3, 6.4_
  
  - [~] 40.4 Monitor audit logging
    - Track audit log write failures (critical)
    - Monitor audit log access patterns
    - Alert on security events
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [~] 40.5 Monitor multi-signature system
    - Track proposal creation and submission success
    - Monitor signature collection success rates
    - Alert on expired proposals
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

- [ ] 41. Create Incident Response Plans
  - [~] 41.1 Document rollback procedures
    - Document rollback for each phase
    - Test rollback procedures
    - Have rollback plans readily available
    - _Requirements: 1.1_
  
  - [~] 41.2 Create operational runbooks
    - Runbook for investigating organization issues
    - Runbook for investigating invitation failures
    - Runbook for investigating multi-tenancy violations
    - _Requirements: 5.1, 2.1, 3.1_
  
  - [~] 41.3 Create security incident procedures
    - Procedure for unauthorized access attempts
    - Procedure for audit log tampering detection
    - Procedure for data breach response
    - _Requirements: 5.6, 10.3_

- [ ] 42. Final Validation and Sign-Off
  - [~] 42.1 Verify all acceptance criteria met
    - Verify all 14 acceptance criterion groups implemented
    - Verify all requirements covered by implementation
    - Verify all properties tested
    - _Requirements: All_
  
  - [x] 42.2 Verify CI/CD checks pass
    - All linting checks pass
    - All type checks pass
    - All tests pass (unit, integration, e2e, property-based)
    - Security scans complete with no critical findings
    - _Requirements: All_
  
  - [~] 42.3 Final performance validation
    - Verify response times within SLA
    - Verify database queries efficient
    - Verify no memory leaks
    - _Requirements: All_
  
  - [~] 42.4 Obtain stakeholder sign-off
    - Review implementation with stakeholders
    - Verify all requirements met to satisfaction
    - Get final approval for production
    - _Requirements: All_

- [x] 43. Checkpoint - Production Ready
  - Ensure all phases completed and tested
  - Ensure all requirements met and documented
  - Ensure monitoring and alerting configured
  - Ensure incident response plans created
  - Ask the user if questions arise before production launch

## Notes

- All tasks marked with `*` are optional property-based tests that validate correctness properties. While optional, they are strongly recommended for critical business logic validation.
- Tasks are organized in execution waves based on dependencies. Tasks within the same wave can run in parallel.
- Property-based tests use fast-check (JavaScript/TypeScript PBT library) and validate correctness properties from the design document.
- Each major task group includes embedded checkpoints to validate progress and catch issues early.
- Multi-tenancy enforcement is critical throughout all phases—validate org context filters at each step.
- Audit logging must succeed before any action completes (blocking)—this is a hard requirement per Requirement 10.2.
- All cross-organization access attempts must return 404 (not 403) to avoid information leakage—this is security-critical.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "description": "Database schema and foundational setup",
      "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"]
    },
    {
      "id": 1,
      "description": "Execute migrations and core service setup",
      "tasks": ["2.1", "2.2", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1", "11.1"]
    },
    {
      "id": 2,
      "description": "Implement core service features and member operations",
      "tasks": ["3.2", "4.2", "5.2", "5.3", "6.2", "7.2", "8.2", "8.3", "9.2", "9.3", "10.2", "10.3", "11.2"]
    },
    {
      "id": 3,
      "description": "Implement organization and policy features",
      "tasks": ["3.3", "4.3", "5.4", "6.3", "7.3", "8.4", "9.4", "10.4", "10.5", "11.3"]
    },
    {
      "id": 4,
      "description": "Implement REST API endpoints (organizations, members, invitations)",
      "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "13.1", "13.2", "13.3", "13.4", "14.1", "14.2", "14.3", "14.4"]
    },
    {
      "id": 5,
      "description": "Implement policy and billing endpoints",
      "tasks": ["15.1", "15.2", "15.3", "16.1", "16.2", "16.3", "16.4", "16.5"]
    },
    {
      "id": 6,
      "description": "Implement multisig and audit endpoints",
      "tasks": ["17.1", "17.2", "17.3", "17.4", "18.1", "18.2", "18.3"]
    },
    {
      "id": 7,
      "description": "Multi-tenancy middleware and enforcement",
      "tasks": ["19.1", "19.2", "20.1", "20.2", "20.3", "21.1", "21.2"]
    },
    {
      "id": 8,
      "description": "Integration and billing setup",
      "tasks": ["22.1", "22.2", "22.3", "24.1", "24.2", "24.3"]
    },
    {
      "id": 9,
      "description": "Authorization and endpoint-level enforcement",
      "tasks": ["25.1", "25.2"]
    },
    {
      "id": 10,
      "description": "Unit tests for all services",
      "tasks": ["26.1", "26.2", "26.3", "26.4", "26.5", "26.6", "26.7", "26.8"]
    },
    {
      "id": 11,
      "description": "Integration and e2e tests",
      "tasks": ["27.1", "27.2", "27.3", "27.4", "27.5", "27.6", "28.1", "28.2", "28.3", "28.4", "28.5"]
    },
    {
      "id": 12,
      "description": "Documentation and deployment prep",
      "tasks": ["30.1", "30.2", "30.3", "30.4", "31.1", "31.2", "31.3", "31.4", "32.1", "32.2", "32.3"]
    },
    {
      "id": 13,
      "description": "Security hardening and testing",
      "tasks": ["33.1", "33.2", "33.3", "33.4", "34.1", "34.2", "34.3", "34.4"]
    },
    {
      "id": 14,
      "description": "Performance and stress testing",
      "tasks": ["36.1", "36.2", "36.3", "37.1", "37.2", "37.3"]
    },
    {
      "id": 15,
      "description": "Pre-production validation",
      "tasks": ["38.1", "38.2", "38.3", "38.4"]
    },
    {
      "id": 16,
      "description": "Staged production rollout (Phase 1-5)",
      "tasks": ["39.1", "39.2", "39.3", "39.4", "39.5"]
    },
    {
      "id": 17,
      "description": "Production monitoring and support",
      "tasks": ["40.1", "40.2", "40.3", "40.4", "40.5"]
    },
    {
      "id": 18,
      "description": "Incident response and operational readiness",
      "tasks": ["41.1", "41.2", "41.3"]
    },
    {
      "id": 19,
      "description": "Final validation and sign-off",
      "tasks": ["42.1", "42.2", "42.3", "42.4"]
    }
  ]
}
```

### Wave Execution Strategy

**Sequential Phases (20 waves)**:

- **Waves 0-1**: Foundation (Database schema + core services) - Must complete before any other work
- **Waves 2-3**: Core service implementations - Builds on services from Wave 1
- **Waves 4-6**: API endpoints - Requires services from Waves 2-3
- **Wave 7-8**: Multi-tenancy middleware - Applies to all queries and endpoints
- **Waves 9**: Authorization enforcement - Final layer on endpoints
- **Waves 10-11**: Testing (unit → integration → e2e) - Tests what's built
- **Waves 12-14**: Documentation, security, performance - Preparation for production
- **Wave 15**: Pre-production validation - Sanity check before rollout
- **Waves 16-19**: Production rollout, monitoring, support, sign-off

**Parallel Execution Within Waves**:
- All tasks within the same wave are independent and can execute in parallel
- Example: In Wave 4, all endpoint implementations (12.1-14.4) are independent
- Example: In Wave 10, all unit tests (26.1-26.8) can run simultaneously

**Dependencies Enforced**:
- Database schema (Wave 0) must complete before services use it
- Services (Wave 1-2) must complete before endpoints call them
- All features (Waves 4-8) must complete before testing (Waves 10-11)
- Testing must pass before production prep (Waves 12-14)
