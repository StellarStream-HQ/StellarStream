import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { requireOrgContext } from '../middleware/requireOrgContext.js';
import { billingService } from '../services/billing.service.js';
import { authorizationService } from '../services/authorization.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * POST /api/v1/orgs/:gAddress/billing/plan - Update subscription plan
 * Request body validation
 */
const updatePlanSchema = z.object({
  plan: z.enum(['FREE', 'PRO', 'ENTERPRISE']),
});

// ── GET /api/v1/orgs/:gAddress/billing/current
// Get current billing period usage (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/billing/current',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Get current billing record
      const billing = await billingService.getCurrentBilling(organizationId);

      res.json({
        success: true,
        billing: {
          billingPeriod: billing.billingPeriod,
          plan: billing.plan,
          streamsCreated: billing.streamsCreated,
          disbursementsProcessed: billing.disbursementsProcessed,
          apiRequests: billing.apiRequests,
          volumeUsd: billing.totalVolumeUsd,
          chargeUsd: billing.totalChargesUsd,
          status: billing.status,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized billing access attempt', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to get current billing', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get current billing',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/billing/history
// Get past billing periods (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/billing/history',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const months = Math.min(Math.max(parseInt(req.query.months as string) || 12, 1), 36);

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Get historical billing records
      const history = await billingService.getBillingHistory(organizationId, months);

      res.json({
        success: true,
        history: history.map((record) => ({
          billingPeriod: record.billingPeriod,
          plan: record.plan,
          streamsCreated: record.streamsCreated,
          disbursementsProcessed: record.disbursementsProcessed,
          apiRequests: record.apiRequests,
          volumeUsd: record.totalVolumeUsd,
          chargeUsd: record.totalChargesUsd,
          status: record.status,
        })),
        count: history.length,
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized billing history access', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to get billing history', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get billing history',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/billing/plan
// Get current plan details (DRAFTER+)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/billing/plan',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      // Get current plan
      const billingPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
      const billing = await billingService.getBillingRecord(organizationId, billingPeriod);
      const plan = billing?.plan || 'FREE';
      const limits = billingService.getPlanLimits(plan);

      res.json({
        success: true,
        plan: {
          name: plan,
          streamsLimit: limits.maxStreams,
          disbursementsLimit: limits.maxDisbursements,
          apiRequestsLimit: limits.maxApiRequests,
          costPerMonth: limits.costPerMonth,
          features: limits.features || [],
        },
      });
    } catch (error) {
      logger.error('Failed to get plan', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get plan',
      });
    }
  }
);

// ── POST /api/v1/orgs/:gAddress/billing/plan
// Change subscription plan (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/billing/plan',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const memberAddress = req.walletAddress!;

      // Parse request body
      const parsed = updatePlanSchema.safeParse(req.body);
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

      // Update plan (effective next billing period)
      const result = await billingService.updatePlan(organizationId, parsed.data.plan);

      const limits = billingService.getPlanLimits(parsed.data.plan);

      res.json({
        success: true,
        message: `Plan changed to ${parsed.data.plan}. Changes effective next billing period.`,
        plan: {
          name: parsed.data.plan,
          streamsLimit: limits.maxStreams,
          disbursementsLimit: limits.maxDisbursements,
          apiRequestsLimit: limits.maxApiRequests,
          costPerMonth: limits.costPerMonth,
          features: limits.features || [],
          effectiveDate: result.effectiveDate,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized plan change attempt', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to update plan', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to update plan',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/billing/report
// Export usage report with daily breakdown (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/billing/report',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Generate usage report
      const billingPeriod = req.query.period as string || new Date().toISOString().slice(0, 7);
      const report = await billingService.generateUsageReport(organizationId, billingPeriod);

      const format = (req.query.format as string) || 'json';

      if (format === 'csv') {
        // Convert report to CSV
        const headers = ['Metric', 'Value'];
        const rows = [
          ['Billing Period', report.period],
          ['Plan', report.plan],
          ['Streams Created', report.streamsCreated],
          ['Disbursements Processed', report.disbursementsProcessed],
          ['API Requests', report.apiRequests],
          ['Total Volume USD', report.totalVolumeUsd],
          ['Total Charges USD', report.totalChargesUsd],
        ];

        const csv =
          headers.join(',') +
          '\n' +
          rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="billing-report-${billingPeriod}.csv"`);
        res.send(csv);
      } else {
        res.json({
          success: true,
          report,
        });
      }
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized report access', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to generate report', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to generate report',
      });
    }
  }
);

export default router;
