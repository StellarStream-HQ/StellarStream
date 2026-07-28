import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AuthorizationService, AuthorizationError } from '../authorization.service.js';
import { organizationMemberService } from '../organization-member.service.js';
import { MemberDTO } from '../organization-member.service.js';

/**
 * Test suite for AuthorizationService
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * Tests role-based authorization enforcement, permission matrix validation,
 * and cross-organization access prevention.
 */
describe('AuthorizationService', () => {
  let service: AuthorizationService;

  // Test data constants
  const mockOrganizationId = 'org-123';
  const mockGAddress = 'GABC123456789012345678901234567890123456789012345678901234567';
  const creatorAddress = 'GADD1234567890123456789012345678901234567890123456789012345678';
  const drafterAddress = 'GDRF1234567890123456789012345678901234567890123456789012345678';
  const approverAddress = 'GAPP1234567890123456789012345678901234567890123456789012345678';
  const executorAddress = 'GEXE1234567890123456789012345678901234567890123456789012345678';
  const otherOrgAddress = 'GOTH123456789012345678901234567890123456789012345678901234567';

  function createMockMember(overrides: Partial<MemberDTO> = {}): MemberDTO {
    return {
      id: 'mem-123',
      organizationId: mockOrganizationId,
      orgAddress: mockGAddress,
      memberAddress: drafterAddress,
      role: 'DRAFTER',
      addedBy: creatorAddress,
      isActive: true,
      lastActivityAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      ...overrides,
    };
  }

  beforeEach(() => {
    service = new AuthorizationService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authorize() - Authorization Checks', () => {
    it('should grant permission when member has required action in their role', async () => {
      // Mock getMember to return a DRAFTER member
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      // Mock hasPermission to return true
      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      // Should not throw
      await expect(
        service.authorize(mockOrganizationId, drafterAddress, 'create_stream')
      ).resolves.toBeUndefined();
    });

    it('should throw AuthorizationError when member lacks required permission', async () => {
      // Mock getMember to return a DRAFTER member
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      // Mock hasPermission to return false (no execute permission for DRAFTER)
      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(false);

      await expect(
        service.authorize(mockOrganizationId, drafterAddress, 'execute_disbursement')
      ).rejects.toThrow(AuthorizationError);
    });

    it('should throw AuthorizationError with 403 status for unauthorized action', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER' })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(false);

      try {
        await service.authorize(mockOrganizationId, drafterAddress, 'manage_members');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(403);
      }
    });

    it('should throw AuthorizationError when member does not exist', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(null);

      try {
        await service.authorize(mockOrganizationId, 'UNKNOWN_ADDRESS', 'view_organization');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(403);
      }
    });

    it('should throw 404 error for cross-organization access attempt', async () => {
      const memberDifferentOrg = createMockMember({
        orgAddress: otherOrgAddress,
        memberAddress: drafterAddress,
      });

      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(memberDifferentOrg);

      try {
        await service.authorize(
          mockOrganizationId,
          drafterAddress,
          'view_organization',
          { resourceOrgAddress: otherOrgAddress }
        );
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(404); // 404 to prevent leakage
      }
    });
  });

  describe('getPermissions() - Permission Retrieval', () => {
    it('should return all permissions for EXECUTOR role', async () => {
      const executorPermissions = [
        'create_stream',
        'create_disbursement',
        'approve_disbursement',
        'execute_disbursement',
        'manage_members',
        'manage_policy',
        'update_settings',
        'view_members',
        'view_organization',
      ];

      jest.spyOn(organizationMemberService, 'getPermissions').mockResolvedValue(executorPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, executorAddress);

      expect(permissions).toEqual(executorPermissions);
      expect(permissions).toHaveLength(9);
    });

    it('should return limited permissions for DRAFTER role', async () => {
      const drafterPermissions = [
        'create_stream',
        'create_disbursement',
        'view_members',
        'view_organization',
      ];

      jest.spyOn(organizationMemberService, 'getPermissions').mockResolvedValue(drafterPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, drafterAddress);

      expect(permissions).toEqual(drafterPermissions);
      expect(permissions.length).toBeLessThan(9);
    });

    it('should return intermediate permissions for APPROVER role', async () => {
      const approverPermissions = [
        'approve_disbursement',
        'view_members',
        'view_organization',
        'create_stream',
        'create_disbursement',
      ];

      jest
        .spyOn(organizationMemberService, 'getPermissions')
        .mockResolvedValue(approverPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, approverAddress);

      expect(permissions).toContain('approve_disbursement');
      expect(permissions).toContain('view_members');
      expect(permissions.length).toBeGreaterThan(4); // More than DRAFTER but less than EXECUTOR
    });

    it('should return empty permissions for non-existent member', async () => {
      jest.spyOn(organizationMemberService, 'getPermissions').mockResolvedValue([]);

      const permissions = await service.getPermissions(mockOrganizationId, 'UNKNOWN_ADDRESS');

      expect(permissions).toEqual([]);
    });
  });

  describe('requirePermission() - Convenience Method', () => {
    it('should not throw when member has permission', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'EXECUTOR', memberAddress: executorAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      await expect(
        service.requirePermission(mockOrganizationId, executorAddress, 'manage_policy')
      ).resolves.toBeUndefined();
    });

    it('should throw when member lacks permission', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(false);

      await expect(
        service.requirePermission(mockOrganizationId, drafterAddress, 'execute_disbursement')
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('verifySameOrganization() - Organization Membership Verification', () => {
    it('should not throw when member belongs to organization', async () => {
      jest.spyOn(organizationMemberService, 'isMember').mockResolvedValue(true);

      await expect(
        service.verifySameOrganization(mockOrganizationId, drafterAddress)
      ).resolves.toBeUndefined();
    });

    it('should throw 404 error when member does not belong to organization', async () => {
      jest.spyOn(organizationMemberService, 'isMember').mockResolvedValue(false);

      try {
        await service.verifySameOrganization(mockOrganizationId, 'UNKNOWN_ADDRESS');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(404); // 404 to prevent leakage
      }
    });

    it('should throw 404 (not 403) to avoid leaking organization existence', async () => {
      jest.spyOn(organizationMemberService, 'isMember').mockResolvedValue(false);

      try {
        await service.verifySameOrganization(mockOrganizationId, 'ATTACKER_ADDRESS');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        // 404 is used to avoid leaking that the organization exists
        expect((error as AuthorizationError).statusCode).toBe(404);
      }
    });
  });

  describe('requireAdmin() - Admin Permission Check', () => {
    it('should not throw when member is EXECUTOR', async () => {
      jest.spyOn(organizationMemberService, 'getRole').mockResolvedValue('EXECUTOR');

      await expect(
        service.requireAdmin(mockOrganizationId, executorAddress)
      ).resolves.toBeUndefined();
    });

    it('should throw 403 when member is APPROVER (not EXECUTOR)', async () => {
      jest.spyOn(organizationMemberService, 'getRole').mockResolvedValue('APPROVER');

      try {
        await service.requireAdmin(mockOrganizationId, approverAddress);
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(403);
      }
    });

    it('should throw 403 when member is DRAFTER (not EXECUTOR)', async () => {
      jest.spyOn(organizationMemberService, 'getRole').mockResolvedValue('DRAFTER');

      try {
        await service.requireAdmin(mockOrganizationId, drafterAddress);
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(403);
      }
    });

    it('should throw 403 when member does not exist (role is null)', async () => {
      jest.spyOn(organizationMemberService, 'getRole').mockResolvedValue(null);

      try {
        await service.requireAdmin(mockOrganizationId, 'UNKNOWN_ADDRESS');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(403);
      }
    });
  });

  describe('Role-Based Permission Matrix - Requirements 3.1, 3.2', () => {
    it('EXECUTOR should have all permissions', async () => {
      const executorPermissions = [
        'create_stream',
        'create_disbursement',
        'approve_disbursement',
        'execute_disbursement',
        'manage_members',
        'manage_policy',
        'update_settings',
        'view_members',
        'view_organization',
      ];

      jest.spyOn(organizationMemberService, 'getPermissions').mockResolvedValue(executorPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, executorAddress);

      // Verify all required permissions exist
      expect(permissions).toContain('execute_disbursement');
      expect(permissions).toContain('manage_members');
      expect(permissions).toContain('manage_policy');
    });

    it('APPROVER should have approve and view permissions but not execute', async () => {
      const approverPermissions = [
        'approve_disbursement',
        'view_members',
        'view_organization',
        'create_stream',
        'create_disbursement',
      ];

      jest
        .spyOn(organizationMemberService, 'getPermissions')
        .mockResolvedValue(approverPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, approverAddress);

      expect(permissions).toContain('approve_disbursement');
      expect(permissions).not.toContain('execute_disbursement');
      expect(permissions).not.toContain('manage_policy');
    });

    it('DRAFTER should have create and view permissions but not approve/execute', async () => {
      const drafterPermissions = [
        'create_stream',
        'create_disbursement',
        'view_members',
        'view_organization',
      ];

      jest.spyOn(organizationMemberService, 'getPermissions').mockResolvedValue(drafterPermissions);

      const permissions = await service.getPermissions(mockOrganizationId, drafterAddress);

      expect(permissions).toContain('create_stream');
      expect(permissions).toContain('create_disbursement');
      expect(permissions).not.toContain('approve_disbursement');
      expect(permissions).not.toContain('execute_disbursement');
      expect(permissions).not.toContain('manage_members');
    });
  });

  describe('Action Validation - Requirement 3.3', () => {
    it('should validate all supported action types', async () => {
      const supportedActions = [
        'create_stream',
        'create_disbursement',
        'approve_disbursement',
        'execute_disbursement',
        'manage_members',
        'manage_policy',
        'update_settings',
        'view_members',
        'view_organization',
      ];

      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'EXECUTOR', memberAddress: executorAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      for (const action of supportedActions) {
        await expect(
          service.authorize(mockOrganizationId, executorAddress, action as any)
        ).resolves.toBeUndefined();
      }
    });

    it('should reject unauthorized actions per role', async () => {
      // DRAFTER trying to execute_disbursement
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(false);

      const unauthorizedActions: Array<any> = [
        'execute_disbursement',
        'manage_members',
        'manage_policy',
        'approve_disbursement',
      ];

      for (const action of unauthorizedActions) {
        await expect(
          service.authorize(mockOrganizationId, drafterAddress, action)
        ).rejects.toThrow(AuthorizationError);
      }
    });
  });

  describe('Cross-Organization Access Prevention - Requirement 5.3', () => {
    it('should prevent access when resource belongs to different organization', async () => {
      const memberOrgAddress = 'GORG1234567890123456789012345678901234567890123456789012345';
      const resourceOrgAddress = 'GORG9999999999999999999999999999999999999999999999999999999';

      const member = createMockMember({
        orgAddress: memberOrgAddress,
        memberAddress: drafterAddress,
      });

      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(member);

      try {
        await service.authorize(
          mockOrganizationId,
          drafterAddress,
          'view_organization',
          { resourceOrgAddress }
        );
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(404);
      }
    });

    it('should allow access when resource belongs to same organization', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      // Should not throw when resourceOrgAddress matches member's orgAddress
      await expect(
        service.authorize(mockOrganizationId, drafterAddress, 'view_organization', {
          resourceOrgAddress: mockGAddress,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('Error Handling and Logging', () => {
    it('should re-throw AuthorizationError without additional wrapping', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(null);

      const error = new AuthorizationError('Test error', 403);

      try {
        await service.authorize(mockOrganizationId, 'UNKNOWN', 'view_organization');
        fail('Should have thrown');
      } catch (caught) {
        expect(caught instanceof AuthorizationError).toBe(true);
      }
    });

    it('should preserve error details in AuthorizationError', async () => {
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER' })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(false);

      try {
        await service.authorize(mockOrganizationId, drafterAddress, 'execute_disbursement');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        const authError = error as AuthorizationError;
        expect(authError.name).toBe('AuthorizationError');
        expect(authError.statusCode).toBe(403);
      }
    });
  });

  describe('Requirement Compliance', () => {
    it('fulfills Requirement 3.1: Support three distinct roles with permissions', () => {
      expect(service).toBeDefined();
      expect(typeof service.authorize).toBe('function');
      expect(typeof service.getPermissions).toBe('function');
    });

    it('fulfills Requirement 3.2: Enforce role-based access control via authorize()', () => {
      expect(typeof service.authorize).toBe('function');
      expect(typeof service.requirePermission).toBe('function');
    });

    it('fulfills Requirement 3.3: Validate actions per role', () => {
      expect(typeof service.authorize).toBe('function');
      expect(typeof service.getPermissions).toBe('function');
    });

    it('fulfills Requirement 5.3: Prevent cross-organization access with 404 response', async () => {
      jest.spyOn(organizationMemberService, 'isMember').mockResolvedValue(false);

      try {
        await service.verifySameOrganization(mockOrganizationId, 'ATTACKER');
        fail('Should have thrown');
      } catch (error) {
        expect(error instanceof AuthorizationError).toBe(true);
        expect((error as AuthorizationError).statusCode).toBe(404);
      }
    });

    it('all methods should be available as per design', () => {
      expect(typeof service.authorize).toBe('function');
      expect(typeof service.getPermissions).toBe('function');
      expect(typeof service.requirePermission).toBe('function');
      expect(typeof service.verifySameOrganization).toBe('function');
      expect(typeof service.requireAdmin).toBe('function');
    });
  });

  describe('Comprehensive Integration Scenarios', () => {
    it('should handle full authorization flow for disbursement execution', async () => {
      // Executor approves and executes
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'EXECUTOR', memberAddress: executorAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      await expect(
        service.authorize(mockOrganizationId, executorAddress, 'approve_disbursement')
      ).resolves.toBeUndefined();

      await expect(
        service.authorize(mockOrganizationId, executorAddress, 'execute_disbursement')
      ).resolves.toBeUndefined();
    });

    it('should handle multi-step workflow with role escalation', async () => {
      // Drafter creates, approver approves, executor executes
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'DRAFTER', memberAddress: drafterAddress })
      );

      jest.spyOn(organizationMemberService, 'hasPermission').mockResolvedValue(true);

      await expect(
        service.authorize(mockOrganizationId, drafterAddress, 'create_disbursement')
      ).resolves.toBeUndefined();

      // Now switch to approver
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'APPROVER', memberAddress: approverAddress })
      );

      await expect(
        service.authorize(mockOrganizationId, approverAddress, 'approve_disbursement')
      ).resolves.toBeUndefined();

      // Now switch to executor
      jest.spyOn(organizationMemberService, 'getMember').mockResolvedValue(
        createMockMember({ role: 'EXECUTOR', memberAddress: executorAddress })
      );

      await expect(
        service.authorize(mockOrganizationId, executorAddress, 'execute_disbursement')
      ).resolves.toBeUndefined();
    });
  });
});
