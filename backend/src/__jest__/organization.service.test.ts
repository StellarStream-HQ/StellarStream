import { prisma } from '../lib/db.js';
import { OrganizationService } from '../services/organization.service.js';

// Mock Prisma
jest.mock('../lib/db.js', () => ({
  prisma: {
    organization: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    organizationMember: {
      create: jest.fn(),
    },
    organizationPolicy: {
      create: jest.fn(),
    },
    billingRecord: {
      create: jest.fn(),
    },
    auditLog: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// Mock logger
jest.mock('../logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('OrganizationService', () => {
  let service: OrganizationService;
  const validGAddress = 'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G5JBFPTZQ4XELCPVPDBFVTZT';
  const creatorAddress = 'GBCV2QYZFZMKLQT4X3IAQQ7FSGV4FA7OQPKBDLVFHPJ5Y4BFQW5QD3XH';

  beforeEach(() => {
    service = new OrganizationService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create()', () => {
    it('should create an organization with valid inputs', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        description: 'Test Description',
        logoUrl: 'https://example.com/logo.png',
        creatorAddress,
      };

      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: 'Test Description',
        logoUrl: 'https://example.com/logo.png',
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organization.create as jest.Mock).mockResolvedValue(mockOrganization);
      (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
      (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

      const result = await service.create(createData);

      expect(result).toEqual(mockOrganization);
      expect(prisma.organization.create).toHaveBeenCalledWith({
        data: {
          gAddress: validGAddress,
          name: 'Test Organization',
          description: 'Test Description',
          logoUrl: 'https://example.com/logo.png',
          createdBy: creatorAddress,
          isActive: true,
        },
      });
    });

    it('should add creator as EXECUTOR member', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        creatorAddress,
      };

      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organization.create as jest.Mock).mockResolvedValue(mockOrganization);
      (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
      (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

      await service.create(createData);

      expect(prisma.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-123',
          orgAddress: validGAddress,
          memberAddress: creatorAddress,
          role: 'EXECUTOR',
          addedBy: creatorAddress,
          isActive: true,
        },
      });
    });

    it('should initialize default policy with unlimited spending', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        creatorAddress,
      };

      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organization.create as jest.Mock).mockResolvedValue(mockOrganization);
      (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
      (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

      await service.create(createData);

      expect(prisma.organizationPolicy.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-123',
          dailySpendLimitUsd: null,
          allowedAssets: null,
          requiresMultisig: false,
          multisigThreshold: null,
          updatedBy: creatorAddress,
        },
      });
    });

    it('should initialize billing record for current month with FREE plan', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        creatorAddress,
      };

      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organization.create as jest.Mock).mockResolvedValue(mockOrganization);
      (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
      (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

      await service.create(createData);

      expect(prisma.billingRecord.create).toHaveBeenCalled();
      const billingCall = (prisma.billingRecord.create as jest.Mock).mock.calls[0];
      const billingData = billingCall[0].data;

      expect(billingData.organizationId).toBe('org-123');
      expect(billingData.plan).toBe('FREE');
      expect(billingData.status).toBe('ACTIVE');
      expect(billingData.streamsCreated).toBe(0);
      expect(billingData.disbursementsProcessed).toBe(0);
      expect(billingData.volumeUsd).toBe(0);
      expect(billingData.chargeUsd).toBe(0);
      // billingPeriod should be in YYYY-MM format
      expect(billingData.billingPeriod).toMatch(/^\d{4}-\d{2}$/);
    });

    it('should reject invalid G-address format', async () => {
      const createData = {
        gAddress: 'INVALID_ADDRESS',
        name: 'Test Organization',
        creatorAddress,
      };

      await expect(service.create(createData)).rejects.toThrow(
        'Invalid G-address format'
      );
      expect(prisma.organization.create).not.toHaveBeenCalled();
    });

    it('should reject G-address that is too short', async () => {
      const createData = {
        gAddress: 'GSHORT',
        name: 'Test Organization',
        creatorAddress,
      };

      await expect(service.create(createData)).rejects.toThrow(
        'Invalid G-address format'
      );
    });

    it('should reject duplicate G-address', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        creatorAddress,
      };

      const existingOrg = {
        id: 'org-existing',
        gAddress: validGAddress,
        name: 'Existing Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: 'another-creator',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(existingOrg);

      await expect(service.create(createData)).rejects.toThrow(
        `Organization with G-address ${validGAddress} already exists`
      );
      expect(prisma.organization.create).not.toHaveBeenCalled();
    });

    it('should handle optional fields correctly', async () => {
      const createData = {
        gAddress: validGAddress,
        name: 'Test Organization',
        creatorAddress,
        // description and logoUrl are omitted
      };

      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.organization.create as jest.Mock).mockResolvedValue(mockOrganization);
      (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
      (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
      (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

      const result = await service.create(createData);

      expect(result.description).toBeNull();
      expect(result.logoUrl).toBeNull();
    });
  });

  describe('getById()', () => {
    it('should retrieve organization by ID', async () => {
      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: 'Test Description',
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(mockOrganization);

      const result = await service.getById('org-123');

      expect(result).toEqual(mockOrganization);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-123' },
      });
    });

    it('should return null when organization not found', async () => {
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getById('org-nonexistent');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      (prisma.organization.findUnique as jest.Mock).mockRejectedValue(error);

      await expect(service.getById('org-123')).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('getByAddress()', () => {
    it('should retrieve organization by G-address', async () => {
      const mockOrganization = {
        id: 'org-123',
        gAddress: validGAddress,
        name: 'Test Organization',
        description: null,
        logoUrl: null,
        customDomain: null,
        contactEmail: null,
        createdBy: creatorAddress,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(mockOrganization);

      const result = await service.getByAddress(validGAddress);

      expect(result).toEqual(mockOrganization);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { gAddress: validGAddress },
      });
    });

    it('should return null when organization not found by address', async () => {
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getByAddress('GNONEXISTENT');

      expect(result).toBeNull();
    });

    it('should handle database errors during address lookup', async () => {
      const error = new Error('Database query failed');
      (prisma.organization.findUnique as jest.Mock).mockRejectedValue(error);

      await expect(service.getByAddress(validGAddress)).rejects.toThrow(
        'Database query failed'
      );
    });
  });

  describe('G-address validation', () => {
    it('should accept valid G-addresses', async () => {
      const validAddresses = [
        'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G5JBFPTZQ4XELCPVPDBFVTZT',
        'GAHK2NMXJ3TMXGLYK4NVW4TYDEXQFXAGJVT4T2HJJWF4T65ACGAWVXFZ',
        'GACMV32ZC65HWLCLL3YIE3VNFXKPNZ5Z7NYLGQYQJVX4SXBJWZ3OYHWU',
      ];

      for (const addr of validAddresses) {
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.organization.create as jest.Mock).mockResolvedValue({
          id: 'org-id',
          gAddress: addr,
          name: 'Org',
          description: null,
          logoUrl: null,
          customDomain: null,
          contactEmail: null,
          createdBy: creatorAddress,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        (prisma.organizationMember.create as jest.Mock).mockResolvedValue({});
        (prisma.organizationPolicy.create as jest.Mock).mockResolvedValue({});
        (prisma.billingRecord.create as jest.Mock).mockResolvedValue({});

        const result = await service.create({
          gAddress: addr,
          name: 'Test',
          creatorAddress,
        });

        expect(result).toBeDefined();
      }
    });

    it('should reject addresses not starting with G', async () => {
      const invalidAddresses = [
        'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G5JBFPTZQ4XELCPVPDBFVTZ', // 55 chars
        'HBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G5JBFPTZQ4XELCPVPDBFVTZT', // starts with H
      ];

      for (const addr of invalidAddresses) {
        await expect(
          service.create({
            gAddress: addr,
            name: 'Test',
            creatorAddress,
          })
        ).rejects.toThrow('Invalid G-address format');
      }
    });

    it('should reject addresses with wrong length', async () => {
      const invalidAddresses = [
        'G' + 'A'.repeat(54), // 55 chars total
        'G' + 'A'.repeat(56), // 57 chars total
        'GBJCHUK', // too short
      ];

      for (const addr of invalidAddresses) {
        await expect(
          service.create({
            gAddress: addr,
            name: 'Test',
            creatorAddress,
          })
        ).rejects.toThrow('Invalid G-address format');
      }
    });

    it('should reject addresses with invalid characters', async () => {
      const invalidAddresses = [
        'G' + '0'.repeat(55), // contains 0
        'G' + '1'.repeat(55), // contains 1
        'G' + 'a'.repeat(55), // lowercase
        'G' + '!'.repeat(55), // special chars
      ];

      for (const addr of invalidAddresses) {
        await expect(
          service.create({
            gAddress: addr,
            name: 'Test',
            creatorAddress,
          })
        ).rejects.toThrow('Invalid G-address format');
      }
    });
  });
});

describe('updateMetadata()', () => {
  const validGAddress = 'GBJCHUKZMTFSLOMNC7P4TS4VJJBTCYL3G5JBFPTZQ4XELCPVPDBFVTZT';
  const creatorAddress = 'GBCV2QYZFZMKLQT4X3IAQQ7FSGV4FA7OQPKBDLVFHPJ5Y4BFQW5QD3XH';
  const updaterAddress = 'GEXECUTOR2QYZFZMKLQT4X3IAQQ7FSGV4FA7OQPKBDLVFHPJ5Y4BFQWXYZ';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update organization name', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Old Name',
      description: 'Test Description',
      logoUrl: null,
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      name: 'New Name',
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    const result = await service.updateMetadata(
      'org-123',
      { name: 'New Name' },
      updaterAddress
    );

    expect(result.name).toBe('New Name');
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-123' },
      data: { name: 'New Name' },
    });
  });

  it('should support partial updates with multiple fields', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Test Org',
      description: 'Old Description',
      logoUrl: null,
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      description: 'New Description',
      logoUrl: 'https://example.com/logo.png',
      contactEmail: 'contact@example.com',
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    const result = await service.updateMetadata(
      'org-123',
      {
        description: 'New Description',
        logoUrl: 'https://example.com/logo.png',
        contactEmail: 'contact@example.com',
      },
      updaterAddress
    );

    expect(result.description).toBe('New Description');
    expect(result.logoUrl).toBe('https://example.com/logo.png');
    expect(result.contactEmail).toBe('contact@example.com');
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-123' },
      data: {
        description: 'New Description',
        logoUrl: 'https://example.com/logo.png',
        contactEmail: 'contact@example.com',
      },
    });
  });

  it('should support clearing description by passing null', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Test Org',
      description: 'Test Description',
      logoUrl: 'https://example.com/logo.png',
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      description: null,
      logoUrl: null,
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    const result = await service.updateMetadata(
      'org-123',
      {
        description: null,
        logoUrl: null,
      },
      updaterAddress
    );

    expect(result.description).toBeNull();
    expect(result.logoUrl).toBeNull();
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-123' },
      data: {
        description: null,
        logoUrl: null,
      },
    });
  });

  it('should reject updates with no fields provided', async () => {
    const service = new OrganizationService();

    await expect(
      service.updateMetadata('org-123', {}, updaterAddress)
    ).rejects.toThrow('At least one metadata field must be provided for update');

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('should throw error when organization not found', async () => {
    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

    const service = new OrganizationService();

    await expect(
      service.updateMetadata(
        'org-nonexistent',
        { name: 'New Name' },
        updaterAddress
      )
    ).rejects.toThrow('Organization with ID org-nonexistent not found');

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('should create audit log entry for metadata update', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Old Name',
      description: null,
      logoUrl: null,
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      name: 'New Name',
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    await service.updateMetadata(
      'org-123',
      { name: 'New Name' },
      updaterAddress
    );

    expect(prisma.auditLog.create).toHaveBeenCalled();
    const auditLogCall = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    const auditData = auditLogCall[0].data;

    expect(auditData.organizationId).toBe('org-123');
    expect(auditData.actionType).toBe('ORGANIZATION_METADATA_UPDATED');
    expect(auditData.actor).toBe(updaterAddress);
    expect(auditData.resourceId).toBe('org-123');
    expect(auditData.resourceType).toBe('organization');
    expect(auditData.changes.before.name).toBe('Old Name');
    expect(auditData.changes.after.name).toBe('New Name');
  });

  it('should compute hash chain for audit log entries', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Old Name',
      description: null,
      logoUrl: null,
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      name: 'New Name',
      updatedAt: new Date(),
    };

    const previousHash =
      'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
      entryHash: previousHash,
    });
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    await service.updateMetadata(
      'org-123',
      { name: 'New Name' },
      updaterAddress
    );

    expect(prisma.auditLog.create).toHaveBeenCalled();
    const auditLogCall = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    const auditData = auditLogCall[0].data;

    expect(auditData.parentHash).toBe(previousHash);
    expect(auditData.entryHash).toBeDefined();
    expect(auditData.entryHash).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('should update multiple metadata fields tracking all changes', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Test Org',
      description: 'Old Description',
      logoUrl: 'https://old-url.com/logo.png',
      customDomain: 'old.example.com',
      contactEmail: 'old@example.com',
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedOrganization = {
      ...mockOrganization,
      name: 'New Org',
      description: 'New Description',
      logoUrl: 'https://new-url.com/logo.png',
      customDomain: 'new.example.com',
      contactEmail: 'new@example.com',
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockResolvedValue(
      updatedOrganization
    );
    (prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

    const service = new OrganizationService();
    const result = await service.updateMetadata(
      'org-123',
      {
        name: 'New Org',
        description: 'New Description',
        logoUrl: 'https://new-url.com/logo.png',
        customDomain: 'new.example.com',
        contactEmail: 'new@example.com',
      },
      updaterAddress
    );

    expect(result.name).toBe('New Org');
    expect(result.description).toBe('New Description');
    expect(result.logoUrl).toBe('https://new-url.com/logo.png');
    expect(result.customDomain).toBe('new.example.com');
    expect(result.contactEmail).toBe('new@example.com');

    const auditLogCall = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    const auditData = auditLogCall[0].data;
    
    // Verify all changes are tracked
    expect(auditData.changes.before.name).toBe('Test Org');
    expect(auditData.changes.after.name).toBe('New Org');
    expect(auditData.changes.before.description).toBe('Old Description');
    expect(auditData.changes.after.description).toBe('New Description');
    expect(auditData.changes.before.logoUrl).toBe('https://old-url.com/logo.png');
    expect(auditData.changes.after.logoUrl).toBe('https://new-url.com/logo.png');
  });

  it('should handle database errors during update', async () => {
    const mockOrganization = {
      id: 'org-123',
      gAddress: validGAddress,
      name: 'Test Org',
      description: null,
      logoUrl: null,
      customDomain: null,
      contactEmail: null,
      createdBy: creatorAddress,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(
      mockOrganization
    );
    (prisma.organization.update as jest.Mock).mockRejectedValue(
      new Error('Database connection failed')
    );

    const service = new OrganizationService();

    await expect(
      service.updateMetadata(
        'org-123',
        { name: 'New Name' },
        updaterAddress
      )
    ).rejects.toThrow('Database connection failed');
  });
});

describe('isActive()', () => {
  const service = new OrganizationService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true when organization is active', async () => {
    (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
      isActive: true,
    });

    const result = await service.isActive('org-123');

    expect(result).toBe(true);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-123' },
      select: { isActive: true },
    });
  });

  it('should return false when organization is inactive', async () => {
    (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
      isActive: false,
    });

    const result = await service.isActive('org-123');

    expect(result).toBe(false);
  });

  it('should return false when organization not found', async () => {
    (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await service.isActive('org-nonexistent');

    expect(result).toBe(false);
  });

  it('should handle database errors', async () => {
    const error = new Error('Database connection failed');
    (prisma.organization.findUnique as jest.Mock).mockRejectedValue(error);

    await expect(service.isActive('org-123')).rejects.toThrow(
      'Database connection failed'
    );
  });
});
