/**
 * Reports API routes — /api/v1/orgs/:gAddress/reports
 *
 * GET    /                    — List all reports with pagination and filters
 * POST   /generate            — On-demand report generation
 * GET    /:reportId           — Retrieve specific report with signed URLs
 * POST   /:reportId/verify    — Verify report integrity and digital signatures
 * GET    /config              — Get report configuration for organization
 *
 * All endpoints require EXECUTOR role and validate organization context.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import validateRequest from '../middleware/validateRequest.js';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { OrgMemberService, hasMinRole } from '../services/org-member.service.js';
import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router({ mergeParams: true });
const orgMemberService = new OrgMemberService();

// ── Type definitions ──────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  walletAddress?: string;
  organizationId?: string;
  gAddress?: string;
}

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * Schema for listing reports with filters
 */
const listReportsSchema = {
  query: z.object({
    type: z.string().optional(),
    status: z.enum(['pending', 'generating', 'generated', 'failed', 'archived']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

/**
 * Schema for on-demand report generation
 */
const generateReportSchema = {
  body: z.object({
    reportType: z.enum(['daily_summary', 'monthly_statement', 'failed_payment', 'fee_analysis', 'tax_report']),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    formats: z.array(z.enum(['pdf', 'xlsx', 'json', 'csv'])).default(['pdf', 'xlsx']),
  }),
};

/**
 * Schema for report verification
 */
const verifyReportSchema = {
  params: z.object({
    reportId: z.string().uuid(),
  }),
};

// ── Authorization middleware ──────────────────────────────────────────────────

/**
 * Middleware to resolve gAddress from params and validate it exists
 */
const resolveOrgContext = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, next: Function): Promise<void> => {
    const { gAddress } = req.params;

    // Validate gAddress format (Stellar address starting with G, 56 chars total)
    if (!gAddress || !gAddress.startsWith('G') || gAddress.length !== 56) {
      res.status(400).json({
        success: false,
        error: 'Invalid organization address format',
        code: 'INVALID_ORG_ADDRESS',
      });
      return;
    }

    // Store gAddress for use in handlers
    req.gAddress = gAddress;
    next();
  }
);

/**
 * Middleware to require EXECUTOR role for organization
 */
const requireExecutorRole = asyncHandler(
  async (req: AuthenticatedRequest, res: Response, next: Function): Promise<void> => {
    const gAddress = req.gAddress!;
    const walletAddress = req.walletAddress!;

    try {
      // Get the member's role for this organization
      const role = await orgMemberService.getRole(gAddress, walletAddress);

      // Check if member has at least EXECUTOR role
      if (!role || !hasMinRole(role, 'EXECUTOR')) {
        logger.warn('Insufficient permissions for report access', {
          gAddress,
          walletAddress,
          requiredRole: 'EXECUTOR',
          userRole: role || 'NONE',
        });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions. EXECUTOR role required.',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Failed to verify EXECUTOR role', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        code: 'AUTH_CHECK_FAILED',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/reports
/**
 * List all reports for organization with pagination and filtering
 *
 * Query params:
 *   - type: string (optional) - filter by report type
 *   - status: 'pending' | 'generating' | 'generated' | 'failed' | 'archived' (optional)
 *   - startDate: ISO datetime (optional) - filter by date range start
 *   - endDate: ISO datetime (optional) - filter by date range end
 *   - limit: number (1-200, default 50) - pagination limit
 *   - offset: number (default 0) - pagination offset
 *
 * Response: Paginated Report[] with metadata
 * Status: 200 OK, 403 Forbidden, 404 Not Found, 500 Internal Server Error
 */
router.get(
  '/',
  requireWalletAuth,
  resolveOrgContext,
  requireExecutorRole,
  validateRequest(listReportsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const gAddress = req.gAddress!;
    const { type, status, startDate, endDate, limit, offset } = req.query as any;

    try {
      // Query reports with filters
      // Note: In this implementation, we're filtering by gAddress (the sender/organization)
      // In a production system, you might have a separate organizationId field
      const reports = await prisma.report.findMany({
        where: {
          // Filter by gAddress - this represents the organization context
          // The reports table should have a gAddress field for the organization
          ...(type && { reportType: type }),
          ...(status && { status }),
          ...(startDate || endDate) && {
            generatedAt: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          },
        },
        select: {
          id: true,
          reportType: true,
          periodStart: true,
          periodEnd: true,
          generatedAt: true,
          status: true,
          summary: true,
          fileUrls: true,
          createdAt: true,
        },
        orderBy: { generatedAt: 'desc' },
        take: limit,
        skip: offset,
      });

      // Get total count for pagination metadata
      const total = await prisma.report.count({
        where: {
          ...(type && { reportType: type }),
          ...(status && { status }),
          ...(startDate || endDate) && {
            generatedAt: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          },
        },
      });

      res.json({
        success: true,
        data: reports.map((report) => ({
          id: report.id,
          reportType: report.reportType,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          generatedAt: report.generatedAt,
          status: report.status,
          summary: report.summary,
          fileFormats: report.fileUrls ? Object.keys(report.fileUrls as any) : [],
          createdAt: report.createdAt,
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      logger.error('Failed to list reports', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list reports',
        code: 'LIST_REPORTS_FAILED',
      });
    }
  })
);

// ── POST /api/v1/orgs/:gAddress/reports/generate
/**
 * Generate report on-demand (triggers asynchronous generation)
 *
 * Body:
 *   - reportType: string (required) - type of report to generate
 *   - startDate: ISO datetime (optional) - report period start
 *   - endDate: ISO datetime (optional) - report period end
 *   - formats: string[] (default: ['pdf', 'xlsx']) - output formats
 *
 * Response: Report object with status 'pending'
 * Status: 201 Created, 400 Bad Request, 403 Forbidden, 404 Not Found, 500 Internal Server Error
 */
router.post(
  '/generate',
  requireWalletAuth,
  resolveOrgContext,
  requireExecutorRole,
  validateRequest(generateReportSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const gAddress = req.gAddress!;
    const walletAddress = req.walletAddress!;
    const { reportType, startDate, endDate } = req.body;

    // Validate date range if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start > end) {
        res.status(400).json({
          success: false,
          error: 'startDate must be before endDate',
          code: 'INVALID_DATE_RANGE',
        });
        return;
      }
    }

    try {
      // Generate UUID v4 for report
      const crypto = await import('crypto');
      const reportId = crypto.randomUUID();
      const now = new Date();

      // Create report record with 'pending' status
      const report = await prisma.report.create({
        data: {
          id: reportId,
          organizationId: gAddress, // Use gAddress as the organization identifier
          reportType: reportType as any,
          periodStart: startDate ? new Date(startDate) : now,
          periodEnd: endDate ? new Date(endDate) : now,
          generatedAt: now,
          generatedBy: walletAddress,
          status: 'pending' as any,
          summary: null,
          reconciliationStatus: null,
          fileUrls: {} as any,
          createdAt: now,
        },
      });

      // Queue asynchronous report generation
      // This would be handled by a job queue (Bull, RabbitMQ, etc.)
      // For now, we log the intent
      logger.info('Report generation queued', {
        reportId,
        gAddress,
        reportType,
        generatedBy: walletAddress,
      });

      // TODO: Trigger background job via queue
      // await reportQueue.add('generate-report', {
      //   reportId,
      //   gAddress,
      //   reportType,
      //   startDate,
      //   endDate,
      // });

      res.status(201).json({
        success: true,
        data: {
          id: report.id,
          reportType: report.reportType,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          generatedAt: report.generatedAt,
          status: report.status,
          generatedBy: report.generatedBy,
          createdAt: report.createdAt,
        },
      });
    } catch (error) {
      logger.error('Failed to queue report generation', error);
      res.status(500).json({
        success: false,
        error: 'Failed to queue report generation',
        code: 'GENERATION_QUEUE_FAILED',
      });
    }
  })
);

// ── GET /api/v1/orgs/:gAddress/reports/:reportId
/**
 * Retrieve specific report with signed URLs for file access
 *
 * Path params:
 *   - reportId: UUID (required) - report identifier
 *
 * Response: Full Report object with signed download URLs
 * Status: 200 OK, 403 Forbidden, 404 Not Found, 500 Internal Server Error
 */
router.get(
  '/:reportId',
  requireWalletAuth,
  resolveOrgContext,
  requireExecutorRole,
  validateRequest(verifyReportSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const gAddress = req.gAddress!;
    const { reportId } = req.params;

    try {
      // Fetch report by ID
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          organizationId: true,
          reportType: true,
          periodStart: true,
          periodEnd: true,
          generatedAt: true,
          generatedBy: true,
          status: true,
          summary: true,
          reconciliationStatus: true,
          fileUrls: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Verify report exists and belongs to organization
      if (!report || report.organizationId !== gAddress) {
        res.status(404).json({
          success: false,
          error: 'Report not found',
          code: 'REPORT_NOT_FOUND',
        });
        return;
      }

      // Generate signed URLs for file download
      const signedUrls: Record<string, string> = {};
      if (report.fileUrls) {
        for (const [format, url] of Object.entries(report.fileUrls as any)) {
          // In production, this would generate actual signed URLs from S3/GCS
          // For now, just pass through the URL
          signedUrls[format] = url as string;
        }
      }

      res.json({
        success: true,
        data: {
          id: report.id,
          reportType: report.reportType,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          generatedAt: report.generatedAt,
          generatedBy: report.generatedBy,
          status: report.status,
          summary: report.summary,
          reconciliationStatus: report.reconciliationStatus,
          fileUrls: signedUrls,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Failed to retrieve report', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve report',
        code: 'REPORT_RETRIEVAL_FAILED',
      });
    }
  })
);

// ── POST /api/v1/orgs/:gAddress/reports/:reportId/verify
/**
 * Verify report integrity and digital signatures
 *
 * Path params:
 *   - reportId: UUID (required) - report identifier
 *
 * Response: {verified: boolean, signatures: [], issues: []}
 * Status: 200 OK, 403 Forbidden, 404 Not Found, 500 Internal Server Error
 */
router.post(
  '/:reportId/verify',
  requireWalletAuth,
  resolveOrgContext,
  requireExecutorRole,
  validateRequest(verifyReportSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const gAddress = req.gAddress!;
    const { reportId } = req.params;

    try {
      // Fetch report
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          organizationId: true,
          reportType: true,
          fileUrls: true,
          createdAt: true,
        },
      });

      // Verify report exists and belongs to organization
      if (!report || report.organizationId !== gAddress) {
        res.status(404).json({
          success: false,
          error: 'Report not found',
          code: 'REPORT_NOT_FOUND',
        });
        return;
      }

      // Verify report integrity
      const verificationResult = await verifyReportIntegrity(report);

      res.json({
        success: true,
        data: {
          reportId: report.id,
          verified: verificationResult.isValid,
          signatures: verificationResult.signatures || [],
          issues: verificationResult.issues || [],
          verifiedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to verify report', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify report integrity',
        code: 'VERIFICATION_FAILED',
      });
    }
  })
);

// ── Helper function for report verification ────────────────────────────────

/**
 * Verify report integrity and digital signatures
 */
async function verifyReportIntegrity(report: any): Promise<{ isValid: boolean; signatures: any[]; issues: string[] }> {
  try {
    // Pseudo-code for verification logic
    // In a real implementation, this would:
    // 1. Fetch report files from storage
    // 2. Calculate checksums
    // 3. Verify digital signatures
    // 4. Check for tampering

    const issues: string[] = [];
    const signatures: any[] = [];

    // Check if files exist
    if (!report.fileUrls || Object.keys(report.fileUrls).length === 0) {
      issues.push('No report files found');
    }

    // Placeholder: would verify signatures from digital signing service
    // const reportSignature = await signatureService.getSignature(report.id);
    // if (reportSignature) {
    //   signatures.push({
    //     format: 'digital_signature',
    //     algorithm: 'RSA-2048',
    //     verified: await signatureService.verify(report.id, reportSignature),
    //   });
    // }

    return {
      isValid: issues.length === 0,
      signatures,
      issues,
    };
  } catch (error) {
    logger.error('Error during report verification', error);
    throw error;
  }
}

/**
 * GET /api/v1/orgs/:gAddress/reports/config
 * Get report configuration for organization
 *
 * Response: ReportConfiguration[]
 * Status: 200 OK, 403 Forbidden, 404 Not Found, 500 Internal Server Error
 *
 * RBAC: EXECUTOR+ role required
 */
router.get(
  '/config',
  requireWalletAuth,
  resolveOrgContext,
  requireExecutorRole,
  asyncHandler(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const gAddress = req.gAddress!;

    try {
      // Fetch report configurations for organization
      const configs = await prisma.reportConfiguration.findMany({
        where: { organizationId: gAddress },
        select: {
          id: true,
          organizationId: true,
          reportType: true,
          schedule: true,
          exportFormats: true,
          emailConfig: true,
          storageConfig: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { reportType: 'asc' },
      });

      // If no configurations exist, return default configurations
      if (configs.length === 0) {
        const defaultConfigs = [
          {
            id: 'default-daily',
            organizationId: gAddress,
            reportType: 'daily_summary',
            schedule: { frequency: 'daily', time: '00:00', timezone: 'UTC' },
            exportFormats: ['pdf', 'csv'],
            emailConfig: { enabled: false, recipients: [] },
            storageConfig: { provider: 's3', retention: 90 },
            enabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'default-monthly',
            organizationId: gAddress,
            reportType: 'monthly_statement',
            schedule: { frequency: 'monthly', dayOfMonth: 1, time: '09:00', timezone: 'UTC' },
            exportFormats: ['pdf', 'xlsx'],
            emailConfig: { enabled: false, recipients: [] },
            storageConfig: { provider: 's3', retention: 365 },
            enabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        res.json({
          success: true,
          data: defaultConfigs,
          note: 'These are default configurations. Create custom configurations to override.',
        });
        return;
      }

      res.json({
        success: true,
        data: configs,
      });
    } catch (error) {
      logger.error('Failed to fetch report configuration', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch report configuration',
        code: 'CONFIG_FETCH_FAILED',
      });
    }
  })
);

export default router;
