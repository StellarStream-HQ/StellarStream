import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { organizationService } from '../services/organization.service.js';
import { organizationMemberService } from '../services/organization-member.service.js';
import { authorizationService } from '../services/authorization.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * POST /api/v1/organizations - Create organization
 * Request body validation
 */
const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  gAddress: z
    .string()
    .regex(/^G[A-Z0-9]{55}$/, 'Invalid G-address format')
    .optional(),
  logoUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
});

/**
 * PUT /api/v1/organizations/:orgId - Update organization metadata
 * Request body validation
 */
const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  logoUrl: z.string().url().optional(),
  customDomain: z.string().optional(),
  contactEmail: z.string().email().optional(),
});

// ── GET /api/v1/organizations
// List all organizations where the authenticated member is active
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/organizations',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const memberAddress = req.walletAddress!;

      // Get all organizations where this member is active
      const organizations = await organizationMemberService.listOrganizationsForMember(
        memberAddress,
      );

      res.json({
        success: true,
        organizations: organizations.map((org) => ({
          id: org.id,
          gAddress: org.gAddress,
          name: org.name,
          description: org.description,
          logoUrl: org.logoUrl,
          isActive: org.isActive,
          memberCount: org.memberCount || 0,
          currentRole: org.currentRole,
          createdAt: org.createdAt,
        })),
        count: organizations.length,
      });
    } catch (error) {
      logger.error('Failed to list organizations', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list organizations',
      });
    }
  },
);

// ── POST /api/v1/organizations
// Create a new organization
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/organizations',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const creatorAddress = req.walletAddress!;

      // Validate request body
      const parsed = createOrganizationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      const { name, description, gAddress, logoUrl, contactEmail } = parsed.data;

      // Generate G-address if not provided - for now, use a placeholder
      // In production, this should generate a valid Stellar G-address
      const finalGAddress = gAddress || `G${Buffer.from(name + Date.now()).toString('base64').slice(0, 55)}`;

      // Create organization
      const organization = await organizationService.create({
        name,
        description,
        gAddress: finalGAddress,
        logoUrl,
        contactEmail,
        creatorAddress,
      });

      res.status(201).json({
        success: true,
        organization: {
          id: organization.id,
          gAddress: organization.gAddress,
          name: organization.name,
          description: organization.description,
          logoUrl: organization.logoUrl,
          createdAt: organization.createdAt,
          createdBy: organization.createdBy,
        },
        member: {
          address: creatorAddress,
          role: 'EXECUTOR',
          joinedAt: organization.createdAt,
        },
      });
    } catch (error: any) {
      logger.error('Failed to create organization', error);

      // Handle specific error cases
      if (error.message?.includes('unique constraint')) {
        res.status(409).json({
          success: false,
          error: 'Organization with this G-address already exists',
          code: 'ORG_ALREADY_EXISTS',
        });
        return;
      }

      if (error.message?.includes('Invalid G-address')) {
        res.status(400).json({
          success: false,
          error: 'Invalid G-address format',
          code: 'INVALID_GADDRESS',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to create organization',
      });
    }
  },
);

// ── GET /api/v1/organizations/:orgId
// Retrieve organization details
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/organizations/:orgId',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId } = req.params;
      const memberAddress = req.walletAddress!;

      // Verify member belongs to organization
      const isMember = await organizationMemberService.isMember(orgId, memberAddress);
      if (!isMember) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Get organization details
      const organization = await organizationService.getById(orgId);
      if (!organization) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Get member count
      const members = await organizationMemberService.listMembers(orgId);
      const memberCount = members.filter((m) => m.isActive).length;

      // Get current member's role
      const currentRole = await organizationMemberService.getRole(orgId, memberAddress);

      res.json({
        success: true,
        organization: {
          id: organization.id,
          gAddress: organization.gAddress,
          name: organization.name,
          description: organization.description,
          logoUrl: organization.logoUrl,
          customDomain: organization.customDomain,
          contactEmail: organization.contactEmail,
          isActive: organization.isActive,
          memberCount,
          currentRole,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Failed to retrieve organization', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve organization',
      });
    }
  },
);

// ── PUT /api/v1/organizations/:orgId
// Update organization metadata (EXECUTOR role required)
// ─────────────────────────────────────────────────────────────────────────────
router.put(
  '/organizations/:orgId',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId } = req.params;
      const memberAddress = req.walletAddress!;

      // Verify member belongs to organization
      const isMember = await organizationMemberService.isMember(orgId, memberAddress);
      if (!isMember) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Check EXECUTOR role requirement
      await authorizationService.authorize(orgId, memberAddress, 'update_settings');

      // Validate request body
      const parsed = updateOrganizationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        });
        return;
      }

      // Check that at least one field is being updated
      const updateData = parsed.data;
      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          success: false,
          error: 'At least one field must be provided for update',
        });
        return;
      }

      // Update organization metadata
      const updatedOrganization = await organizationService.updateMetadata(
        orgId,
        updateData,
        memberAddress,
      );

      res.json({
        success: true,
        organization: {
          id: updatedOrganization.id,
          gAddress: updatedOrganization.gAddress,
          name: updatedOrganization.name,
          description: updatedOrganization.description,
          logoUrl: updatedOrganization.logoUrl,
          customDomain: updatedOrganization.customDomain,
          contactEmail: updatedOrganization.contactEmail,
          isActive: updatedOrganization.isActive,
          updatedAt: updatedOrganization.updatedAt,
        },
      });
    } catch (error: any) {
      logger.error('Failed to update organization', error);

      if (error.message?.includes('EXECUTOR')) {
        res.status(403).json({
          success: false,
          error: 'Only EXECUTOR role can update organization',
          code: 'INSUFFICIENT_PERMISSION',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update organization',
      });
    }
  },
);

// ── DELETE /api/v1/organizations/:orgId
// Soft delete organization (mark as inactive, EXECUTOR role required)
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/organizations/:orgId',
  requireWalletAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { orgId } = req.params;
      const memberAddress = req.walletAddress!;

      // Verify member belongs to organization
      const isMember = await organizationMemberService.isMember(orgId, memberAddress);
      if (!isMember) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      // Check EXECUTOR role requirement
      await authorizationService.authorize(orgId, memberAddress, 'update_settings');

      // Mark organization as inactive (soft delete)
      const updatedOrganization = await organizationService.updateMetadata(
        orgId,
        { isActive: false },
        memberAddress,
      );

      res.json({
        success: true,
        message: 'Organization deleted successfully',
        organization: {
          id: updatedOrganization.id,
          gAddress: updatedOrganization.gAddress,
          isActive: updatedOrganization.isActive,
          deletedAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      logger.error('Failed to delete organization', error);

      if (error.message?.includes('EXECUTOR')) {
        res.status(403).json({
          success: false,
          error: 'Only EXECUTOR role can delete organization',
          code: 'INSUFFICIENT_PERMISSION',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to delete organization',
      });
    }
  },
);

export default router;
