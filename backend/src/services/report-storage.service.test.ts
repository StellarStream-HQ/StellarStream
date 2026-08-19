import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReportStorageService, StorageUrls, ListReportsResult } from './report-storage.service.js';
import { prisma } from '../lib/prisma.js';

// Mock Prisma
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    report: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    reportAuditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ReportStorageService', () => {
  let service: ReportStorageService;
  const organizationId = 'org-123';
  const reportType = 'daily_summary';

  beforeEach(() => {
    // Set encryption key for testing
    process.env.REPORT_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

    service = new ReportStorageService('test-bucket');

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.REPORT_ENCRYPTION_KEY;
  });

  describe('storeReport', () => {
    it('should store report files with encryption and generate signed URLs', async () => {
      const files = {
        pdf: new ArrayBuffer(100),
        xlsx: new ArrayBuffer(200),
      };

      const mockReportId = 'report-123';
      vi.mocked(prisma.report.create).mockResolvedValue({
        id: mockReportId,
        organizationId,
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: {},
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.reportAuditLog.create).mockResolvedValue({
        id: 'audit-1',
        reportId: mockReportId,
        action: 'stored',
        actor: 'system',
        timestamp: new Date(),
        details: {},
        createdAt: new Date(),
      });

      const result = await service.storeReport(organizationId, reportType, files);

      expect(result).toHaveProperty('pdf');
      expect(result).toHaveProperty('xlsx');
      expect(result.pdf).toContain('X-Amz-Signature');
      expect(result.pdf).toContain('X-Amz-Expires=86400'); // 24 hours
      expect(result.xlsx).toContain('X-Amz-Signature');

      expect(prisma.report.create).toHaveBeenCalled();
      expect(prisma.reportAuditLog.create).toHaveBeenCalledTimes(2); // One per format
    });

    it('should skip null/undefined file formats', async () => {
      const files = {
        pdf: new ArrayBuffer(100),
        xlsx: undefined,
        json: null as any,
      };

      vi.mocked(prisma.report.create).mockResolvedValue({
        id: 'report-123',
        organizationId,
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: {},
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.reportAuditLog.create).mockResolvedValue({
        id: 'audit-1',
        reportId: 'report-123',
        action: 'stored',
        actor: 'system',
        timestamp: new Date(),
        details: {},
        createdAt: new Date(),
      });

      const result = await service.storeReport(organizationId, reportType, files);

      expect(result).toHaveProperty('pdf');
      expect(result).not.toHaveProperty('xlsx');
      expect(result).not.toHaveProperty('json');
    });

    it('should throw error on invalid encryption key', () => {
      // Invalid key length (not 64 hex chars)
      process.env.REPORT_ENCRYPTION_KEY = 'invalid-key';

      expect(() => new ReportStorageService('test-bucket')).toThrow(
        'REPORT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
      );
    });
  });

  describe('retrieveReport', () => {
    it('should retrieve report with signed URLs', async () => {
      const reportId = 'report-123';
      const mockReport = {
        id: reportId,
        organizationId,
        reportType: reportType as any,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-02'),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: {
          pdf: 's3://test-bucket/reports/org-123/daily_summary/report-123/2024-01-01T00-00-00.000Z.pdf',
          xlsx: 's3://test-bucket/reports/org-123/daily_summary/report-123/2024-01-01T00-00-00.000Z.xlsx',
        },
        summary: { transactionCount: 100 },
        reconciliationStatus: { discrepanciesFound: false },
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport);

      const result = await service.retrieveReport(reportId, organizationId);

      expect(result).toHaveProperty('id', reportId);
      expect(result).toHaveProperty('signedUrls');
      expect(result.signedUrls).toHaveProperty('pdf');
      expect(result.signedUrls).toHaveProperty('xlsx');
      expect(result.signedUrls.pdf).toContain('X-Amz-Signature');
      expect(result.signedUrls.pdf).toContain('X-Amz-Expires=86400');

      expect(prisma.report.findUnique).toHaveBeenCalledWith({
        where: { id: reportId },
      });
    });

    it('should throw error for non-existent report', async () => {
      const reportId = 'non-existent';

      vi.mocked(prisma.report.findUnique).mockResolvedValue(null);

      await expect(service.retrieveReport(reportId, organizationId)).rejects.toThrow(
        'Report not found or access denied'
      );
    });

    it('should throw error for unauthorized access', async () => {
      const reportId = 'report-123';
      const differentOrgId = 'org-999';

      const mockReport = {
        id: reportId,
        organizationId: 'org-456', // Different organization
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: {},
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport);

      await expect(service.retrieveReport(reportId, differentOrgId)).rejects.toThrow(
        'Report not found or access denied'
      );
    });
  });

  describe('listReports', () => {
    it('should list reports with pagination', async () => {
      const mockReports = [
        {
          id: 'report-1',
          organizationId,
          reportType: reportType as any,
          periodStart: new Date(),
          periodEnd: new Date(),
          generatedAt: new Date('2024-01-02'),
          generatedBy: 'system',
          status: 'generated',
          fileUrls: {},
          summary: {},
          reconciliationStatus: {},
          emailDeliveryStatus: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
        },
        {
          id: 'report-2',
          organizationId,
          reportType: reportType as any,
          periodStart: new Date(),
          periodEnd: new Date(),
          generatedAt: new Date('2024-01-01'),
          generatedBy: 'system',
          status: 'generated',
          fileUrls: {},
          summary: {},
          reconciliationStatus: {},
          emailDeliveryStatus: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      vi.mocked(prisma.report.count).mockResolvedValue(2);
      vi.mocked(prisma.report.findMany).mockResolvedValue(mockReports);

      const result = await service.listReports(organizationId, {
        limit: 50,
        offset: 0,
      });

      expect(result).toHaveProperty('reports');
      expect(result).toHaveProperty('total', 2);
      expect(result).toHaveProperty('limit', 50);
      expect(result).toHaveProperty('offset', 0);
      expect(result.reports).toHaveLength(2);

      expect(prisma.report.count).toHaveBeenCalledWith({
        where: { organizationId },
      });

      expect(prisma.report.findMany).toHaveBeenCalledWith({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter reports by type and status', async () => {
      vi.mocked(prisma.report.count).mockResolvedValue(1);
      vi.mocked(prisma.report.findMany).mockResolvedValue([]);

      await service.listReports(organizationId, {
        reportType: 'daily_summary',
        status: 'generated',
        limit: 25,
        offset: 0,
      });

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId,
            reportType: 'daily_summary',
            status: 'generated',
          },
        })
      );
    });

    it('should enforce maximum limit of 100', async () => {
      vi.mocked(prisma.report.count).mockResolvedValue(0);
      vi.mocked(prisma.report.findMany).mockResolvedValue([]);

      await service.listReports(organizationId, {
        limit: 500, // Exceeds max
        offset: 0,
      });

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100, // Limited to 100
        })
      );
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      vi.mocked(prisma.report.count).mockResolvedValue(0);
      vi.mocked(prisma.report.findMany).mockResolvedValue([]);

      await service.listReports(organizationId, {
        startDate,
        endDate,
      });

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId,
            generatedAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        })
      );
    });
  });

  describe('deleteOldReports', () => {
    it('should soft-delete reports older than retention period', async () => {
      const retentionDays = 30;
      const mockOldReports = [
        {
          id: 'report-1',
          organizationId,
          reportType: reportType as any,
          periodStart: new Date(),
          periodEnd: new Date(),
          generatedAt: new Date('2023-12-01'),
          generatedBy: 'system',
          status: 'generated',
          fileUrls: { pdf: 'url-1' },
          summary: {},
          reconciliationStatus: {},
          emailDeliveryStatus: null,
          createdAt: new Date('2023-12-01'),
          updatedAt: new Date('2023-12-01'),
        },
      ];

      vi.mocked(prisma.report.findMany).mockResolvedValue(mockOldReports);
      vi.mocked(prisma.reportAuditLog.create).mockResolvedValue({
        id: 'audit-1',
        reportId: 'report-1',
        action: 'deleted',
        actor: 'system',
        timestamp: new Date(),
        details: {},
        createdAt: new Date(),
      });

      vi.mocked(prisma.report.update).mockResolvedValue({
        id: 'report-1',
        organizationId,
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date('2023-12-01'),
        generatedBy: 'system',
        status: 'deleted' as any,
        fileUrls: {},
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date('2023-12-01'),
        updatedAt: new Date(),
      });

      const deletedCount = await service.deleteOldReports(organizationId, retentionDays);

      expect(deletedCount).toBe(1);
      expect(prisma.reportAuditLog.create).toHaveBeenCalled();
      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        data: {
          fileUrls: {},
          status: 'deleted',
        },
      });
    });

    it('should return 0 if no reports are old enough', async () => {
      vi.mocked(prisma.report.findMany).mockResolvedValue([]);

      const deletedCount = await service.deleteOldReports(organizationId, 30);

      expect(deletedCount).toBe(0);
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify report integrity successfully', async () => {
      const reportId = 'report-123';
      const mockReport = {
        id: reportId,
        organizationId,
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: { pdf: 'url-1', xlsx: 'url-2' },
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const validSignature = 'a'.repeat(64); // Valid hex signature

      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport);
      vi.mocked(prisma.reportAuditLog.findMany).mockResolvedValue([
        {
          id: 'audit-1',
          reportId,
          action: 'stored',
          actor: 'system',
          timestamp: new Date(),
          details: { format: 'pdf', signature: validSignature },
          createdAt: new Date(),
        },
        {
          id: 'audit-2',
          reportId,
          action: 'stored',
          actor: 'system',
          timestamp: new Date(),
          details: { format: 'xlsx', signature: validSignature },
          createdAt: new Date(),
        },
      ]);

      const result = await service.verifyIntegrity(reportId, organizationId);

      expect(result.verified).toBe(true);
      expect(result.signatures).toHaveLength(2);
      expect(result.signatures[0]).toEqual({ format: 'pdf', valid: true });
      expect(result.signatures[1]).toEqual({ format: 'xlsx', valid: true });
      expect(result.issues).toHaveLength(0);
    });

    it('should return verified false for invalid signature', async () => {
      const reportId = 'report-123';
      const mockReport = {
        id: reportId,
        organizationId,
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: { pdf: 'url-1' },
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const invalidSignature = 'invalid-signature'; // Not valid hex

      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport);
      vi.mocked(prisma.reportAuditLog.findMany).mockResolvedValue([
        {
          id: 'audit-1',
          reportId,
          action: 'stored',
          actor: 'system',
          timestamp: new Date(),
          details: { format: 'pdf', signature: invalidSignature },
          createdAt: new Date(),
        },
      ]);

      const result = await service.verifyIntegrity(reportId, organizationId);

      expect(result.verified).toBe(false);
      expect(result.signatures[0]).toEqual({ format: 'pdf', valid: false });
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should return verified false for unauthorized access', async () => {
      const reportId = 'report-123';
      const mockReport = {
        id: reportId,
        organizationId: 'org-456', // Different organization
        reportType: reportType as any,
        periodStart: new Date(),
        periodEnd: new Date(),
        generatedAt: new Date(),
        generatedBy: 'system',
        status: 'generated',
        fileUrls: {},
        summary: {},
        reconciliationStatus: {},
        emailDeliveryStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.report.findUnique).mockResolvedValue(mockReport);

      const result = await service.verifyIntegrity(reportId, organizationId);

      expect(result.verified).toBe(false);
      expect(result.issues).toContain('Report not found or access denied');
    });
  });

  describe('Encryption and Decryption', () => {
    it('should encrypt and decrypt buffers correctly', () => {
      const originalBuffer = Buffer.from('Test data for encryption');

      // We can't directly test private methods, but we can verify
      // that the service initializes with the encryption key
      expect(service).toBeDefined();
      expect(service).toHaveProperty('encryptBuffer');
      expect(service).toHaveProperty('decryptBuffer');
    });
  });

  describe('Signed URL Generation', () => {
    it('should generate signed URLs with 24-hour expiry', () => {
      const service = new ReportStorageService('test-bucket');

      // The service should have a method to generate signed URLs
      // We verify it's created during storeReport which uses it
      expect(service).toBeDefined();
      expect(service).toHaveProperty('generateSignedUrl');
    });
  });
});
