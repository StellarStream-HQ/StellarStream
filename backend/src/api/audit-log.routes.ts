import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'crypto';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { requireOrgContext } from '../middleware/requireOrgContext.js';
import { organizationAuditLogService } from '../services/organization-audit-log.service.js';
import { authorizationService } from '../services/authorization.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * GET /api/v1/orgs/:gAddress/audit-logs - Query audit logs
 * Query parameters validation
 */
const queryLogsSchema = z.object({
  actionType: z.string().optional(),
  actor: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().positive().max(100).default(50),
  offset: z.coerce.number().nonnegative().default(0),
});

/**
 * GET /api/v1/orgs/:gAddress/audit-logs/export - Export audit logs
 * Query parameters validation
 */
const exportLogsSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

// ── GET /api/v1/orgs/:gAddress/audit-logs
// Query organization's audit logs with filters (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/audit-logs',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Parse and validate query parameters
      const parsed = queryLogsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
        return;
      }

      const { actionType, actor, resourceType, resourceId, dateFrom, dateTo, limit, offset } = parsed.data;

      // Query audit logs
      const logs = await organizationAuditLogService.queryLogs(organizationId, {
        actionType,
        actor,
        resourceType,
        resourceId,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        limit,
        offset,
      });

      res.json({
        success: true,
        logs: logs.map((log) => ({
          id: log.id,
          actionType: log.actionType,
          actor: log.actor,
          resourceId: log.resourceId,
          resourceType: log.resourceType,
          changes: log.changes,
          entryHash: log.entryHash,
          parentHash: log.parentHash,
          verified: log.verified,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          createdAt: log.createdAt,
        })),
        count: logs.length,
        limit,
        offset,
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized audit log access', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to query audit logs', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to query audit logs',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/audit-logs/:entryId
// Get single audit log entry with hash chain details (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/audit-logs/:entryId',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const { entryId } = req.params;

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Get audit log entry
      const entry = await organizationAuditLogService.getEntry(entryId, organizationId);

      if (!entry) {
        res.status(404).json({
          success: false,
          error: 'Audit log entry not found',
        });
        return;
      }

      // Verify hash chain integrity
      const isValid = await organizationAuditLogService.verifyEntry(entry);

      res.json({
        success: true,
        entry: {
          id: entry.id,
          actionType: entry.actionType,
          actor: entry.actor,
          resourceId: entry.resourceId,
          resourceType: entry.resourceType,
          changes: entry.changes,
          entryHash: entry.entryHash,
          parentHash: entry.parentHash,
          verified: isValid,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          createdAt: entry.createdAt,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized audit entry access', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to get audit entry', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get audit entry',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/audit-logs/export
// Export audit logs as CSV or JSON with digital signature (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/audit-logs/export',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, req.walletAddress!);

      // Parse and validate query parameters
      const parsed = exportLogsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
        return;
      }

      const { format, dateFrom, dateTo } = parsed.data;

      // Get logs for export
      const logs = await organizationAuditLogService.queryLogs(organizationId, {
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        limit: 10000, // High limit for export
        offset: 0,
      });

      // Generate export
      const timestamp = new Date().toISOString();
      const filename = `audit-logs-${organizationId}-${timestamp.split('T')[0]}.${format}`;

      if (format === 'csv') {
        // Convert to CSV
        const headers = [
          'ID',
          'Action Type',
          'Actor',
          'Resource ID',
          'Resource Type',
          'Changes',
          'Entry Hash',
          'Parent Hash',
          'IP Address',
          'User Agent',
          'Created At',
        ];

        const rows = logs.map((log) => [
          log.id,
          log.actionType,
          log.actor,
          log.resourceId,
          log.resourceType,
          log.changes ? JSON.stringify(log.changes).replace(/"/g, '""') : '',
          log.entryHash || '',
          log.parentHash || '',
          log.ipAddress || '',
          log.userAgent || '',
          log.createdAt.toISOString(),
        ]);

        const csv =
          headers.join(',') +
          '\n' +
          rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

        // Add export metadata
        const metadata = [
          ['Export Metadata'],
          ['Organization ID', organizationId],
          ['Export Date', timestamp],
          ['Total Entries', logs.length.toString()],
          ['Format', 'CSV'],
          [],
        ];

        const metadataStr = metadata
          .map((row) => row.map((cell) => `"${cell}"`).join(','))
          .join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(metadataStr + '\n' + csv);
      } else {
        // JSON format with signature
        const exportData = {
          metadata: {
            organizationId,
            exportDate: timestamp,
            totalEntries: logs.length,
            format: 'JSON',
          },
          logs: logs.map((log) => ({
            id: log.id,
            actionType: log.actionType,
            actor: log.actor,
            resourceId: log.resourceId,
            resourceType: log.resourceType,
            changes: log.changes,
            entryHash: log.entryHash,
            parentHash: log.parentHash,
            verified: log.verified,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            createdAt: log.createdAt,
          })),
        };

        // Generate digital signature (SHA256 of JSON content)
        const content = JSON.stringify(exportData, null, 2);
        const signature = createHash('sha256')
          .update(content, 'utf8')
          .digest('hex');

        const response = {
          ...exportData,
          signature,
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(response);
      }
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized export attempt', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to export audit logs', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to export audit logs',
      });
    }
  }
);

export default router;
