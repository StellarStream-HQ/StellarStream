import { billingService } from '../services/billing.service.js';
import { prisma } from '../lib/db.js';
import { Decimal } from '@prisma/client/runtime/library';

// Mock Prisma
jest.mock('../lib/db.js', () => ({
  prisma: {
    billingRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    disbursement: {
      findMany: jest.fn(),
    },
  },
}));

// Mock logger
jest.mock('../logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('BillingService', () => {
  const mockOrgId = 'org-123';
  const mockBillingPeriod = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCurrentBilling', () => {
    it('should return existing billing record for current month', async () => {
      const mockRecord = {
        id: 'bill-123',
        organizationId: mockOrgId,
        billingPeriod: mockBillingPeriod,
        streamsCreated: 5,
        disbursementsProcessed: 20,
        apiRequests: 100,
        volumeUsd: new Decimal('50000'),
        chargeUsd: new Decimal('500'),
        plan: 'PRO',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(mockRecord);

      const result = await billingService.getCurrentBilling(mockOrgId);

      expect(result.organizationId).toBe(mockOrgId);
      expect(result.billingPeriod).toBe(mockBillingPeriod);
      expect(result.streamsCreated).toBe(5);
      expect(result.plan).toBe('PRO');
    });

    it('should create new billing record if not found', async () => {
      const mockRecord = {
        id: 'bill-new',
        organizationId: mockOrgId,
        billingPeriod: mockBillingPeriod,
        streamsCreated: 0,
        disbursementsProcessed: 0,
        apiRequests: 0,
        volumeUsd: new Decimal('0'),
        chargeUsd: new Decimal('0'),
        plan: 'FREE',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue(mockRecord);

      const result = await billingService.getCurrentBilling(mockOrgId);

      expect(result.plan).toBe('FREE');
      expect(result.streamsCreated).toBe(0);
      expect(prisma.billingRecord.create).toHaveBeenCalled();
    });
  });

  describe('generateUsageReport', () => {
    it('should return empty report if no billing record exists for period', async () => {
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(null);

      const report = await billingService.generateUsageReport(mockOrgId, '2025-01');

      expect(report.organizationId).toBe(mockOrgId);
      expect(report.billingPeriod).toBe('2025-01');
      expect(report.totalStreamsCreated).toBe(0);
      expect(report.totalDisbursementsProcessed).toBe(0);
    });

    it('should generate complete usage report with daily breakdown', async () => {
      const mockRecord = {
        id: 'bill-123',
        organizationId: mockOrgId,
        billingPeriod: '2025-01',
        streamsCreated: 5,
        disbursementsProcessed: 20,
        apiRequests: 100,
        volumeUsd: new Decimal('50000'),
        chargeUsd: new Decimal('500'),
        plan: 'PRO',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.disbursement.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // For getAssetUsage
        .mockResolvedValueOnce([]); // For getTopRecipients

      const report = await billingService.generateUsageReport(mockOrgId, '2025-01');

      expect(report.organizationId).toBe(mockOrgId);
      expect(report.billingPeriod).toBe('2025-01');
      expect(report.plan).toBe('PRO');
      expect(report.totalStreamsCreated).toBe(5);
      expect(report.totalDisbursementsProcessed).toBe(20);
      expect(report.totalVolumeUsd).toEqual(new Decimal('50000'));
      expect(report.dailyBreakdown).toHaveLength(31); // January has 31 days
      expect(report.reportGeneratedAt).toBeDefined();
    });

    it('should default to current month if period not specified', async () => {
      const mockRecord = {
        id: 'bill-123',
        organizationId: mockOrgId,
        billingPeriod: mockBillingPeriod,
        streamsCreated: 0,
        disbursementsProcessed: 0,
        apiRequests: 0,
        volumeUsd: new Decimal('0'),
        chargeUsd: new Decimal('0'),
        plan: 'FREE',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.disbursement.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const report = await billingService.generateUsageReport(mockOrgId);

      expect(report.billingPeriod).toBe(mockBillingPeriod);
    });

    it('should include asset usage details in report', async () => {
      const mockRecord = {
        id: 'bill-123',
        organizationId: mockOrgId,
        billingPeriod: '2025-01',
        streamsCreated: 5,
        disbursementsProcessed: 20,
        apiRequests: 100,
        volumeUsd: new Decimal('50000'),
        chargeUsd: new Decimal('500'),
        plan: 'PRO',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDisbursement = {
        tokenAddress: 'USDC:GBUQWP3BOUZX34ULNQG23RQ6F5LGXLQNUKMXONG5SJIQVOOOOP3TVLJQ',
        amount: BigInt(1000000000), // 100 XLM in stroops
        createdAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.disbursement.findMany as jest.Mock)
        .mockResolvedValueOnce([mockDisbursement]) // For getAssetUsage
        .mockResolvedValueOnce([]); // For getTopRecipients

      const report = await billingService.generateUsageReport(mockOrgId, '2025-01');

      expect(report.assetUsageDetails).toHaveLength(1);
      expect(report.assetUsageDetails[0].assetCode).toBe('USDC');
      expect(report.assetUsageDetails[0].disbursementCount).toBe(1);
    });

    it('should include top recipients in report', async () => {
      const mockRecord = {
        id: 'bill-123',
        organizationId: mockOrgId,
        billingPeriod: '2025-01',
        streamsCreated: 5,
        disbursementsProcessed: 20,
        apiRequests: 100,
        volumeUsd: new Decimal('50000'),
        chargeUsd: new Decimal('500'),
        plan: 'PRO',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.disbursement.findMany as jest.Mock)
        .mockResolvedValueOnce([]) // For getAssetUsage
        .mockResolvedValueOnce([ // For getTopRecipients
          {
            receiver: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2UPAA',
            amount: BigInt(1000000000),
            createdAt: new Date(),
          },
        ]);

      const report = await billingService.generateUsageReport(mockOrgId, '2025-01');

      expect(report.topRecipients).toHaveLength(1);
      expect(report.topRecipients[0].address).toBe(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2UPAA'
      );
    });
  });

  describe('getAssetUsage', () => {
    it('should return empty array if no disbursements found', async () => {
      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE',
      });

      const assetUsage = await billingService.getAssetUsage(mockOrgId, '2025-01');

      expect(assetUsage).toEqual([]);
    });

    it('should aggregate disbursements by asset', async () => {
      const mockDisbursements = [
        {
          tokenAddress: 'USDC:GBUQWP3BOUZX34ULNQG23RQ6F5LGXLQNUKMXONG5SJIQVOOOOP3TVLJQ',
          amount: BigInt(1000000000), // 100 XLM in stroops
          createdAt: new Date(),
        },
        {
          tokenAddress: 'USDC:GBUQWP3BOUZX34ULNQG23RQ6F5LGXLQNUKMXONG5SJIQVOOOOP3TVLJQ',
          amount: BigInt(2000000000), // 200 XLM in stroops
          createdAt: new Date(),
        },
      ];

      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue(mockDisbursements);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE',
      });

      const assetUsage = await billingService.getAssetUsage(mockOrgId, '2025-01');

      expect(assetUsage).toHaveLength(1);
      expect(assetUsage[0].assetCode).toBe('USDC');
      expect(assetUsage[0].disbursementCount).toBe(2);
      expect(assetUsage[0].totalVolumeUsd).toEqual(new Decimal('300'));
    });

    it('should handle native asset (XLM)', async () => {
      const mockDisbursements = [
        {
          tokenAddress: 'native',
          amount: BigInt(1000000000), // 100 XLM in stroops
          createdAt: new Date(),
        },
      ];

      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue(mockDisbursements);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE',
      });

      const assetUsage = await billingService.getAssetUsage(mockOrgId, '2025-01');

      expect(assetUsage).toHaveLength(1);
      expect(assetUsage[0].issuer).toBeNull();
    });

    it('should calculate charges for paid tier', async () => {
      const mockDisbursements = [
        {
          tokenAddress: 'USDC:GBUQWP3BOUZX34ULNQG23RQ6F5LGXLQNUKMXONG5SJIQVOOOOP3TVLJQ',
          amount: BigInt(1000000000), // 100 XLM in stroops
          createdAt: new Date(),
        },
      ];

      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue(mockDisbursements);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'PRO',
      });

      const assetUsage = await billingService.getAssetUsage(mockOrgId, '2025-01');

      expect(assetUsage).toHaveLength(1);
      expect(assetUsage[0].chargeUsd).toEqual(new Decimal('1')); // 100 * 1%
    });

    it('should default to current month if period not specified', async () => {
      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE',
      });

      await billingService.getAssetUsage(mockOrgId);

      expect(prisma.disbursement.findMany).toHaveBeenCalled();
    });

    it('should separate assets by issuer', async () => {
      const mockDisbursements = [
        {
          tokenAddress: 'USDC:ISSUER1',
          amount: BigInt(1000000000),
          createdAt: new Date(),
        },
        {
          tokenAddress: 'USDC:ISSUER2',
          amount: BigInt(2000000000),
          createdAt: new Date(),
        },
      ];

      (prisma.disbursement.findMany as jest.Mock).mockResolvedValue(mockDisbursements);
      (prisma.billingRecord.findUnique as jest.Mock).mockResolvedValue({
        plan: 'FREE',
      });

      const assetUsage = await billingService.getAssetUsage(mockOrgId, '2025-01');

      expect(assetUsage).toHaveLength(2); // Different issuers = different assets
    });
  });
});
