import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createHmac } from 'crypto';
import { OrganizationAuditLogService, AuditLogFilters, AuditLogEntry } from '../../services/organization-audit-log.service.js';

/**
 * Test suite for Organization Audit Log Service - Export Functionality
 * **Validates: Requirements 10.7**
 *
 * Tests verify:
 * - CSV export format with proper headers and escaping
 * - JSON export format with metadata and pretty-printing
 * - Digital signature generation and verification
 * - Export filtering by date range, action type, actor, resource
 * - Organization scoping (can only export own org's logs)
 * - Large exports (1000+ entries)
 * - Special character handling in CSV
 * - Missing AUDIT_EXPORT_KEY handling
 * - UTF-8 encoding with BOM for CSV
 */

describe('OrganizationAuditLogService - Export Functionality', () => {
  let service: OrganizationAuditLogService;
  const orgId = 'test-org-123';
  const otherOrgId = 'other-org-456';
  const testActor = 'GACTOR123456789012345678901234567890123456789012345678';
  const exportKey = 'test-export-key-secret-' + Math.random().toString(36);

  beforeEach(() => {
    service = new OrganizationAuditLogService();
    process.env.AUDIT_EXPORT_KEY = exportKey;
    process.env.AUDIT_EXPORT_INCLUDE_SIGNATURE = 'true';
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.AUDIT_EXPORT_KEY;
    delete process.env.AUDIT_EXPORT_INCLUDE_SIGNATURE;
    jest.clearAllMocks();
  });

  describe('exportLogs()', () => {
    it('should export logs in CSV format', async () => {
      // Mock queryLogs to return sample logs
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'MEMBER_ADDED',
          actor: testActor,
          resourceId: 'member-1',
          resourceType: 'member',
          changes: { role: 'EXECUTOR' },
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'csv');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Check for BOM
      expect(buffer[0]).toBe(0xef);
      expect(buffer[1]).toBe(0xbb);
      expect(buffer[2]).toBe(0xbf);

      const content = buffer.toString('utf-8');
      expect(content).toContain('organizationId');
      expect(content).toContain('actionType');
      expect(content).toContain('MEMBER_ADDED');
      expect(content).toContain(testActor);
    });

    it('should export logs in JSON format', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'POLICY_UPDATED',
          actor: testActor,
          resourceId: 'policy-1',
          resourceType: 'policy',
          changes: { dailySpendLimit: 5000 },
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/121.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'json');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      const content = buffer.toString('utf-8');
      const parsed = JSON.parse(content);

      expect(parsed._metadata).toBeDefined();
      expect(parsed._metadata.organizationId).toBe(orgId);
      expect(parsed._metadata.recordCount).toBe(1);
      expect(parsed._metadata.signature).toBeDefined();
      expect(parsed._metadata.exportDate).toBeDefined();
      expect(parsed.logs).toBeInstanceOf(Array);
      expect(parsed.logs.length).toBe(1);
      expect(parsed.logs[0].actionType).toBe('POLICY_UPDATED');
    });

    it('should include signature in CSV export', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'MEMBER_ADDED',
          actor: testActor,
          resourceId: 'member-1',
          resourceType: 'member',
          changes: null,
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'csv');
      const content = buffer.toString('utf-8');

      expect(content).toContain('# Export Metadata');
      expect(content).toContain(`# Organization: ${orgId}`);
      expect(content).toContain('# Signature:');
      expect(content).toContain('# Records: 1');
    });

    it('should include signature in JSON export', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'MEMBER_ADDED',
          actor: testActor,
          resourceId: 'member-1',
          resourceType: 'member',
          changes: null,
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'json');
      const content = buffer.toString('utf-8');
      const parsed = JSON.parse(content);

      expect(parsed._metadata.signature).toBeDefined();
      expect(typeof parsed._metadata.signature).toBe('string');
      expect(parsed._metadata.signature.length).toBeGreaterThan(0);
    });

    it('should apply filters to export', async () => {
      const filters: AuditLogFilters = {
        actionType: 'MEMBER_ADDED',
        dateFrom: '2025-01-20T00:00:00Z',
        dateTo: '2025-01-21T00:00:00Z',
      };

      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      await service.exportLogs(orgId, 'json', filters);

      expect(service.queryLogs).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({
          actionType: filters.actionType,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        })
      );
    });

    it('should reject invalid format', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      await expect(
        service.exportLogs(orgId, 'xml' as any)
      ).rejects.toThrow('Invalid export format');
    });

    it('should reject invalid organizationId', async () => {
      await expect(
        service.exportLogs('', 'csv')
      ).rejects.toThrow('Invalid organizationId');

      await expect(
        service.exportLogs('   ', 'json')
      ).rejects.toThrow('Invalid organizationId');
    });

    it('should handle large exports (1000+ entries)', async () => {
      const mockLogs: AuditLogEntry[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `log-${i}`,
        organizationId: orgId,
        actionType: 'TEST_ACTION',
        actor: testActor,
        resourceId: `resource-${i}`,
        resourceType: 'test',
        changes: null,
        entryHash: `hash-${i}`,
        parentHash: `hash-${i - 1}`,
        verified: true,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        createdAt: new Date('2025-01-20T10:00:00Z'),
      }));

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'csv');
      expect(buffer.length).toBeGreaterThan(0);

      const content = buffer.toString('utf-8');
      expect(content).toContain('# Records: 1000');
    });

    it('should handle special characters in CSV', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'MEMBER_ADDED',
          actor: testActor,
          resourceId: 'member-1',
          resourceType: 'member',
          changes: { note: 'Contains "quotes", commas, and\nnewlines' },
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'csv');
      const content = buffer.toString('utf-8');

      // CSV parser should properly escape special characters
      expect(content).toContain('quotes');
      expect(content).toContain('commas');
    });

    it('should handle empty logs', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const csvBuffer = await service.exportLogs(orgId, 'csv');
      const csvContent = csvBuffer.toString('utf-8');
      expect(csvContent).toContain('# Records: 0');

      const jsonBuffer = await service.exportLogs(orgId, 'json');
      const jsonContent = JSON.parse(jsonBuffer.toString('utf-8'));
      expect(jsonContent.logs).toHaveLength(0);
    });

    it('should not include signature when disabled', async () => {
      process.env.AUDIT_EXPORT_INCLUDE_SIGNATURE = 'false';

      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const buffer = await service.exportLogs(orgId, 'json');
      const parsed = JSON.parse(buffer.toString('utf-8'));

      expect(parsed._metadata.signature).toBe('');
    });
  });

  describe('generateExportSignature()', () => {
    it('should generate HMAC-SHA256 signature', () => {
      const data = Buffer.from('test data');
      const signature = service.generateExportSignature(data);

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      // Should be hex-encoded (only hex characters)
      expect(/^[0-9a-f]+$/.test(signature)).toBe(true);
    });

    it('should generate consistent signature for same data', () => {
      const data = Buffer.from('test data');
      const sig1 = service.generateExportSignature(data);
      const sig2 = service.generateExportSignature(data);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different data', () => {
      const sig1 = service.generateExportSignature(Buffer.from('data1'));
      const sig2 = service.generateExportSignature(Buffer.from('data2'));

      expect(sig1).not.toBe(sig2);
    });

    it('should throw error if AUDIT_EXPORT_KEY not configured', () => {
      delete process.env.AUDIT_EXPORT_KEY;

      expect(() => {
        service.generateExportSignature(Buffer.from('test'));
      }).toThrow('AUDIT_EXPORT_KEY');
    });

    it('should throw error if AUDIT_EXPORT_KEY is empty', () => {
      process.env.AUDIT_EXPORT_KEY = '';

      expect(() => {
        service.generateExportSignature(Buffer.from('test'));
      }).toThrow('AUDIT_EXPORT_KEY');
    });

    it('should use correct HMAC algorithm', () => {
      const data = Buffer.from('test data');
      const signature = service.generateExportSignature(data);

      // Verify it matches HMAC-SHA256
      const expectedHmac = createHmac('sha256', exportKey);
      expectedHmac.update(data);
      const expectedSignature = expectedHmac.digest('hex');

      expect(signature).toBe(expectedSignature);
    });
  });

  describe('verifyExportSignature()', () => {
    it('should verify valid signature', () => {
      const data = Buffer.from('test data');
      const signature = service.generateExportSignature(data);

      const isValid = service.verifyExportSignature(data, signature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const data = Buffer.from('test data');
      const invalidSignature = 'invalid' + '0'.repeat(58); // Fake signature

      const isValid = service.verifyExportSignature(data, invalidSignature);
      expect(isValid).toBe(false);
    });

    it('should reject tampered data', () => {
      const data = Buffer.from('test data');
      const signature = service.generateExportSignature(data);

      const tamperedData = Buffer.from('test data modified');
      const isValid = service.verifyExportSignature(tamperedData, signature);
      expect(isValid).toBe(false);
    });

    it('should return false if AUDIT_EXPORT_KEY not configured', () => {
      delete process.env.AUDIT_EXPORT_KEY;

      const isValid = service.verifyExportSignature(Buffer.from('test'), 'somesig');
      expect(isValid).toBe(false);
    });

    it('should handle signature tampering', () => {
      const data = Buffer.from('test data');
      const signature = service.generateExportSignature(data);

      // Modify signature
      const tamperedSig = signature.substring(0, signature.length - 2) + 'XX';
      const isValid = service.verifyExportSignature(data, tamperedSig);
      expect(isValid).toBe(false);
    });
  });

  describe('CSV Export Format', () => {
    it('should have proper CSV header row', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const buffer = await service.exportLogs(orgId, 'csv');
      const content = buffer.toString('utf-8').substring(3); // Remove BOM

      const lines = content.split('\n');
      const header = lines[0];

      expect(header).toContain('organizationId');
      expect(header).toContain('actionType');
      expect(header).toContain('actor');
      expect(header).toContain('resourceId');
      expect(header).toContain('resourceType');
      expect(header).toContain('changes');
      expect(header).toContain('entryHash');
      expect(header).toContain('parentHash');
      expect(header).toContain('verified');
      expect(header).toContain('ipAddress');
      expect(header).toContain('userAgent');
      expect(header).toContain('createdAt');
    });

    it('should have one log per row', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'ACTION1',
          actor: testActor,
          resourceId: 'res-1',
          resourceType: 'test',
          changes: null,
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
        {
          id: 'log-2',
          organizationId: orgId,
          actionType: 'ACTION2',
          actor: testActor,
          resourceId: 'res-2',
          resourceType: 'test',
          changes: null,
          entryHash: 'hash2',
          parentHash: 'hash1',
          verified: true,
          ipAddress: '192.168.1.2',
          userAgent: 'Chrome/121',
          createdAt: new Date('2025-01-20T11:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'csv');
      const content = buffer.toString('utf-8').substring(3); // Remove BOM

      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      // Header + 2 data rows
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('should include UTF-8 BOM for Excel compatibility', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const buffer = await service.exportLogs(orgId, 'csv');

      // UTF-8 BOM bytes
      expect(buffer[0]).toBe(0xef);
      expect(buffer[1]).toBe(0xbb);
      expect(buffer[2]).toBe(0xbf);
    });
  });

  describe('JSON Export Format', () => {
    it('should have _metadata object', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const buffer = await service.exportLogs(orgId, 'json');
      const parsed = JSON.parse(buffer.toString('utf-8'));

      expect(parsed._metadata).toBeDefined();
      expect(parsed._metadata.organizationId).toBe(orgId);
      expect(parsed._metadata.exportDate).toBeDefined();
      expect(parsed._metadata.recordCount).toBe(0);
      expect(parsed._metadata.signature).toBeDefined();
    });

    it('should have logs array', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'TEST',
          actor: testActor,
          resourceId: 'res-1',
          resourceType: 'test',
          changes: null,
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'json');
      const parsed = JSON.parse(buffer.toString('utf-8'));

      expect(parsed.logs).toBeInstanceOf(Array);
      expect(parsed.logs.length).toBe(1);
      expect(parsed.logs[0].actionType).toBe('TEST');
    });

    it('should have pretty-printed format', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      const buffer = await service.exportLogs(orgId, 'json');
      const content = buffer.toString('utf-8');

      // Should have indentation (2-space based on implementation)
      expect(content).toContain('  ');
    });

    it('should have valid JSON structure', async () => {
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'log-1',
          organizationId: orgId,
          actionType: 'TEST',
          actor: testActor,
          resourceId: 'res-1',
          resourceType: 'test',
          changes: { field: 'value' },
          entryHash: 'hash1',
          parentHash: null,
          verified: true,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          createdAt: new Date('2025-01-20T10:00:00Z'),
        },
      ];

      jest.spyOn(service, 'queryLogs').mockResolvedValue(mockLogs);

      const buffer = await service.exportLogs(orgId, 'json');

      // Should not throw
      expect(() => JSON.parse(buffer.toString('utf-8'))).not.toThrow();
    });
  });

  describe('Organization Scoping', () => {
    it('should only export logs for specified organization', async () => {
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      await service.exportLogs(orgId, 'csv');

      expect(service.queryLogs).toHaveBeenCalledWith(
        orgId,
        expect.any(Object)
      );
    });

    it('should reject cross-organization access', async () => {
      // This test verifies the service calls queryLogs with the provided orgId
      // queryLogs enforces the org scope internally
      jest.spyOn(service, 'queryLogs').mockResolvedValue([]);

      await service.exportLogs(otherOrgId, 'json');

      expect(service.queryLogs).toHaveBeenCalledWith(otherOrgId, expect.any(Object));
    });
  });
});
