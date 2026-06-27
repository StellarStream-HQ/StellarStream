import { Router, Request, Response } from 'express';
import { adminAuditLogService } from '../services/admin-audit-log.service.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * GET /api/audit/logs
 * Query audit logs with filters
 * Query params:
 *   - startDate: ISO date string
 *   - endDate: ISO date string
 *   - userId: string
 *   - userEmail: string
 *   - method: GET, POST, PUT, DELETE, PATCH
 *   - path: string (partial match)
 *   - statusCode: number
 *   - minExecutionTime: number (ms)
 *   - maxExecutionTime: number (ms)
 *   - limit: number (default 100, max 1000)
 *   - offset: number (default 0)
 */
router.get('/audit/logs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      userId,
      userEmail,
      method,
      path: pathFilter,
      statusCode,
      minExecutionTime,
      maxExecutionTime,
      limit = '100',
      offset = '0',
    } = req.query;

    const filters = {
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
      userId: userId ? String(userId) : undefined,
      userEmail: userEmail ? String(userEmail) : undefined,
      method: method ? String(method) : undefined,
      path: pathFilter ? String(pathFilter) : undefined,
      statusCode: statusCode ? parseInt(String(statusCode)) : undefined,
      minExecutionTime: minExecutionTime
        ? parseFloat(String(minExecutionTime))
        : undefined,
      maxExecutionTime: maxExecutionTime
        ? parseFloat(String(maxExecutionTime))
        : undefined,
      limit: Math.min(parseInt(String(limit)), 1000),
      offset: parseInt(String(offset)),
    };

    const result = await adminAuditLogService.queryLogs(filters);

    res.json({
      success: true,
      data: result.logs,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    logger.error('Failed to query audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to query audit logs',
    });
  }
});

/**
 * GET /api/audit/logs/user/:userId
 * Get audit logs for a specific user
 */
router.get('/audit/logs/user/:userId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { limit = '50' } = req.query;

    const logs = await adminAuditLogService.getUserLogs(
      userId,
      parseInt(String(limit))
    );

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error('Failed to get user audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user audit logs',
    });
  }
});

/**
 * GET /api/audit/logs/path
 * Get audit logs for a specific path pattern
 * Query params:
 *   - pattern: string (path pattern to match)
 *   - limit: number (default 50)
 */
router.get('/audit/logs/path', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { pattern, limit = '50' } = req.query;

    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Path pattern is required',
      });
    }

    const logs = await adminAuditLogService.getPathLogs(
      String(pattern),
      parseInt(String(limit))
    );

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error('Failed to get path audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get path audit logs',
    });
  }
});

/**
 * GET /api/audit/logs/high-risk
 * Get high-risk operations (errors, slow requests)
 */
router.get('/audit/logs/high-risk', requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      minExecutionTime = '5000',
      statusCode = '500',
      limit = '100',
    } = req.query;

    const logs = await adminAuditLogService.getHighRiskLogs({
      minExecutionTime: parseFloat(String(minExecutionTime)),
      statusCode: parseInt(String(statusCode)),
      limit: parseInt(String(limit)),
    });

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error('Failed to get high-risk audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get high-risk audit logs',
    });
  }
});

/**
 * GET /api/audit/statistics
 * Get audit log statistics
 */
router.get('/audit/statistics', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await adminAuditLogService.getStatistics({
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
    });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get audit statistics', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get audit statistics',
    });
  }
});

/**
 * POST /api/audit/export
 * Export audit logs to CSV or JSON
 * Body:
 *   - format: 'csv' or 'json'
 *   - filters: AuditLogFilters (optional)
 */
router.post('/audit/export', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { format = 'json', filters = {} } = req.body;

    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Format must be "csv" or "json"',
      });
    }

    const filePath =
      format === 'csv'
        ? await adminAuditLogService.exportToCSV(filters)
        : await adminAuditLogService.exportToJSON(filters);

    // For API response, return the file data or path
    const fileContent = require('fs').readFileSync(filePath, 'utf-8');

    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-log-${Date.now()}.${format === 'csv' ? 'csv' : 'json'}"`
    );

    res.send(fileContent);
  } catch (error) {
    logger.error('Failed to export audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export audit logs',
    });
  }
});

/**
 * POST /api/audit/archive
 * Archive old audit logs and clean database
 * Body:
 *   - beforeDate: ISO date string (required)
 *   - format: 'csv' or 'json' (default: 'json')
 */
router.post('/audit/archive', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { beforeDate, format = 'json' } = req.body;

    if (!beforeDate) {
      return res.status(400).json({
        success: false,
        error: 'beforeDate is required',
      });
    }

    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({
        success: false,
        error: 'Format must be "csv" or "json"',
      });
    }

    const result = await adminAuditLogService.archiveAndClean(
      new Date(beforeDate),
      format
    );

    res.json({
      success: true,
      data: {
        archivedPath: result.archivedPath,
        deletedCount: result.deletedCount,
        message: `${result.deletedCount} records archived and deleted`,
      },
    });
  } catch (error) {
    logger.error('Failed to archive audit logs', error);
    res.status(500).json({
      success: false,
      error: 'Failed to archive audit logs',
    });
  }
});

export default router;
