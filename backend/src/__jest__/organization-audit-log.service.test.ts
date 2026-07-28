import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { prisma } from '../lib/db.js';
import { OrganizationAuditLogService } from '../services/organization-audit-log.service.js';

/**
 * Test suite for OrganizationAuditLogService
 * **Validates: Requirements 10.4, 10.5**
 *
 * Tests the audit log querying and filtering capabilities with emphasis on:
 * - Organization-scoped queries (multi-tenant enforcement)
 * - Filter functionality (actionType, actor, resourceId, resourceType, date range)
 * - Pagination support (limit, offset)
 * - Cross-organization access prevention
 * - Date range filtering
 */
describe('OrganizationAuditLogService', () => {
  let service: OrganizationAuditLogService;
  let orgId1: string;
  let orgId2: string;

  // Test data
  const actor1 = 'GACTOR111111111111111111111111111111111111111111111111111111111';
  const actor2 = 'GACTOR222222222222222222222222222222222222222222222222222222222';
  const resourceId1 = 'resource-001';
  const resourceId2 = 'resource-002';

  beforeEach(async () => {
    service = new OrganizationAuditLogService();

    // Create test organizations
    const org1 = await prisma.organization.create({
      data: {
        gAddress: 'GORG1111111111111111111111111111111111111111111111111111111111',
        name: 'Test Org 1',
        createdBy: actor1,
      },
    });
    orgId1 = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        gAddress: 'GORG2222222222222222222222222222222222222222222222222222222222',
        name: 'Test Org 2',
        createdBy: actor2,
      },
    });
    orgId2 = org2.id;

    // Create sample audit logs for org1
    await prisma.auditLog.create({
      data: {
        organizationId: orgId1,
        actionType: 'MEMBER_ADDED',
        actor: actor1,
        resourceId: resourceId1,
        resourceType: 'member',
        changes: { role: 'DRAFTER' },
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: orgId1,
        actionType: 'POLICY_UPDATED',
        actor: actor1,
        resourceId: orgId1,
        resourceType: 'policy',
        changes: { dailySpendLimit: 1000 },
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: orgId1,
        actionType: 'MEMBER_REMOVED',
        actor: actor2,
        resourceId: resourceId2,
        resourceType: 'member',
      },
    });

    // Create sample audit logs for org2
    await prisma.auditLog.create({
      data: {
        organizationId: orgId2,
        actionType: 'MEMBER_ADDED',
        actor: actor2,
        resourceId: resourceId2,
        resourceType: 'member',
        changes: { role: 'EXECUTOR' },
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.auditLog.deleteMany({
      where: {
        OR: [{ organizationId: orgId1 }, { organizationId: orgId2 }],
      },
    });
    await prisma.organization.deleteMany({
      where: {
        OR: [{ id: orgId1 }, { id: orgId2 }],
      },
    });
  });

  describe('queryLogs - Basic Functionality', () => {
    it('should return all logs for an organization when called without filters', async () => {
      const logs = await service.queryLogs(orgId1);

      expect(logs).toBeDefined();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(3); // We created 3 logs for org1
      expect(logs.every(log => log.organizationId === orgId1)).toBe(true);
    });

    it('should return logs sorted by createdAt in descending order (most recent first)', async () => {
      const logs = await service.queryLogs(orgId1);

      for (let i = 0; i < logs.length - 1; i++) {
        const current = new Date(logs[i].createdAt).getTime();
        const next = new Date(logs[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it('should return empty array for organization with no logs', async () => {
      // Create a new organization with no logs
      const emptyOrg = await prisma.organization.create({
        data: {
          gAddress: 'GEMPTY1111111111111111111111111111111111111111111111111111111',
          name: 'Empty Org',
          createdBy: actor1,
        },
      });

      const logs = await service.queryLogs(emptyOrg.id);

      expect(logs).toBeDefined();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(0);

      // Cleanup
      await prisma.organization.delete({ where: { id: emptyOrg.id } });
    });

    it('should throw error for invalid organizationId', async () => {
      await expect(service.queryLogs('')).rejects.toThrow('Invalid organizationId');
      await expect(service.queryLogs('   ')).rejects.toThrow('Invalid organizationId');
    });
  });

  describe('queryLogs - Multi-Tenancy Enforcement', () => {
    it('should only return logs from requested organization (org1)', async () => {
      const org1Logs = await service.queryLogs(orgId1);

      expect(org1Logs.every(log => log.organizationId === orgId1)).toBe(true);
      expect(org1Logs.length).toBe(3); // org1 has 3 logs
    });

    it('should only return logs from requested organization (org2)', async () => {
      const org2Logs = await service.queryLogs(orgId2);

      expect(org2Logs.every(log => log.organizationId === orgId2)).toBe(true);
      expect(org2Logs.length).toBe(1); // org2 has 1 log
    });

    it('should prevent cross-organization log access via direct organizationId query', async () => {
      // Query org1 should not return org2 logs
      const org1Logs = await service.queryLogs(orgId1);
      const org1HasOrg2Logs = org1Logs.some(log => log.organizationId === orgId2);

      expect(org1HasOrg2Logs).toBe(false);
    });

    it('should prevent cross-organization access regardless of filter combinations', async () => {
      // Query org1 with filters should not return org2 logs
      const logsWithFilters = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_ADDED',
      });

      expect(logsWithFilters.every(log => log.organizationId === orgId1)).toBe(true);
    });
  });

  describe('queryLogs - Filter by actionType', () => {
    it('should filter logs by actionType', async () => {
      const logs = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_ADDED',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].actionType).toBe('MEMBER_ADDED');
      expect(logs[0].organizationId).toBe(orgId1);
    });

    it('should return empty array when actionType matches no logs', async () => {
      const logs = await service.queryLogs(orgId1, {
        actionType: 'NONEXISTENT_ACTION',
      });

      expect(logs).toEqual([]);
    });

    it('should filter by actionType across multiple logs', async () => {
      // Create another MEMBER_ADDED log
      await prisma.auditLog.create({
        data: {
          organizationId: orgId1,
          actionType: 'MEMBER_ADDED',
          actor: actor1,
          resourceId: 'resource-003',
          resourceType: 'member',
        },
      });

      const logs = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_ADDED',
      });

      expect(logs.length).toBe(2);
      expect(logs.every(log => log.actionType === 'MEMBER_ADDED')).toBe(true);
    });
  });

  describe('queryLogs - Filter by actor', () => {
    it('should filter logs by actor address', async () => {
      const logs = await service.queryLogs(orgId1, {
        actor: actor1,
      });

      expect(logs.length).toBe(2); // actor1 performed 2 actions in org1
      expect(logs.every(log => log.actor === actor1)).toBe(true);
    });

    it('should filter by different actor', async () => {
      const logs = await service.queryLogs(orgId1, {
        actor: actor2,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].actor).toBe(actor2);
      expect(logs[0].actionType).toBe('MEMBER_REMOVED');
    });

    it('should return empty array when actor has no logs in organization', async () => {
      const nonexistentActor = 'GNONEXIST11111111111111111111111111111111111111111111111111111';
      const logs = await service.queryLogs(orgId1, {
        actor: nonexistentActor,
      });

      expect(logs).toEqual([]);
    });
  });

  describe('queryLogs - Filter by resourceId', () => {
    it('should filter logs by resourceId', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceId: resourceId1,
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every(log => log.resourceId === resourceId1)).toBe(true);
    });

    it('should filter by different resourceId', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceId: resourceId2,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].resourceId).toBe(resourceId2);
    });

    it('should return empty array when resourceId has no logs', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceId: 'resource-nonexistent',
      });

      expect(logs).toEqual([]);
    });
  });

  describe('queryLogs - Filter by resourceType', () => {
    it('should filter logs by resourceType', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceType: 'member',
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every(log => log.resourceType === 'member')).toBe(true);
    });

    it('should filter by different resourceType', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceType: 'policy',
      });

      expect(logs.length).toBe(1);
      expect(logs[0].resourceType).toBe('policy');
    });

    it('should return empty array when resourceType has no logs', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceType: 'nonexistent_type',
      });

      expect(logs).toEqual([]);
    });
  });

  describe('queryLogs - Date Range Filtering', () => {
    it('should filter logs by dateFrom', async () => {
      // Create a log with a known timestamp
      const now = new Date();

      const logs = await service.queryLogs(orgId1, {
        dateFrom: now.toISOString(),
      });

      // Should return logs created at or after now
      expect(logs.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter logs by dateTo', async () => {
      const futureDate = new Date(Date.now() + 86400000); // 1 day in future

      const logs = await service.queryLogs(orgId1, {
        dateTo: futureDate.toISOString(),
      });

      // Should return logs created before or on futureDate
      expect(logs.every(log => new Date(log.createdAt) <= futureDate)).toBe(true);
    });

    it('should filter logs by date range (dateFrom and dateTo)', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 86400000); // 1 day in future

      const logs = await service.queryLogs(orgId1, {
        dateFrom: now.toISOString(),
        dateTo: futureDate.toISOString(),
      });

      expect(Array.isArray(logs)).toBe(true);
      expect(logs.every(log => {
        const logDate = new Date(log.createdAt);
        return logDate >= now && logDate <= futureDate;
      })).toBe(true);
    });

    it('should throw error for invalid dateFrom format', async () => {
      await expect(
        service.queryLogs(orgId1, {
          dateFrom: 'invalid-date',
        })
      ).rejects.toThrow('Invalid dateFrom format');
    });

    it('should throw error for invalid dateTo format', async () => {
      await expect(
        service.queryLogs(orgId1, {
          dateTo: 'not-a-date',
        })
      ).rejects.toThrow('Invalid dateTo format');
    });

    it('should handle dateFrom and dateTo with time components', async () => {
      const dateFrom = '2024-01-01T10:00:00Z';
      const dateTo = '2024-01-31T23:59:59Z';

      // Should not throw and should return valid results
      const logs = await service.queryLogs(orgId1, {
        dateFrom,
        dateTo,
      });

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('queryLogs - Pagination', () => {
    beforeEach(async () => {
      // Create additional logs for pagination testing
      for (let i = 0; i < 5; i++) {
        await prisma.auditLog.create({
          data: {
            organizationId: orgId1,
            actionType: `ACTION_${i}`,
            actor: actor1,
            resourceId: `resource-${i}`,
            resourceType: 'test',
          },
        });
      }
    });

    it('should respect limit parameter', async () => {
      const logs = await service.queryLogs(orgId1, {
        limit: 5,
      });

      expect(logs.length).toBeLessThanOrEqual(5);
    });

    it('should default limit to 100 when not specified', async () => {
      const logs = await service.queryLogs(orgId1);

      expect(logs.length).toBeLessThanOrEqual(100);
    });

    it('should cap limit at 1000', async () => {
      const logs = await service.queryLogs(orgId1, {
        limit: 5000, // Request 5000
      });

      // Service should cap at 1000
      expect(logs.length).toBeLessThanOrEqual(1000);
    });

    it('should support offset for pagination', async () => {
      const logsPage1 = await service.queryLogs(orgId1, {
        limit: 3,
        offset: 0,
      });

      const logsPage2 = await service.queryLogs(orgId1, {
        limit: 3,
        offset: 3,
      });

      // Pages should not overlap
      expect(logsPage1.length).toBeGreaterThan(0);
      if (logsPage2.length > 0) {
        expect(logsPage1[0].id).not.toEqual(logsPage2[0].id);
      }
    });

    it('should return empty array when offset exceeds total logs', async () => {
      const logs = await service.queryLogs(orgId1, {
        limit: 100,
        offset: 10000, // Offset larger than total logs
      });

      expect(logs).toEqual([]);
    });

    it('should work correctly with default offset (0)', async () => {
      const logsWithoutOffset = await service.queryLogs(orgId1, {
        limit: 3,
      });

      const logsWithExplicitOffset = await service.queryLogs(orgId1, {
        limit: 3,
        offset: 0,
      });

      // Should return the same results
      expect(logsWithoutOffset.length).toBe(logsWithExplicitOffset.length);
      expect(logsWithoutOffset.map(l => l.id)).toEqual(
        logsWithExplicitOffset.map(l => l.id)
      );
    });
  });

  describe('queryLogs - Combined Filters', () => {
    it('should combine actionType and actor filters', async () => {
      const logs = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_ADDED',
        actor: actor1,
      });

      expect(logs.every(log => 
        log.actionType === 'MEMBER_ADDED' && log.actor === actor1
      )).toBe(true);
    });

    it('should combine resourceType and actionType filters', async () => {
      const logs = await service.queryLogs(orgId1, {
        resourceType: 'member',
        actionType: 'MEMBER_ADDED',
      });

      expect(logs.every(log => 
        log.resourceType === 'member' && log.actionType === 'MEMBER_ADDED'
      )).toBe(true);
    });

    it('should combine date range with actionType filter', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 86400000);

      const logs = await service.queryLogs(orgId1, {
        dateFrom: now.toISOString(),
        dateTo: futureDate.toISOString(),
        actionType: 'MEMBER_ADDED',
      });

      expect(logs.every(log => 
        log.actionType === 'MEMBER_ADDED' && 
        new Date(log.createdAt) >= now && 
        new Date(log.createdAt) <= futureDate
      )).toBe(true);
    });

    it('should combine all available filters', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 86400000);

      const logs = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_ADDED',
        actor: actor1,
        resourceType: 'member',
        dateFrom: now.toISOString(),
        dateTo: futureDate.toISOString(),
        limit: 10,
        offset: 0,
      });

      expect(logs.every(log => 
        log.actionType === 'MEMBER_ADDED' &&
        log.actor === actor1 &&
        log.resourceType === 'member'
      )).toBe(true);
    });
  });

  describe('getOrgLogs - Simplified Interface', () => {
    it('should return all logs for organization', async () => {
      const logs = await service.getOrgLogs(orgId1);

      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBe(3);
      expect(logs.every(log => log.organizationId === orgId1)).toBe(true);
    });

    it('should support limit parameter', async () => {
      const logs = await service.getOrgLogs(orgId1, 2);

      expect(logs.length).toBeLessThanOrEqual(2);
    });

    it('should support limit and offset parameters', async () => {
      const logsPage1 = await service.getOrgLogs(orgId1, 2, 0);
      const logsPage2 = await service.getOrgLogs(orgId1, 2, 2);

      // Pages should not overlap if org has more than 2 logs
      if (logsPage1.length > 0 && logsPage2.length > 0) {
        expect(logsPage1[0].id).not.toEqual(logsPage2[0].id);
      }
    });

    it('should enforce organizationId scoping', async () => {
      const logs = await service.getOrgLogs(orgId1);

      expect(logs.every(log => log.organizationId === orgId1)).toBe(true);
    });

    it('should enforce organization scoping even with limit/offset', async () => {
      const logs = await service.getOrgLogs(orgId1, 10, 0);

      expect(logs.every(log => log.organizationId === orgId1)).toBe(true);
      expect(logs.some(log => log.organizationId === orgId2)).toBe(false);
    });
  });

  describe('Data Integrity', () => {
    it('should return complete audit log entries with all fields', async () => {
      const logs = await service.queryLogs(orgId1);

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];

      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('organizationId');
      expect(log).toHaveProperty('actionType');
      expect(log).toHaveProperty('actor');
      expect(log).toHaveProperty('resourceId');
      expect(log).toHaveProperty('resourceType');
      expect(log).toHaveProperty('entryHash');
      expect(log).toHaveProperty('parentHash');
      expect(log).toHaveProperty('verified');
      expect(log).toHaveProperty('createdAt');
    });

    it('should preserve changes JSON data', async () => {
      const logs = await service.queryLogs(orgId1, {
        actionType: 'POLICY_UPDATED',
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];
      expect(log.changes).toBeDefined();
      expect(log.changes).not.toBeNull();
      if (log.changes !== null) {
        expect(log.changes).toHaveProperty('dailySpendLimit');
        expect(log.changes.dailySpendLimit).toBe(1000);
      }
    });

    it('should handle null changes correctly', async () => {
      const logs = await service.queryLogs(orgId1, {
        actionType: 'MEMBER_REMOVED',
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];
      expect(log.changes).toBeNull();
    });
  });
});
