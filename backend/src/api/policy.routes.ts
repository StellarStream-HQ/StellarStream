import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { requireOrgContext } from '../middleware/requireOrgContext.js';
import { organizationPolicyService } from '../services/organization-policy.service.js';
import { authorizationService } from '../services/authorization.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * PUT /api/v1/orgs/:gAddress/policy - Update organization policy
 * Request body validation
 */
const updatePolicySchema = z.object({
  dailySpendLimitUsd: z.number().positive().nullable().optional(),
  allowedAssets: z.array(z.string()).nullable().optional(),
  requiresMultisig: z.boolean().optional(),
  multisigThreshold: z.number().positive().int().optional(),
});

// ── GET /api/v1/orgs/:gAddress/policy
// Retrieve organization's spending policy (DRAFTER+)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/policy',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      const policy = await organizationPolicyService.getPolicy(organizationId);

      res.json({
        success: true,
        policy: {
          id: policy.id,
          organizationId: policy.organizationId,
          dailySpendLimitUsd: policy.dailySpendLimitUsd,
          allowedAssets: policy.allowedAssets,
          requiresMultisig: policy.requiresMultisig,
          multisigThreshold: policy.multisigThreshold,
          updatedAt: policy.updatedAt,
          updatedBy: policy.updatedBy,
        },
      });
    } catch (error) {
      logger.error('Failed to retrieve policy', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve policy',
      });
    }
  }
);

// ── PUT /api/v1/orgs/:gAddress/policy
// Update organization's policy (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.put(
  '/policy',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const memberAddress = req.walletAddress!;

      // Parse request body
      const parsed = updatePolicySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
        return;
      }

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, memberAddress);

      // Update policy
      const updatedPolicy = await organizationPolicyService.updatePolicy(
        organizationId,
        parsed.data,
        memberAddress
      );

      res.json({
        success: true,
        policy: {
          id: updatedPolicy.id,
          organizationId: updatedPolicy.organizationId,
          dailySpendLimitUsd: updatedPolicy.dailySpendLimitUsd,
          allowedAssets: updatedPolicy.allowedAssets,
          requiresMultisig: updatedPolicy.requiresMultisig,
          multisigThreshold: updatedPolicy.multisigThreshold,
          updatedAt: updatedPolicy.updatedAt,
          updatedBy: updatedPolicy.updatedBy,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized policy update attempt', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to update policy', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to update policy',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/spending
// Get today's cumulative spending for organization (DRAFTER+)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/spending',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      // Get policy and daily spending
      const policy = await organizationPolicyService.getPolicy(organizationId);
      const today = new Date();
      const dailySpent = await organizationPolicyService.getDailySpent(organizationId, today);

      const remainingBudget = policy.dailySpendLimitUsd
        ? Math.max(0, policy.dailySpendLimitUsd - dailySpent)
        : null;

      res.json({
        success: true,
        spending: {
          date: today.toISOString().split('T')[0],
          dailySpentUsd: dailySpent,
          dailyLimitUsd: policy.dailySpendLimitUsd,
          remainingBudgetUsd: remainingBudget,
          budgetUtilizationPercent:
            policy.dailySpendLimitUsd
              ? Math.round((dailySpent / policy.dailySpendLimitUsd) * 100)
              : null,
        },
      });
    } catch (error) {
      logger.error('Failed to get spending', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get spending',
      });
    }
  }
);

export default router;
