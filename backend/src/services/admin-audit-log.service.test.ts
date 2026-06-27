import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminAuditLogService } from './admin-audit-log.service.js';
import { prisma } from '../lib/db.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock Prisma
vi.mock('../lib/db.js', () => ({
  prisma: {
    adminAuditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock fs
vi.mock('fs');

describe('AdminAuditLogService', () => {
  let service: AdminAuditLogService;

  beforeEach(() => {
    service = new AdminAuditLogService();
    vi.clearAllMocks();
  });

  describe('queryLogs', () => {
    it('should query logs with basic filters', async () => {
      const mockLogs = [
        {
          id: '1',
          timestamp: new Date(),
          userId: 'user-1',
          userEmail: 'user@example.com',
          method: 'POST',
          path: '/admin/users',
          statusCode: 201,
          executionTimeMs: 100,
          clientIp: '192.168.1.1',
          changesSummary: 'User created',
          error: null,
          createdAt: new Date(),
        },
      ];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);
      (prisma.adminAuditLog.count as any).mockResolvedValueOnce(1);

      const result = await service.queryLogs({
        method: 'POST',
        limit: 50,
        offset: 0,
      });

      expect(result.logs).toEqual(mockLogs);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should filter logs by date range', async () => {
      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce([]);
      (prisma.adminAuditLog.count as any).mockResolvedValueOnce(0);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await service.queryLogs({ startDate, endDate });

      const whereArg = (prisma.adminAuditLog.findMany as any).mock.calls[0][0].where;
      expect(whereArg.timestamp).toEqual({
        gte: startDate,
        lte: endDate,
      });
    });

    it('should filter logs by user', async () => {
      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce([]);
      (prisma.adminAuditLog.count as any).mockResolvedValueOnce(0);

      await service.queryLogs({ userId: 'user-123' });

      const whereArg = (prisma.adminAuditLog.findMany as any).mock.calls[0][0].where;
      expect(whereArg.userId).toBe('user-123');
    });

    it('should filter logs by status code range', async () => {
      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce([]);
      (prisma.adminAuditLog.count as any).mockResolvedValueOnce(0);

      await service.queryLogs({
        minExecutionTime: 100,
        maxExecutionTime: 5000,
      });

      const whereArg = (prisma.adminAuditLog.findMany as any).mock.calls[0][0].where;
      expect(whereArg.executionTimeMs).toEqual({
        gte: 100,
        lte: 5000,
      });
    });

    it('should handle pagination', async () => {
      const mockLogs = Array(50).fill({
        id: '1',
        timestamp: new Date(),
        method: 'GET',
      });

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);
      (prisma.adminAuditLog.count as any).mockResolvedValueOnce(150);

      const result = await service.queryLogs({ limit: 50, offset: 0 });

      expect(result.logs.length).toBe(50);
      expect(result.total).toBe(150);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getUserLogs', () => {
    it('should get logs for specific user', async () => {
      const mockLogs = [{ id: '1', userId: 'user-123' }];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);

      const result = await service.getUserLogs('user-123');

      expect(result).toEqual(mockLogs);
      expect((prisma.adminAuditLog.findMany as any).mock.calls[0][0].where).toEqual({
        userId: 'user-123',
      });
    });
  });

  describe('getPathLogs', () => {
    it('should get logs for specific path pattern', async () => {
      const mockLogs = [
        { id: '1', path: '/admin/users/123' },
        { id: '2', path: '/admin/users/456' },
      ];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);

      const result = await service.getPathLogs('/admin/users');

      expect(result).toEqual(mockLogs);
      expect((prisma.adminAuditLog.findMany as any).mock.calls[0][0].where).toEqual({
        path: { contains: '/admin/users' },
      });
    });
  });

  describe('getHighRiskLogs', () => {
    it('should get high-risk operations', async () => {
      const mockLogs = [
        { id: '1', statusCode: 500, executionTimeMs: 6000 },
        { id: '2', statusCode: 503, error: 'Database timeout' },
      ];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);

      const result = await service.getHighRiskLogs();

      expect(result).toEqual(mockLogs);
    });

    it('should respect custom thresholds', async () => {
      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce([]);

      await service.getHighRiskLogs({
        minExecutionTime: 10000,
        statusCode: 400,
        limit: 200,
      });

      const whereArg = (prisma.adminAuditLog.findMany as any).mock.calls[0][0].where;
      expect(whereArg.OR).toBeDefined();
      expect(whereArg.OR[0].executionTimeMs.gte).toBe(10000);
      expect(whereArg.OR[1].statusCode.gte).toBe(400);
    });
  });

  describe('getStatistics', () => {
    it('should return audit statistics', async () => {
      (prisma.adminAuditLog.count as any)
        .mockResolvedValueOnce(1000) // total
        .mockResolvedValueOnce(50); // errors

      (prisma.adminAuditLog.aggregate as any).mockResolvedValueOnce({
        _avg: { executionTimeMs: 250 },
      });

      (prisma.adminAuditLog.groupBy as any).mockResolvedValueOnce([
        { method: 'GET', _count: 600 },
        { method: 'POST', _count: 300 },
        { method: 'PUT', _count: 100 },
      ]);

      const result = await service.getStatistics();

      expect(result.totalRequests).toBe(1000);
      expect(result.errorRequests).toBe(50);
      expect(result.successRequests).toBe(950);
      expect(result.errorRate).toBe('5.00');
      expect(result.methodStats.length).toBe(3);
    });
  });

  describe('exportToCSV', () => {
    it('should export logs to CSV', async () => {
      const mockLogs = [
        {
          id: '1',
          timestamp: new Date('2024-01-15'),
          userId: 'user-1',
          method: 'POST',
          path: '/admin/users',
          statusCode: 201,
          executionTimeMs: 100,
        },
      ];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);

      const result = await service.exportToCSV({}, '/tmp/test.csv');

      expect(result).toContain('test.csv');
      expect((fs.writeFileSync as any)).toHaveBeenCalled();
    });
  });

  describe('exportToJSON', () => {
    it('should export logs to JSON', async () => {
      const mockLogs = [
        {
          id: '1',
          timestamp: new Date('2024-01-15'),
          userId: 'user-1',
          method: 'POST',
        },
      ];

      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce(mockLogs);

      const result = await service.exportToJSON({}, '/tmp/test.json');

      expect(result).toContain('test.json');
      expect((fs.writeFileSync as any)).toHaveBeenCalled();
    });
  });

  describe('deleteOldLogs', () => {
    it('should delete logs older than specified date', async () => {
      (prisma.adminAuditLog.deleteMany as any).mockResolvedValueOnce({ count: 500 });

      const beforeDate = new Date('2024-01-01');
      const result = await service.deleteOldLogs(beforeDate);

      expect(result).toBe(500);
      expect((prisma.adminAuditLog.deleteMany as any).mock.calls[0][0].where).toEqual({
        timestamp: { lt: beforeDate },
      });
    });
  });

  describe('archiveAndClean', () => {
    it('should archive and delete old logs', async () => {
      (prisma.adminAuditLog.findMany as any).mockResolvedValueOnce([]);
      (prisma.adminAuditLog.deleteMany as any).mockResolvedValueOnce({ count: 1000 });

      const beforeDate = new Date('2024-01-01');
      const result = await service.archiveAndClean(beforeDate, 'json');

      expect(result.deletedCount).toBe(1000);
      expect(result.archivedPath).toBeTruthy();
    });
  });
});
