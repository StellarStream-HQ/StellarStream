import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { organizationPolicyService } from '../organization-policy.service.js';
import { prisma } from '../../lib/db.js';

// Mock Prisma
vi.mock('../../lib/db.js', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
    organizationPolicy: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    disbursement: {
      findMany: vi.fn(),
    },
  },
}));

describe('OrganizationPolicyService', () => {
  const mockOrgId = 'org-123';
  const mockGAddress = 'GAAA123456789012345678901234567890123456789012345678901234567890';
  const mockActorAddress = 'GACTOR123456789012345678901234567890123456789012345678901234567890';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getPolicy', () => {
    it('should retrieve an existing policy', async () => {
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
        gAddress: mockGAddress,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      const result = await organizationPolicyService.getPolicy(mockOrgId);

      expect(result).toMatchObject({
        id: mockPolicy.id,
        organizationId: mockPolicy.organizationId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
      });
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: mockOrgId },
      });
      expect(prisma.organizationPolicy.findUnique).toHaveBeenCalledWith({
        where: { organizationId: mockOrgId },
      });
    });

    it('should throw error if organization not found', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      await expect(organizationPolicyService.getPolicy(mockOrgId)).rejects.toThrow(
        'Organization org-123 not found'
      );
    });

    it('should throw error if policy not found', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(null);

      await expect(organizationPolicyService.getPolicy(mockOrgId)).rejects.toThrow(
        'Policy not found for organization org-123'
      );
    });
  });

  describe('updatePolicy', () => {
    it('should update daily spend limit with audit logging', async () => {
      const existingPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      const updatedPolicy = {
        ...existingPolicy,
        dailySpendLimitUsd: 1000,
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        existingPolicy as any
      );

      vi.mocked(prisma.organizationPolicy.update).mockResolvedValue(
        updatedPolicy as any
      );

      vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);

      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      const result = await organizationPolicyService.updatePolicy(
        mockOrgId,
        { dailySpendLimitUsd: 1000 },
        mockActorAddress
      );

      expect(result.dailySpendLimitUsd).toBe(1000);
      expect(prisma.organizationPolicy.update).toHaveBeenCalledWith({
        where: { organizationId: mockOrgId },
        data: expect.objectContaining({
          dailySpendLimitUsd: 1000,
          updatedBy: mockActorAddress,
        }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should update allowed assets with audit logging', async () => {
      const existingPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      const newAssets = ['USDC:ISSUER', 'EUR:ISSUER'];
      const updatedPolicy = {
        ...existingPolicy,
        allowedAssets: JSON.stringify(newAssets),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        existingPolicy as any
      );

      vi.mocked(prisma.organizationPolicy.update).mockResolvedValue(
        updatedPolicy as any
      );

      vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);

      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      const result = await organizationPolicyService.updatePolicy(
        mockOrgId,
        { allowedAssets: newAssets },
        mockActorAddress
      );

      expect(result.allowedAssets).toEqual(newAssets);
      expect(prisma.organizationPolicy.update).toHaveBeenCalledWith({
        where: { organizationId: mockOrgId },
        data: expect.objectContaining({
          allowedAssets: JSON.stringify(newAssets),
          updatedBy: mockActorAddress,
        }),
      });
    });

    it('should throw error if no update fields provided', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue({
        id: 'policy-123',
      } as any);

      await expect(
        organizationPolicyService.updatePolicy(mockOrgId, {}, mockActorAddress)
      ).rejects.toThrow('At least one policy field must be provided for update');
    });

    it('should throw error if organization not found', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      await expect(
        organizationPolicyService.updatePolicy(
          mockOrgId,
          { dailySpendLimitUsd: 1000 },
          mockActorAddress
        )
      ).rejects.toThrow('Organization org-123 not found');
    });

    it('should throw error if policy not found', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(null);

      await expect(
        organizationPolicyService.updatePolicy(
          mockOrgId,
          { dailySpendLimitUsd: 1000 },
          mockActorAddress
        )
      ).rejects.toThrow('Policy not found for organization org-123');
    });
  });

  describe('initializeDefaultPolicy', () => {
    it('should create default policy with unlimited spending and all assets allowed', async () => {
      const defaultPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(null);

      vi.mocked(prisma.organizationPolicy.create).mockResolvedValue(
        defaultPolicy as any
      );

      const result = await organizationPolicyService.initializeDefaultPolicy(
        mockOrgId,
        mockActorAddress
      );

      expect(result).toMatchObject({
        id: defaultPolicy.id,
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
      });

      expect(prisma.organizationPolicy.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockOrgId,
          dailySpendLimitUsd: null,
          allowedAssets: null,
          requiresMultisig: false,
          multisigThreshold: null,
          updatedBy: mockActorAddress,
        },
      });
    });

    it('should return existing policy if already initialized', async () => {
      const existingPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        existingPolicy as any
      );

      const result = await organizationPolicyService.initializeDefaultPolicy(
        mockOrgId,
        mockActorAddress
      );

      expect(result).toMatchObject(existingPolicy);
      expect(prisma.organizationPolicy.create).not.toHaveBeenCalled();
    });

    it('should throw error if organization not found', async () => {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      await expect(
        organizationPolicyService.initializeDefaultPolicy(mockOrgId, mockActorAddress)
      ).rejects.toThrow('Organization org-123 not found');
    });
  });

  describe('validateAgainstPolicy', () => {
    it('should return valid for disbursement when no limits set', async () => {
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      const result = await organizationPolicyService.validateAgainstPolicy(
        mockOrgId,
        {
          amount: 500,
          tokenAddress: 'USDC:ISSUER',
          receiver: 'GRECEIVER123',
        }
      );

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should reject asset not in whitelist', async () => {
      const allowedAssets = ['USDC:ISSUER', 'EUR:ISSUER'];
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: null,
        allowedAssets: JSON.stringify(allowedAssets),
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
      } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      const result = await organizationPolicyService.validateAgainstPolicy(
        mockOrgId,
        {
          amount: 500,
          tokenAddress: 'UNKNOWN:ISSUER',
          receiver: 'GRECEIVER123',
        }
      );

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('ASSET_NOT_WHITELISTED');
    });

    it('should reject disbursement exceeding daily spend limit', async () => {
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: 1000,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique)
        .mockResolvedValueOnce({ id: mockOrgId } as any)
        .mockResolvedValueOnce({
          id: mockOrgId,
          gAddress: mockGAddress,
        } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      // Mock existing disbursements totaling $900
      vi.mocked(prisma.disbursement.findMany).mockResolvedValue([
        {
          id: '1',
          amount: BigInt(9000000000), // 900 XLM * 10,000,000
        },
      ] as any);

      const result = await organizationPolicyService.validateAgainstPolicy(
        mockOrgId,
        {
          amount: 200, // Would exceed limit
          tokenAddress: 'USDC:ISSUER',
          receiver: 'GRECEIVER123',
        }
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].type).toBe('DAILY_LIMIT_EXCEEDED');
    });

    it('should accept disbursement within daily spend limit', async () => {
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: 1000,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique)
        .mockResolvedValueOnce({ id: mockOrgId } as any)
        .mockResolvedValueOnce({
          id: mockOrgId,
          gAddress: mockGAddress,
        } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      // Mock existing disbursements totaling $400
      vi.mocked(prisma.disbursement.findMany).mockResolvedValue([
        {
          id: '1',
          amount: BigInt(4000000000), // 400 XLM * 10,000,000
        },
      ] as any);

      const result = await organizationPolicyService.validateAgainstPolicy(
        mockOrgId,
        {
          amount: 500, // Within limit
          tokenAddress: 'USDC:ISSUER',
          receiver: 'GRECEIVER123',
        }
      );

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.remainingDailyBudget).toBeGreaterThan(0);
    });

    it('should calculate remaining daily budget correctly', async () => {
      const mockPolicy = {
        id: 'policy-123',
        organizationId: mockOrgId,
        dailySpendLimitUsd: 1000,
        allowedAssets: null,
        requiresMultisig: false,
        multisigThreshold: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: mockActorAddress,
      };

      vi.mocked(prisma.organization.findUnique)
        .mockResolvedValueOnce({ id: mockOrgId } as any)
        .mockResolvedValueOnce({
          id: mockOrgId,
          gAddress: mockGAddress,
        } as any);

      vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
        mockPolicy as any
      );

      // Mock existing disbursements totaling $300
      vi.mocked(prisma.disbursement.findMany).mockResolvedValue([
        {
          id: '1',
          amount: BigInt(3000000000), // 300 XLM * 10,000,000
        },
      ] as any);

      const result = await organizationPolicyService.validateAgainstPolicy(
        mockOrgId,
        {
          amount: 100,
          tokenAddress: 'USDC:ISSUER',
          receiver: 'GRECEIVER123',
        }
      );

      expect(result.remainingDailyBudget).toBe(700); // 1000 - 300
    });
  });

  describe('getDailySpent', () => {
    it('should calculate total daily spending', async () => {
      const mockDate = new Date('2024-01-15');

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
        gAddress: mockGAddress,
      } as any);

      vi.mocked(prisma.disbursement.findMany).mockResolvedValue([
        { amount: BigInt(1000000000) }, // 100 XLM
        { amount: BigInt(2000000000) }, // 200 XLM
      ] as any);

      const result = await organizationPolicyService.getDailySpent(
        mockOrgId,
        mockDate
      );

      // 300 XLM * 0.1 USD/XLM = 30 USD
      expect(result).toBe(30);
    });

    it('should return 0 if no disbursements', async () => {
      const mockDate = new Date('2024-01-15');

      vi.mocked(prisma.organization.findUnique).mockResolvedValue({
        id: mockOrgId,
        gAddress: mockGAddress,
      } as any);

      vi.mocked(prisma.disbursement.findMany).mockResolvedValue([]);

      const result = await organizationPolicyService.getDailySpent(
        mockOrgId,
        mockDate
      );

      expect(result).toBe(0);
    });

    it('should throw error if organization not found', async () => {
      const mockDate = new Date('2024-01-15');

      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      await expect(
        organizationPolicyService.getDailySpent(mockOrgId, mockDate)
      ).rejects.toThrow('Organization org-123 not found');
    });
  });

  describe('Property-Based Tests', () => {
    describe('Property 4: Default Policy Initialization', () => {
      it('should initialize with unlimited spending (null) for all new organizations', async () => {
        const testCases = ['org-1', 'org-2', 'org-3'];

        for (const orgId of testCases) {
          vi.mocked(prisma.organization.findUnique).mockResolvedValue({
            id: orgId,
          } as any);

          vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(null);

          vi.mocked(prisma.organizationPolicy.create).mockResolvedValue({
            id: `policy-${orgId}`,
            organizationId: orgId,
            dailySpendLimitUsd: null,
            allowedAssets: null,
            requiresMultisig: false,
            multisigThreshold: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            updatedBy: mockActorAddress,
          } as any);

          const policy = await organizationPolicyService.initializeDefaultPolicy(
            orgId,
            mockActorAddress
          );

          expect(policy.dailySpendLimitUsd).toBeNull();
          expect(policy.allowedAssets).toBeNull();
          expect(policy.requiresMultisig).toBe(false);
          expect(policy.multisigThreshold).toBeNull();
        }
      });
    });

    describe('Property 20: Asset Whitelist Enforcement', () => {
      it('should always reject non-whitelisted assets immediately', async () => {
        const whitelistedAssets = ['USDC:ISSUER', 'EUR:ISSUER'];
        const testAssets = ['BTC:ISSUER', 'DOGE:ISSUER', 'UNKNOWN:ISSUER'];

        const mockPolicy = {
          id: 'policy-123',
          organizationId: mockOrgId,
          dailySpendLimitUsd: 99999, // Very high limit
          allowedAssets: JSON.stringify(whitelistedAssets),
          requiresMultisig: false,
          multisigThreshold: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: mockActorAddress,
        };

        vi.mocked(prisma.organization.findUnique).mockResolvedValue({
          id: mockOrgId,
        } as any);

        vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
          mockPolicy as any
        );

        for (const asset of testAssets) {
          const result = await organizationPolicyService.validateAgainstPolicy(
            mockOrgId,
            {
              amount: 1,
              tokenAddress: asset,
              receiver: 'GRECEIVER123',
            }
          );

          expect(result.isValid).toBe(false);
          expect(result.violations.some((v) => v.type === 'ASSET_NOT_WHITELISTED')).toBe(true);
        }
      });
    });

    describe('Property 21: Daily Spend Limit Enforcement', () => {
      it('should consistently enforce daily spend limits', async () => {
        const limits = [100, 500, 1000];

        for (const limit of limits) {
          const mockPolicy = {
            id: 'policy-123',
            organizationId: mockOrgId,
            dailySpendLimitUsd: limit,
            allowedAssets: null,
            requiresMultisig: false,
            multisigThreshold: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            updatedBy: mockActorAddress,
          };

          vi.mocked(prisma.organization.findUnique)
            .mockResolvedValueOnce({ id: mockOrgId } as any)
            .mockResolvedValueOnce({
              id: mockOrgId,
              gAddress: mockGAddress,
            } as any);

          vi.mocked(prisma.organizationPolicy.findUnique).mockResolvedValue(
            mockPolicy as any
          );

          // Mock existing spending at 80% of limit
          const existingSpend = limit * 0.8;
          vi.mocked(prisma.disbursement.findMany).mockResolvedValue([
            {
              id: '1',
              amount: BigInt(Math.floor((existingSpend * 10000000) / 0.1)), // Convert USD to stroops
            },
          ] as any);

          // Try to spend 15% more (should fail)
          const result = await organizationPolicyService.validateAgainstPolicy(
            mockOrgId,
            {
              amount: limit * 0.15,
              tokenAddress: 'USDC:ISSUER',
              receiver: 'GRECEIVER123',
            }
          );

          expect(result.isValid).toBe(false);
          expect(result.violations[0].type).toBe('DAILY_LIMIT_EXCEEDED');
        }
      });
    });
  });
});
