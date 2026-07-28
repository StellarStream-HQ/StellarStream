import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { OrgMemberService } from '../services/org-member.service.js';
import { logger } from '../logger.js';
import { prisma } from '../lib/db.js';

const router = Router();
const service = new OrgMemberService();

// ── Validation schemas ────────────────────────────────────────────────────────

const upsertMemberSchema = z.object({
  memberAddress: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
  role: z.enum(['DRAFTER', 'APPROVER', 'EXECUTOR']),
});

const removeMemberSchema = z.object({
  memberAddress: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid Stellar address format'),
});

/**
 * Helper function to resolve organization ID from G-address
 * Returns the organization ID if found, null otherwise
 */
async function resolveOrganizationId(gAddress: string): Promise<string | null> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { gAddress },
      select: { id: true },
    });
    return organization?.id ?? null;
  } catch (error) {
    logger.error('Failed to resolve organization from G-address', error, { gAddress });
    return null;
  }
}

// ── GET /api/v1/orgs/:gAddress/role (13.4)
// Get caller's role in organization
// Return authenticated member's role in organization
// Return 404 if member not in organization
// Requirements: 3.1
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/orgs/:gAddress/role',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress } = req.params;
      const memberAddress = req.walletAddress!;

      // Resolve organization ID from G-address
      const organizationId = await resolveOrganizationId(gAddress);
      if (!organizationId) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
          code: 'ORG_NOT_FOUND',
        });
        return;
      }

      // Get member's role
      const role = await service.getRole(organizationId, memberAddress);
      if (!role) {
        res.status(404).json({
          success: false,
          error: 'Member not found in organization',
          code: 'NOT_A_MEMBER',
        });
        return;
      }

      res.json({
        success: true,
        gAddress,
        memberAddress,
        role,
      });
    } catch (error) {
      logger.error('Failed to get member role', error, { gAddress: req.params.gAddress });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve role',
      });
    }
  },
);

// ── GET /api/v1/orgs/:gAddress/members (13.1)
// List members of organization
// Require DRAFTER or higher role
// Return member list with roles and join dates
// Requirements: 12.1, 3.1
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/orgs/:gAddress/members',
  requireWalletAuth,
  requireRole('DRAFTER'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress } = req.params;
      const memberAddress = req.walletAddress!;

      // Resolve organization ID from G-address
      const organizationId = await resolveOrganizationId(gAddress);
      if (!organizationId) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
          code: 'ORG_NOT_FOUND',
        });
        return;
      }

      // Verify caller is member of this organization
      const callerRole = await service.getRole(organizationId, memberAddress);
      if (!callerRole) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // List all active members
      const members = await service.listMembers(organizationId);

      res.json({
        success: true,
        gAddress,
        members: members.map((m) => ({
          memberAddress: m.memberAddress,
          role: m.role,
          joinDate: m.createdAt,
          lastActivityAt: m.lastActivityAt,
        })),
        count: members.length,
      });
    } catch (error) {
      logger.error('Failed to list members', error, { gAddress: req.params.gAddress });
      res.status(500).json({
        success: false,
        error: 'Failed to list members',
      });
    }
  },
);

// ── POST /api/v1/orgs/:gAddress/members (13.2)
// Add or update member
// Require EXECUTOR role
// Validate role is valid (DRAFTER, APPROVER, EXECUTOR)
// Create or update member role
// Audit log the change
// Requirements: 3.4, 12.2
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/orgs/:gAddress/members',
  requireWalletAuth,
  requireRole('EXECUTOR'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress } = req.params;
      const callerAddress = req.walletAddress!;

      // Validate request body
      const parsed = upsertMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { memberAddress, role } = parsed.data;

      // Resolve organization ID from G-address
      const organizationId = await resolveOrganizationId(gAddress);
      if (!organizationId) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
          code: 'ORG_NOT_FOUND',
        });
        return;
      }

      // Verify caller is EXECUTOR in this organization
      const callerRole = await service.getRole(organizationId, callerAddress);
      if (callerRole !== 'EXECUTOR') {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
        return;
      }

      // Add or update member
      const member = await service.addMember(
        organizationId,
        memberAddress,
        role,
        callerAddress,
      );

      res.status(201).json({
        success: true,
        gAddress,
        memberAddress: member.memberAddress,
        role: member.role,
        joinDate: member.createdAt,
      });
    } catch (error: any) {
      logger.error('Failed to add/update member', error, { gAddress: req.params.gAddress });

      // Handle specific error cases
      if (error.message?.includes('already exists')) {
        res.status(409).json({
          success: false,
          error: 'Member already exists in organization',
          code: 'MEMBER_EXISTS',
        });
        return;
      }

      if (error.message?.includes('Invalid role')) {
        res.status(400).json({
          success: false,
          error: error.message,
          code: 'INVALID_ROLE',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to add/update member',
      });
    }
  },
);

// ── DELETE /api/v1/orgs/:gAddress/members (13.3)
// Remove member
// Require EXECUTOR role
// Prevent removing only EXECUTOR
// Mark member as inactive and revoke access
// Audit log the removal
// Requirements: 3.5, 12.3
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/orgs/:gAddress/members',
  requireWalletAuth,
  requireRole('EXECUTOR'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { gAddress } = req.params;
      const callerAddress = req.walletAddress!;

      // Validate request body
      const parsed = removeMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { memberAddress } = parsed.data;

      // Resolve organization ID from G-address
      const organizationId = await resolveOrganizationId(gAddress);
      if (!organizationId) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
          code: 'ORG_NOT_FOUND',
        });
        return;
      }

      // Verify caller is EXECUTOR in this organization
      const callerRole = await service.getRole(organizationId, callerAddress);
      if (callerRole !== 'EXECUTOR') {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
        return;
      }

      // Check if trying to remove the only EXECUTOR
      if (memberAddress !== callerAddress) {
        // Get all EXECUTOR members
        const executors = await service.listMembers(organizationId);
        const executorCount = executors.filter((m) => m.role === 'EXECUTOR').length;

        // If removing another member, check they're not the last EXECUTOR
        const memberToRemove = await service.getMember(organizationId, memberAddress);
        if (memberToRemove?.role === 'EXECUTOR' && executorCount <= 1) {
          res.status(409).json({
            success: false,
            error: 'Cannot remove the only EXECUTOR in the organization',
            code: 'LAST_EXECUTOR',
          });
          return;
        }
      }

      // Remove member (soft delete)
      await service.removeMember(organizationId, memberAddress, callerAddress);

      res.json({
        success: true,
        gAddress,
        memberAddress,
        status: 'removed',
      });
    } catch (error) {
      logger.error('Failed to remove member', error, { gAddress: req.params.gAddress });
      res.status(500).json({
        success: false,
        error: 'Failed to remove member',
      });
    }
  },
);

export default router;
