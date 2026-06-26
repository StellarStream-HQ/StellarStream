import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { Parser } from 'json2csv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Query filters for audit logs
 */
export interface AuditLogFilters {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  userEmail?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  minExecutionTime?: number;
  maxExecutionTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * Export format options
 */
export type ExportFormat = 'csv' | 'json';

/**
 * Service for managing admin audit logs
 */
export class AdminAuditLogService {
  /**
   * Query audit logs with filters
   */
  async queryLogs(filters: AuditLogFilters) {
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
      limit = 100,
      offset = 0,
    } = filters;

    const where: Record<string, any> = {};

    // Date range filter
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    // User filters
    if (userId) where.userId = userId;
    if (userEmail) where.userEmail = { contains: userEmail };

    // HTTP method filter
    if (method) where.method = method;

    // Path filter (partial match)
    if (pathFilter) where.path = { contains: pathFilter };

    // Status code filter
    if (statusCode !== undefined) where.statusCode = statusCode;

    // Execution time range
    if (minExecutionTime !== undefined || maxExecutionTime !== undefined) {
      where.executionTimeMs = {};
      if (minExecutionTime !== undefined) where.executionTimeMs.gte = minExecutionTime;
      if (maxExecutionTime !== undefined) where.executionTimeMs.lte = maxExecutionTime;
    }

    try {
      const [logs, total] = await Promise.all([
        prisma.adminAuditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            timestamp: true,
            userId: true,
            userEmail: true,
            method: true,
            path: true,
            statusCode: true,
            executionTimeMs: true,
            clientIp: true,
            userAgent: true,
            changesSummary: true,
            error: true,
            createdAt: true,
          },
        }),
        prisma.adminAuditLog.count({ where }),
      ]);

      return {
        logs,
        total,
        hasMore: offset + limit < total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Failed to query audit logs', error);
      throw error;
    }
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserLogs(userId: string, limit: number = 50) {
    try {
      return await prisma.adminAuditLog.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to get user audit logs', error, { userId });
      throw error;
    }
  }

  /**
   * Get audit logs for a specific path/endpoint
   */
  async getPathLogs(pathPattern: string, limit: number = 50) {
    try {
      return await prisma.adminAuditLog.findMany({
        where: {
          path: {
            contains: pathPattern,
          },
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to get path audit logs', error, { pathPattern });
      throw error;
    }
  }

  /**
   * Get high-risk operations (errors, slow requests)
   */
  async getHighRiskLogs(filters?: {
    minExecutionTime?: number;
    statusCode?: number;
    limit?: number;
  }) {
    const { minExecutionTime = 5000, statusCode = 500, limit = 100 } = filters || {};

    try {
      return await prisma.adminAuditLog.findMany({
        where: {
          OR: [
            { executionTimeMs: { gte: minExecutionTime } },
            { statusCode: { gte: statusCode } },
            { error: { not: null } },
          ],
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error('Failed to get high-risk audit logs', error);
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  async getStatistics(filters?: AuditLogFilters) {
    try {
      const where: Record<string, any> = {};

      if (filters?.startDate || filters?.endDate) {
        where.timestamp = {};
        if (filters.startDate) where.timestamp.gte = filters.startDate;
        if (filters.endDate) where.timestamp.lte = filters.endDate;
      }

      const [totalRequests, errorRequests, avgExecutionTime, methodStats] =
        await Promise.all([
          prisma.adminAuditLog.count({ where }),
          prisma.adminAuditLog.count({
            where: { ...where, statusCode: { gte: 400 } },
          }),
          prisma.adminAuditLog.aggregate({
            where,
            _avg: { executionTimeMs: true },
          }),
          prisma.adminAuditLog.groupBy({
            by: ['method'],
            where,
            _count: true,
            orderBy: { _count: 'desc' },
          }),
        ]);

      return {
        totalRequests,
        errorRequests,
        successRequests: totalRequests - errorRequests,
        errorRate:
          totalRequests > 0 ? ((errorRequests / totalRequests) * 100).toFixed(2) : '0',
        avgExecutionTimeMs: (
          methodStats._avg.executionTimeMs || 0
        ).toFixed(2),
        methodStats: methodStats.map(stat => ({
          method: stat.method,
          count: stat._count,
        })),
      };
    } catch (error) {
      logger.error('Failed to get audit statistics', error);
      throw error;
    }
  }

  /**
   * Export audit logs to CSV
   */
  async exportToCSV(filters: AuditLogFilters, outputPath?: string): Promise<string> {
    try {
      const { logs } = await this.queryLogs({
        ...filters,
        limit: 10000, // Max 10k records for export
      });

      const fields = [
        'id',
        'timestamp',
        'userId',
        'userEmail',
        'method',
        'path',
        'statusCode',
        'executionTimeMs',
        'clientIp',
        'changesSummary',
        'error',
      ];

      const parser = new Parser({ fields });
      const csv = parser.parse(logs);

      const finalPath =
        outputPath ||
        path.join(
          process.cwd(),
          `audit-log-${Date.now()}.csv`
        );

      fs.writeFileSync(finalPath, csv);
      logger.info('Audit logs exported to CSV', { path: finalPath, records: logs.length });

      return finalPath;
    } catch (error) {
      logger.error('Failed to export audit logs to CSV', error);
      throw error;
    }
  }

  /**
   * Export audit logs to JSON
   */
  async exportToJSON(filters: AuditLogFilters, outputPath?: string): Promise<string> {
    try {
      const { logs } = await this.queryLogs({
        ...filters,
        limit: 10000, // Max 10k records for export
      });

      const finalPath =
        outputPath ||
        path.join(
          process.cwd(),
          `audit-log-${Date.now()}.json`
        );

      fs.writeFileSync(finalPath, JSON.stringify(logs, null, 2));
      logger.info('Audit logs exported to JSON', { path: finalPath, records: logs.length });

      return finalPath;
    } catch (error) {
      logger.error('Failed to export audit logs to JSON', error);
      throw error;
    }
  }

  /**
   * Delete old audit logs (retention policy)
   */
  async deleteOldLogs(beforeDate: Date): Promise<number> {
    try {
      const result = await prisma.adminAuditLog.deleteMany({
        where: {
          timestamp: {
            lt: beforeDate,
          },
        },
      });

      logger.info('Old audit logs deleted', { count: result.count, beforeDate });
      return result.count;
    } catch (error) {
      logger.error('Failed to delete old audit logs', error);
      throw error;
    }
  }

  /**
   * Archive audit logs by exporting and deleting old records
   */
  async archiveAndClean(
    beforeDate: Date,
    exportFormat: ExportFormat = 'json'
  ): Promise<{ archivedPath: string; deletedCount: number }> {
    try {
      // Export before deleting
      const archivedPath =
        exportFormat === 'csv'
          ? await this.exportToCSV({ endDate: beforeDate })
          : await this.exportToJSON({ endDate: beforeDate });

      // Delete old records
      const deletedCount = await this.deleteOldLogs(beforeDate);

      logger.info('Audit logs archived and cleaned', {
        archivedPath,
        deletedCount,
      });

      return { archivedPath, deletedCount };
    } catch (error) {
      logger.error('Failed to archive and clean audit logs', error);
      throw error;
    }
  }
}

export const adminAuditLogService = new AdminAuditLogService();
