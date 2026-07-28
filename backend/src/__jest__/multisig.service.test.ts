import { prisma } from '../lib/db.js';
import { multisigService } from '../services/multisig.service.js';
import { authorizationService } from '../services/authorization.service.js';

// Mock dependencies
jest.mock('../lib/db.js', () => ({
  prisma: {
    multisigProposal: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../services/authorization.service.js', () => ({
  authorizationService: {
    requirePermission: jest.fn(),
    requireAdmin: jest.fn(),
  },
}));

jest.mock('../logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('MultisigService', () => {
  const mockOrgId = 'org-123';
  const mockCreatedBy = 'GCREATOR123456789012345678901234567890123456789012345678901234567';
  const mockSigner = 'GSIGNER1234567890123456789012345678901234567890123456789012345678';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createProposal', () => {
    it('should create a new multisig proposal', async () => {
      const input = {
        description: 'Large disbursement',
        transactionXdr: 'AAAA...',
        requiredSigners: 2,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      };

      const mockProposal = {
        id: 'prop-123',
        proposalId: expect.any(String),
        organizationId: mockOrgId,
        description: input.description,
        transactionXdr: input.transactionXdr,
        signatures: [],
        requiredSigners: input.requiredSigners,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: input.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (authorizationService.requirePermission as jest.Mock).mockResolvedValue(undefined);
      (prisma.multisigProposal.create as jest.Mock).mockResolvedValue(mockProposal);

      const result = await multisigService.createProposal(mockOrgId, input, mockCreatedBy);

      expect(result.status).toBe('PENDING');
      expect(result.requiredSigners).toBe(2);
      expect(result.signatures).toHaveLength(0);
      expect(authorizationService.requirePermission).toHaveBeenCalled();
    });

    it('should throw error if creator lacks permission', async () => {
      const input = {
        description: 'Test proposal',
        transactionXdr: 'AAAA...',
        requiredSigners: 2,
        expiresAt: new Date(),
      };

      (authorizationService.requirePermission as jest.Mock).mockRejectedValue(
        new Error('Unauthorized')
      );

      await expect(multisigService.createProposal(mockOrgId, input, mockCreatedBy)).rejects.toThrow(
        'Unauthorized'
      );
    });
  });

  describe('getProposal', () => {
    it('should return proposal by ID', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(mockProposal);

      const result = await multisigService.getProposal(mockOrgId, mockProposal.proposalId);

      expect(result).toBeDefined();
      expect(result?.proposalId).toBe(mockProposal.proposalId);
    });

    it('should return null if proposal not found', async () => {
      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await multisigService.getProposal(mockOrgId, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listProposals', () => {
    it('should list all proposals for organization', async () => {
      const mockProposals = [
        {
          id: 'prop-1',
          proposalId: 'prop_1',
          organizationId: mockOrgId,
          description: 'Test 1',
          transactionXdr: 'AAAA...',
          signatures: [],
          requiredSigners: 2,
          status: 'PENDING',
          submittedTxHash: null,
          errorMessage: null,
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (prisma.multisigProposal.findMany as jest.Mock).mockResolvedValue(mockProposals);

      const result = await multisigService.listProposals(mockOrgId);

      expect(result).toHaveLength(1);
    });

    it('should filter proposals by status', async () => {
      (prisma.multisigProposal.findMany as jest.Mock).mockResolvedValue([]);

      await multisigService.listProposals(mockOrgId, { status: 'SIGNED' });

      expect(prisma.multisigProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'SIGNED',
          }),
        })
      );
    });
  });

  describe('addSignature', () => {
    it('should add signature to proposal', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 100000), // Not expired
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedProposal = {
        ...mockProposal,
        signatures: [{ signer: mockSigner, signature: 'SIG...' }],
      };

      (authorizationService.requirePermission as jest.Mock).mockResolvedValue(undefined);
      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValueOnce(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue(updatedProposal);

      const result = await multisigService.addSignature(
        mockOrgId,
        mockProposal.proposalId,
        mockSigner,
        'SIG...'
      );

      expect(result.signatures).toHaveLength(1);
      expect(result.signatures[0].signer).toBe(mockSigner);
    });

    it('should auto-submit when threshold reached', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [{ signer: 'GSIGNER1', signature: 'SIG1' }],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedProposal = {
        ...mockProposal,
        signatures: [
          { signer: 'GSIGNER1', signature: 'SIG1' },
          { signer: mockSigner, signature: 'SIG2' },
        ],
        status: 'SIGNED',
      };

      (authorizationService.requirePermission as jest.Mock).mockResolvedValue(undefined);
      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValueOnce(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue(updatedProposal);

      const result = await multisigService.addSignature(
        mockOrgId,
        mockProposal.proposalId,
        mockSigner,
        'SIG2'
      );

      expect(result.status).toBe('SIGNED');
    });

    it('should reject signature on expired proposal', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() - 1000), // Expired
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (authorizationService.requirePermission as jest.Mock).mockResolvedValue(undefined);
      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(mockProposal);

      await expect(
        multisigService.addSignature(mockOrgId, mockProposal.proposalId, mockSigner, 'SIG...')
      ).rejects.toThrow('expired');
    });
  });

  describe('submitProposal', () => {
    it('should submit proposal to network when fully signed', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [
          { signer: 'GSIGNER1', signature: 'SIG1' },
          { signer: 'GSIGNER2', signature: 'SIG2' },
        ],
        requiredSigners: 2,
        status: 'SIGNED',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'SUBMITTED',
        submittedTxHash: expect.any(String),
      });

      const result = await multisigService.submitProposal(mockOrgId, mockProposal.proposalId);

      expect(result.txHash).toBeDefined();
      expect(prisma.multisigProposal.update).toHaveBeenCalled();
    });

    it('should reject submission without enough signatures', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [{ signer: 'GSIGNER1', signature: 'SIG1' }],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(mockProposal);

      await expect(multisigService.submitProposal(mockOrgId, mockProposal.proposalId)).rejects.toThrow(
        'required number of signatures'
      );
    });
  });

  describe('revokeProposal', () => {
    it('should revoke a proposal', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (authorizationService.requireAdmin as jest.Mock).mockResolvedValue(undefined);
      (prisma.multisigProposal.findFirst as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'EXPIRED',
      });

      await multisigService.revokeProposal(mockOrgId, mockProposal.proposalId, mockCreatedBy);

      expect(prisma.multisigProposal.update).toHaveBeenCalled();
    });
  });

  describe('expireProposal', () => {
    it('should expire a single PENDING proposal', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000); // 1 second in past

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: expiredTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'EXPIRED',
      });

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'EXPIRED',
          }),
        })
      );
    });

    it('should expire a SIGNED proposal', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000);

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [{ signer: 'GSIGNER1', signature: 'SIG1' }],
        requiredSigners: 2,
        status: 'SIGNED', // Not fully signed, but expired
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: expiredTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'EXPIRED',
      });

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).toHaveBeenCalled();
    });

    it('should not transition SUBMITTED to EXPIRED', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000);

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'SUBMITTED', // Already submitted
        submittedTxHash: 'tx_123',
        errorMessage: null,
        expiresAt: expiredTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });

    it('should not transition EXPIRED to EXPIRED', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'EXPIRED', // Already expired
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });

    it('should not expire proposal before expiresAt timestamp', async () => {
      const futureTime = new Date(Date.now() + 100000); // Still in future

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: futureTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });

    it('should throw error if proposal not found', async () => {
      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(multisigService.expireProposal('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('expireOldProposals', () => {
    it('should expire old proposals', async () => {
      (prisma.multisigProposal.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await multisigService.expireOldProposals(mockOrgId);

      expect(result).toBe(3);
    });

    it('should only expire PENDING and SIGNED proposals', async () => {
      (prisma.multisigProposal.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await multisigService.expireOldProposals(mockOrgId);

      expect(prisma.multisigProposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['PENDING', 'SIGNED'] },
          }),
        })
      );
    });

    it('should not expire proposals that have not yet expired', async () => {
      (prisma.multisigProposal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await multisigService.expireOldProposals(mockOrgId);

      expect(result).toBe(0);
      expect(prisma.multisigProposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiresAt: { lt: expect.any(Date) },
          }),
        })
      );
    });
  });

  describe('cleanupExpiredProposals', () => {
    it('should delete expired proposals older than 30 days', async () => {
      (prisma.multisigProposal.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      const result = await multisigService.cleanupExpiredProposals(30);

      expect(result).toBe(5);
      expect(prisma.multisigProposal.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'EXPIRED',
          }),
        })
      );
    });

    it('should use default 30 days if not specified', async () => {
      (prisma.multisigProposal.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await multisigService.cleanupExpiredProposals();

      expect(result).toBe(3);
      expect(prisma.multisigProposal.deleteMany).toHaveBeenCalled();
    });

    it('should only delete EXPIRED proposals', async () => {
      (prisma.multisigProposal.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      await multisigService.cleanupExpiredProposals(7);

      expect(prisma.multisigProposal.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'EXPIRED',
          }),
        })
      );
    });

    it('should correctly calculate cutoff date', async () => {
      (prisma.multisigProposal.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });

      const beforeCall = new Date();
      beforeCall.setDate(beforeCall.getDate() - 15);

      await multisigService.cleanupExpiredProposals(15);

      const callArgs = (prisma.multisigProposal.deleteMany as jest.Mock).mock.calls[0][0];
      const cutoffFromCall = callArgs.where.updatedAt.lt;

      expect(cutoffFromCall).toBeDefined();
      expect(cutoffFromCall.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should handle deletion errors gracefully', async () => {
      (prisma.multisigProposal.deleteMany as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(multisigService.cleanupExpiredProposals(30)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('Status transition validation', () => {
    it('should allow PENDING → EXPIRED transition', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000);

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'PENDING',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: expiredTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'EXPIRED',
      });

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).toHaveBeenCalled();
    });

    it('should allow SIGNED → EXPIRED transition', async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 1000);

      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [{ signer: 'GSIGNER1', signature: 'SIG1' }],
        requiredSigners: 2,
        status: 'SIGNED',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: expiredTime,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);
      (prisma.multisigProposal.update as jest.Mock).mockResolvedValue({
        ...mockProposal,
        status: 'EXPIRED',
      });

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).toHaveBeenCalled();
    });

    it('should prevent SUBMITTED → EXPIRED transition', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'SUBMITTED',
        submittedTxHash: 'tx_123',
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });

    it('should prevent FAILED → EXPIRED transition', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'FAILED',
        submittedTxHash: null,
        errorMessage: 'Network error',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });

    it('should prevent REVOKED → EXPIRED transition', async () => {
      const mockProposal = {
        id: 'prop-123',
        proposalId: 'prop_123456',
        organizationId: mockOrgId,
        description: 'Test',
        transactionXdr: 'AAAA...',
        signatures: [],
        requiredSigners: 2,
        status: 'REVOKED',
        submittedTxHash: null,
        errorMessage: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigProposal.findUnique as jest.Mock).mockResolvedValue(mockProposal);

      await multisigService.expireProposal(mockProposal.proposalId);

      expect(prisma.multisigProposal.update).not.toHaveBeenCalled();
    });
  });
});
