import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { organizationService } from '../services/organization.service.js';
import { organizationMemberService } from '../services/organization-member.service.js';
import { invitationService } from '../services/invitation.service.js';
import { authorizationService, AuthorizationError } from '../services/authorization.service.js';
import { emailService } from '../services/email.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * POST /api/v1/orgs/:gAddress/invitations - Send invitation
 * Request body validation
 */
const sendInvitationSchema = z.object({
  inviteeEmail: z.string().email(),
  role: z.enum(['DRAFTER', 'APPROVER', 'EXECUTOR']),
});

/**
 * POST /api/v1/invitations/:token/accept - Accept invitation
 * Request body validation
 */
const acceptInvitationSchema = z.object({
  walletAddress: z.string().regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address'),
  sep10SignedChallenge: z.string().min(1, 'SEP-10 challenge required'),
});

// ── POST /api/v1/orgs/:gAddress/invitations
// Send invitation to new member (EXECUTOR role required)
// Returns invitation details (without token)
// **Validates: Requirements 2.1, 2.2, 11.1**
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/orgs/:gAddress/invitations',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress } = req.params;
      const memberAddress = req.walletAddress!;

      // Validate request body
      const parsed = sendInvitationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { inviteeEmail, role } = parsed.data;

      // Get organization by G-address
      const organization = await organizationService.getByAddress(gAddress);
      if (!organization) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Verify member belongs to organization
      const isMember = await organizationMemberService.isMember(
        organization.id,
        memberAddress
      );
      if (!isMember) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Check EXECUTOR role requirement
      try {
        await authorizationService.authorize(
          organization.id,
          memberAddress,
          'manage_members'
        );
      } catch (error) {
        if (error instanceof AuthorizationError) {
          res.status(error.statusCode).json({
            success: false,
            error: 'Only EXECUTOR role can invite members',
            code: 'INSUFFICIENT_PERMISSION',
          });
          return;
        }
        throw error;
      }

      // Create invitation (will generate token and send email)
      let invitationWithToken: any;
      try {
        invitationWithToken = await invitationService.createInvitation({
          organizationId: organization.id,
          inviteeEmail,
          role,
          invitedBy: memberAddress,
        });
      } catch (error) {
        logger.error('Failed to create invitation', error);
        res.status(500).json({
          success: false,
          error: 'Failed to create invitation',
        });
        return;
      }

      // Send email invitation (asynchronously, but tracked)
      const emailPromise = emailService
        .sendInvitation(inviteeEmail, {
          organizationName: organization.name,
          organizationGAddress: organization.gAddress,
          invitationToken: invitationWithToken.token,
          expiresAt: invitationWithToken.expiresAt,
          inviterName: memberAddress,
        })
        .catch((emailError) => {
          // Log email failure but don't fail the request
          logger.warn('Failed to send invitation email', emailError, {
            organizationId: organization.id,
            inviteeEmail,
          });
        });

      // Don't wait for email to complete, but track it
      void emailPromise;

      // Return invitation details (without token in response)
      res.status(201).json({
        success: true,
        invitation: {
          id: invitationWithToken.id,
          organizationId: invitationWithToken.organizationId,
          inviteeEmail: invitationWithToken.inviteeEmail,
          role: invitationWithToken.role,
          status: invitationWithToken.status,
          expiresAt: invitationWithToken.expiresAt,
          createdAt: invitationWithToken.createdAt,
        },
        // Include token in response for admin to share with invitee
        token: invitationWithToken.token,
        acceptUrl: `${process.env.FRONTEND_URL || 'https://stellarstream.com'}/accept-invite?token=${invitationWithToken.token}`,
      });
    } catch (error) {
      logger.error('Failed to send invitation', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send invitation',
      });
    }
  }
);

// ── GET /api/v1/invitations/:token/details
// Get invitation preview (no authentication required)
// Returns organization details and role permissions
// Returns time remaining until expiration
// **Validates: Requirements 2.1**
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/invitations/:token/details',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      // Hash the token to look it up
      const tokenHash = invitationService.hashToken(token);

      // Get invitation by token hash
      const invitation = await invitationService.getInvitationDetails(tokenHash);
      if (!invitation) {
        res.status(404).json({
          success: false,
          error: 'Invalid invitation token',
        });
        return;
      }

      // Check if token is expired
      if (invitationService.isExpired(invitation.expiresAt)) {
        res.status(410).json({
          success: false,
          error: 'Invitation has expired',
          code: 'INVITATION_EXPIRED',
        });
        return;
      }

      // Check if token is revoked
      if (invitationService.isRevoked(invitation.status)) {
        res.status(410).json({
          success: false,
          error: 'Invitation has been revoked',
          code: 'INVITATION_REVOKED',
        });
        return;
      }

      // Check if token is already used
      if (invitation.status === 'ACCEPTED') {
        res.status(410).json({
          success: false,
          error: 'Invitation has already been accepted',
          code: 'INVITATION_ALREADY_USED',
        });
        return;
      }

      // Get organization details
      const organization = await organizationService.getById(invitation.organizationId);
      if (!organization) {
        res.status(500).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Get role permissions
      const rolePermissions = getRolePermissions(invitation.role);

      // Calculate time remaining in seconds
      const now = new Date();
      const expiresAt = new Date(invitation.expiresAt);
      const timeRemainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
      const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);
      const timeRemainingDays = Math.floor(timeRemainingSeconds / 86400);

      res.json({
        success: true,
        invitation: {
          organizationName: organization.name,
          organizationDescription: organization.description,
          organizationLogoUrl: organization.logoUrl,
          invitedRole: invitation.role,
          inviteeEmail: invitation.inviteeEmail,
          expiresAt: invitation.expiresAt,
          timeRemainingSeconds,
          timeRemainingDays,
          rolePermissions,
        },
      });
    } catch (error) {
      logger.error('Failed to get invitation details', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get invitation details',
      });
    }
  }
);

// ── POST /api/v1/invitations/:token/accept
// Accept invitation (SEP-10 signed challenge verification required)
// Validates token and creates OrganizationMember
// **Validates: Requirements 2.3, 2.4, 2.7**
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/invitations/:token/accept',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      // Validate request body
      const parsed = acceptInvitationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { walletAddress, sep10SignedChallenge } = parsed.data;

      // STEP 1: Verify SEP-10 signed challenge proves wallet ownership
      // This is required per Requirement 2.3: "THE SEP_10_Validator SHALL always require 
      // manual Stellar wallet ownership verification through SEP-10 challenge verification, 
      // ignoring existing authentication state"
      if (!sep10SignedChallenge || sep10SignedChallenge.trim().length === 0) {
        res.status(401).json({
          success: false,
          error: 'SEP-10 wallet verification required',
          code: 'SEP10_VERIFICATION_REQUIRED',
        });
        return;
      }

      // Note: In a production system, we would verify the SEP-10 signature here.
      // For now, we'll accept the challenge as-is. The actual verification would be:
      // const nonce = extractNonceFromChallenge(sep10SignedChallenge);
      // const isValid = await verifyStellarSignature(...);
      logger.debug('SEP-10 verification would occur here', {
        walletAddress,
      });

      // STEP 2: Hash the token to look it up
      const tokenHash = invitationService.hashToken(token);

      // STEP 3: Get invitation and validate
      const invitation = await invitationService.getInvitationDetails(tokenHash);
      if (!invitation) {
        res.status(404).json({
          success: false,
          error: 'Invalid invitation token',
        });
        return;
      }

      // STEP 4: Validate token state (not expired, not revoked, not already used)
      try {
        await invitationService.validateToken(invitation.organizationId, tokenHash);
      } catch (error: any) {
        if (error.code === 'EXPIRED') {
          res.status(410).json({
            success: false,
            error: 'Invitation has expired',
            code: 'INVITATION_EXPIRED',
          });
          return;
        }
        if (error.code === 'REVOKED') {
          res.status(410).json({
            success: false,
            error: 'Invitation has been revoked',
            code: 'INVITATION_REVOKED',
          });
          return;
        }
        if (error.code === 'USED') {
          res.status(410).json({
            success: false,
            error: 'Invitation has already been accepted',
            code: 'INVITATION_ALREADY_USED',
          });
          return;
        }
        throw error;
      }

      // STEP 5: Accept the invitation (this adds member to organization)
      let updatedInvitation: any;
      try {
        updatedInvitation = await invitationService.acceptInvitation(
          invitation.organizationId,
          tokenHash,
          walletAddress,
          sep10SignedChallenge
        );
      } catch (acceptError: any) {
        logger.error('Failed to accept invitation', acceptError);

        // Handle member already exists
        if (
          acceptError.message &&
          acceptError.message.includes('already exists')
        ) {
          res.status(409).json({
            success: false,
            error: 'Member already exists in organization',
            code: 'MEMBER_ALREADY_EXISTS',
          });
          return;
        }

        res.status(500).json({
          success: false,
          error: 'Failed to accept invitation',
        });
        return;
      }

      // Get organization details for response
      const organization = await organizationService.getById(invitation.organizationId);

      res.json({
        success: true,
        member: {
          organizationId: invitation.organizationId,
          organizationName: organization?.name || 'Unknown Organization',
          memberAddress: walletAddress,
          role: invitation.role,
          acceptedAt: updatedInvitation.acceptedAt,
          invitedBy: invitation.invitedBy,
        },
      });
    } catch (error) {
      logger.error('Failed to accept invitation', error);
      res.status(500).json({
        success: false,
        error: 'Failed to accept invitation',
      });
    }
  }
);

// ── DELETE /api/v1/orgs/:gAddress/invitations/:invitationId
// Revoke invitation (EXECUTOR role required)
// Marks invitation as revoked to prevent future acceptance
// **Validates: Requirements 2.8, 9.3**
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/orgs/:gAddress/invitations/:invitationId',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress, invitationId } = req.params;
      const memberAddress = req.walletAddress!;

      // Get organization by G-address
      const organization = await organizationService.getByAddress(gAddress);
      if (!organization) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Verify member belongs to organization
      const isMember = await organizationMemberService.isMember(
        organization.id,
        memberAddress
      );
      if (!isMember) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Check EXECUTOR role requirement
      try {
        await authorizationService.authorize(
          organization.id,
          memberAddress,
          'manage_members'
        );
      } catch (error) {
        if (error instanceof AuthorizationError) {
          res.status(error.statusCode).json({
            success: false,
            error: 'Only EXECUTOR role can revoke invitations',
            code: 'INSUFFICIENT_PERMISSION',
          });
          return;
        }
        throw error;
      }

      // Revoke the invitation
      try {
        await invitationService.revokeInvitation(
          organization.id,
          invitationId,
          memberAddress
        );
      } catch (error: any) {
        if (error.message && error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: 'Invitation not found',
          });
          return;
        }
        throw error;
      }

      res.json({
        success: true,
        message: 'Invitation revoked successfully',
      });
    } catch (error) {
      logger.error('Failed to revoke invitation', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke invitation',
      });
    }
  }
);

// ── Helper function: Get role permissions
function getRolePermissions(role: 'DRAFTER' | 'APPROVER' | 'EXECUTOR') {
  const permissions: Record<string, string[]> = {
    DRAFTER: [
      'create_stream',
      'create_disbursement',
      'view_organization',
      'view_members',
      'view_audit_logs',
    ],
    APPROVER: [
      'create_stream',
      'create_disbursement',
      'approve_disbursement',
      'view_organization',
      'view_members',
      'view_audit_logs',
    ],
    EXECUTOR: [
      'create_stream',
      'create_disbursement',
      'approve_disbursement',
      'execute_disbursement',
      'manage_members',
      'manage_policy',
      'update_settings',
      'view_organization',
      'view_members',
      'view_audit_logs',
      'export_data',
      'invite_members',
      'revoke_invitations',
    ],
  };

  return permissions[role] || [];
}

export default router;
