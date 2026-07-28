import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { createHash } from 'crypto';

/**
 * Data Transfer Object for Organization Member
 */
export interface MemberDTO {
  id: string;
  organizationId: string;
  orgAddress: string;
  memberAddress: string;
  role: 'DRAFTER' | 'APPROVER' | 'EXECUTOR';
  addedBy: string;
  isActive: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role-based permission definitions
 * EXECUTOR: full permissions (all actions)
 * APPROVER: can approve disbursements, view members
 * DRAFTER: can create drafts, view organization
 */
type Permission =
  | 'create_stream'
  | 'create_disbursement'
  | 'approve_disbursement'
  | 'execute_disbursement'
  | 'manage_members'
  | 'manage_policy'
  | 'update_settings'
  | 'view_members'
  | 'view_organization';

type Role = 'DRAFTER' | 'APPROVER' | 'EXECUTOR';

/**
 * OrganizationMemberService
 *
 * Manages organization membership, roles, and role-based access control.
 * Supports:
 * - Listing members in an organization
 * - Getting specific member details
 * - Retrieving member roles
 * - Checking membership status
 * - Verifying role-based permissions
 *
 * **Validates: Requirements 3.1, 3.2, 12.1**
 */
export class OrganizationMemberService {
  /**
   * Permission matrix: role -> list of allowed actions
   */
  private readonly permissionMatrix: Record<Role, Permission[]> = {
    DRAFTER: [
      'create_stream',
      'create_disbursement',
      'view_members',
      'view_organization',
    ],
    APPROVER: [
      'approve_disbursement',
      'view_members',
      'view_organization',
      'create_stream',
      'create_disbursement',
    ],
    EXECUTOR: [
      'execute_disbursement',
      'manage_members',
      'manage_policy',
      'update_settings',
      'view_members',
      'view_organization',
      'create_stream',
      'create_disbursement',
      'approve_disbursement',
    ],
  };

  /**
   * List all active members of an organization
   *
   * @param organizationId - The organization ID
   * @returns Array of active members, or empty array if none found
   * @throws Error if database query fails
   */
  async listMembers(organizationId: string): Promise<MemberDTO[]> {
    try {
      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      logger.debug('Listed organization members', {
        organizationId,
        count: members.length,
      });

      return members.map((m) => this.mapToDTO(m));
    } catch (error) {
      logger.error('Failed to list organization members', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Get a specific member from an organization
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @returns Member details or null if not found or inactive
   * @throws Error if database query fails
   */
  async getMember(
    organizationId: string,
    memberAddress: string
  ): Promise<MemberDTO | null> {
    try {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId,
            memberAddress,
          },
        },
      });

      if (!member) {
        logger.debug('Member not found in organization', {
          organizationId,
          memberAddress,
        });
        return null;
      }

      // Return null if member is inactive
      if (!member.isActive) {
        logger.debug('Member is inactive', {
          organizationId,
          memberAddress,
        });
        return null;
      }

      return this.mapToDTO(member);
    } catch (error) {
      logger.error('Failed to get organization member', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Get a member's role in an organization
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @returns Role (DRAFTER, APPROVER, EXECUTOR) or null if not found or inactive
   * @throws Error if database query fails
   */
  async getRole(
    organizationId: string,
    memberAddress: string
  ): Promise<Role | null> {
    try {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId,
            memberAddress,
          },
        },
      });

      if (!member) {
        logger.debug('Member not found in organization', {
          organizationId,
          memberAddress,
        });
        return null;
      }

      // Return null if member is inactive
      if (!member.isActive) {
        logger.debug('Member is inactive', {
          organizationId,
          memberAddress,
        });
        return null;
      }

      return member.role as Role;
    } catch (error) {
      logger.error('Failed to get member role', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Check if a Stellar address is an active member of an organization
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @returns True if member exists and is active, false otherwise
   * @throws Error if database query fails
   */
  async isMember(organizationId: string, memberAddress: string): Promise<boolean> {
    try {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId,
            memberAddress,
          },
        },
      });

      const result = member !== null && member.isActive;

      logger.debug('Checked membership status', {
        organizationId,
        memberAddress,
        isMember: result,
      });

      return result;
    } catch (error) {
      logger.error('Failed to check membership', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Check if a member has permission to perform a specific action
   *
   * Uses role-based permission matrix:
   * - EXECUTOR: full permissions
   * - APPROVER: can approve, view members
   * - DRAFTER: can create drafts, view organization
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param permission - The permission to check
   * @returns True if member has permission, false otherwise
   * @throws Error if member not found or database query fails
   */
  async hasPermission(
    organizationId: string,
    memberAddress: string,
    permission: Permission
  ): Promise<boolean> {
    try {
      // Get member's role
      const role = await this.getRole(organizationId, memberAddress);

      if (!role) {
        logger.warn('Member not found or inactive', {
          organizationId,
          memberAddress,
        });
        return false;
      }

      // Check if role has permission
      const permissions = this.permissionMatrix[role];
      const hasPermission = permissions.includes(permission);

      logger.debug('Checked member permission', {
        organizationId,
        memberAddress,
        role,
        permission,
        hasPermission,
      });

      return hasPermission;
    } catch (error) {
      logger.error('Failed to check member permission', error, {
        organizationId,
        memberAddress,
        permission,
      });
      throw error;
    }
  }

  /**
   * Helper method to map Prisma OrganizationMember to DTO
   */
  private mapToDTO(member: any): MemberDTO {
    return {
      id: member.id,
      organizationId: member.organizationId,
      orgAddress: member.orgAddress,
      memberAddress: member.memberAddress,
      role: member.role as Role,
      addedBy: member.addedBy,
      isActive: member.isActive,
      lastActivityAt: member.lastActivityAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }

  /**
   * Get all permissions for a member
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @returns Array of permissions for the member, or empty array if not found
   */
  async getPermissions(
    organizationId: string,
    memberAddress: string
  ): Promise<Permission[]> {
    try {
      const role = await this.getRole(organizationId, memberAddress);

      if (!role) {
        logger.debug('Member not found or inactive', {
          organizationId,
          memberAddress,
        });
        return [];
      }

      return this.permissionMatrix[role];
    } catch (error) {
      logger.error('Failed to get member permissions', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Verify membership across organizations
   * (used for access control)
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @throws Error if member is not part of the organization
   */
  async verifySameOrganization(
    organizationId: string,
    memberAddress: string
  ): Promise<void> {
    const isMember = await this.isMember(organizationId, memberAddress);

    if (!isMember) {
      logger.warn('Cross-organization access attempt detected', {
        organizationId,
        memberAddress,
      });
      throw new Error('Member does not belong to this organization');
    }
  }

  /**
   * Add a new member to an organization
   *
   * **Validates: Requirements 2.4, 3.1, 12.1**
   *
   * - Checks member not already in organization
   * - Creates OrganizationMember record with role
   * - Updates lastActivityAt to now
   * - Audit logs member addition
   * - Returns created member
   *
   * @param orgId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param role - The role to assign (DRAFTER, APPROVER, EXECUTOR)
   * @param addedBy - The Stellar address of the member who added this member
   * @returns Created member DTO
   * @throws Error if member already exists, role is invalid, or database operation fails
   */
  async addMember(
    orgId: string,
    memberAddress: string,
    role: Role,
    addedBy: string
  ): Promise<MemberDTO> {
    try {
      // Validate role is one of the allowed values
      const validRoles: Role[] = ['DRAFTER', 'APPROVER', 'EXECUTOR'];
      if (!validRoles.includes(role)) {
        logger.error('Invalid role provided', new Error(`Invalid role: ${role}`), {
          organizationId: orgId,
          memberAddress,
          role,
        });
        throw new Error(`Invalid role: ${role}. Must be one of: DRAFTER, APPROVER, EXECUTOR`);
      }

      // Check if member already exists in organization
      const existingMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId: orgId,
            memberAddress,
          },
        },
      });

      if (existingMember && existingMember.isActive) {
        logger.warn('Member already exists in organization', {
          organizationId: orgId,
          memberAddress,
          role: existingMember.role,
        });
        throw new Error(`Member ${memberAddress} already exists in organization ${orgId}`);
      }

      // Get organization to retrieve orgAddress (G-address)
      const organization = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { gAddress: true },
      });

      if (!organization) {
        logger.error('Organization not found', new Error('Organization not found'), {
          organizationId: orgId,
        });
        throw new Error('Organization not found');
      }

      const now = new Date();

      // Create organization member
      const member = await prisma.organizationMember.create({
        data: {
          organizationId: orgId,
          orgAddress: organization.gAddress,
          memberAddress,
          role: role as any,
          addedBy,
          isActive: true,
          lastActivityAt: now,
        },
      });

      // Log the member addition action
      await this.logAuditEvent({
        organizationId: orgId,
        actionType: 'member_added',
        actor: addedBy,
        resourceId: memberAddress,
        resourceType: 'member',
        changes: {
          memberAddress,
          role,
          addedBy,
        },
      });

      logger.info('Member added to organization', {
        organizationId: orgId,
        memberAddress,
        role,
        addedBy,
      });

      return this.mapToDTO(member);
    } catch (error) {
      logger.error('Failed to add member to organization', error, {
        organizationId: orgId,
        memberAddress,
        role,
      });
      throw error;
    }
  }

  /**
   * Update a member's role in an organization
   *
   * **Validates: Requirements 3.4, 12.2**
   *
   * - Validates newRole is valid enum
   * - Updates member role
   * - Audit logs role change
   * - Returns updated member
   *
   * @param orgId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param newRole - The new role to assign
   * @param updatedBy - The Stellar address of who is updating the role
   * @returns Updated OrganizationMember
   * @throws Error if member not found, role is invalid, or database operation fails
   */
  async updateRole(
    orgId: string,
    memberAddress: string,
    newRole: Role,
    updatedBy: string
  ): Promise<MemberDTO> {
    try {
      // Validate role is one of the allowed values
      const validRoles: Role[] = ['DRAFTER', 'APPROVER', 'EXECUTOR'];
      if (!validRoles.includes(newRole)) {
        logger.error('Invalid role provided', new Error(`Invalid role: ${newRole}`), {
          organizationId: orgId,
          memberAddress,
          newRole,
        });
        throw new Error(`Invalid role: ${newRole}. Must be one of: DRAFTER, APPROVER, EXECUTOR`);
      }

      // Get current member
      const currentMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId: orgId,
            memberAddress,
          },
        },
      });

      if (!currentMember) {
        logger.error('Member not found in organization', new Error('Member not found'), {
          organizationId: orgId,
          memberAddress,
        });
        throw new Error(`Member ${memberAddress} not found in organization ${orgId}`);
      }

      if (!currentMember.isActive) {
        logger.error('Member is inactive', new Error('Inactive member'), {
          organizationId: orgId,
          memberAddress,
        });
        throw new Error('Member is inactive');
      }

      // Store old role for audit
      const oldRole = currentMember.role;

      // If role hasn't changed, skip update
      if (oldRole === newRole) {
        logger.debug('Role already set to target role, skipping update', {
          organizationId: orgId,
          memberAddress,
          role: newRole,
        });
        return this.mapToDTO(currentMember);
      }

      // Update member role
      const updatedMember = await prisma.organizationMember.update({
        where: {
          organizationId_memberAddress: {
            organizationId: orgId,
            memberAddress,
          },
        },
        data: {
          role: newRole as any,
          lastActivityAt: new Date(),
        },
      });

      // Log the role change
      await this.logAuditEvent({
        organizationId: orgId,
        actionType: 'member_role_changed',
        actor: updatedBy,
        resourceId: memberAddress,
        resourceType: 'member',
        changes: {
          memberAddress,
          oldRole,
          newRole,
          updatedBy,
        },
      });

      logger.info('Member role updated', {
        organizationId: orgId,
        memberAddress,
        oldRole,
        newRole,
        updatedBy,
      });

      return this.mapToDTO(updatedMember);
    } catch (error) {
      logger.error('Failed to update member role', error, {
        organizationId: orgId,
        memberAddress,
        newRole,
      });
      throw error;
    }
  }

  /**
   * Remove a member from an organization (soft delete)
   *
   * **Validates: Requirements 3.5, 4.5, 12.3**
   *
   * - Sets isActive to false (soft delete)
   * - Audit logs removal
   * - Silent ignore on already removed members (no error response)
   *
   * @param orgId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param removedBy - The Stellar address of who is removing this member
   * @returns void (no error if already removed)
   * @throws Error if database operation fails
   */
  async removeMember(
    orgId: string,
    memberAddress: string,
    removedBy: string
  ): Promise<void> {
    try {
      // Find the member to check current state
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_memberAddress: {
            organizationId: orgId,
            memberAddress,
          },
        },
      });

      // Silent ignore if member doesn't exist or already inactive
      if (!member || !member.isActive) {
        logger.debug('Member not found or already inactive, skipping removal', {
          organizationId: orgId,
          memberAddress,
        });
        return;
      }

      // Soft delete by setting isActive to false
      await prisma.organizationMember.update({
        where: {
          organizationId_memberAddress: {
            organizationId: orgId,
            memberAddress,
          },
        },
        data: {
          isActive: false,
        },
      });

      // Log the member removal
      await this.logAuditEvent({
        organizationId: orgId,
        actionType: 'member_removed',
        actor: removedBy,
        resourceId: memberAddress,
        resourceType: 'member',
        changes: {
          memberAddress,
          removedBy,
          isActive: false,
        },
      });

      logger.info('Member removed from organization', {
        organizationId: orgId,
        memberAddress,
        removedBy,
      });
    } catch (error) {
      logger.error('Failed to remove member from organization', error, {
        organizationId: orgId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * List all organizations where a member is active
   *
   * @param memberAddress - The member's Stellar address
   * @returns Array of organizations with member count and current role
   * @throws Error if database query fails
   */
  async listOrganizationsForMember(
    memberAddress: string,
  ): Promise<
    Array<{
      id: string;
      gAddress: string;
      name: string;
      description: string | null;
      logoUrl: string | null;
      isActive: boolean;
      memberCount?: number;
      currentRole?: 'DRAFTER' | 'APPROVER' | 'EXECUTOR';
      createdAt: Date;
    }>
  > {
    try {
      // Get all active memberships for this member
      const memberships = await prisma.organizationMember.findMany({
        where: {
          memberAddress,
          isActive: true,
        },
        include: {
          organization: {
            select: {
              id: true,
              gAddress: true,
              name: true,
              description: true,
              logoUrl: true,
              isActive: true,
              createdAt: true,
            },
          },
        },
      });

      // Build response with member count for each organization
      const organizations = await Promise.all(
        memberships.map(async (membership) => {
          // Count active members in each organization
          const memberCount = await prisma.organizationMember.count({
            where: {
              organizationId: membership.organizationId,
              isActive: true,
            },
          });

          return {
            id: membership.organization.id,
            gAddress: membership.organization.gAddress,
            name: membership.organization.name,
            description: membership.organization.description,
            logoUrl: membership.organization.logoUrl,
            isActive: membership.organization.isActive,
            memberCount,
            currentRole: membership.role,
            createdAt: membership.organization.createdAt,
          };
        }),
      );

      return organizations;
    } catch (error) {
      logger.error('Failed to list organizations for member', error, {
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Log an audit event for member management actions
   *
   * @param data - Audit event data
   * @returns void
   * @throws Error if audit logging fails
   */
  private async logAuditEvent(data: {
    organizationId: string;
    actionType: string;
    actor: string;
    resourceId: string;
    resourceType: string;
    changes: Record<string, any>;
  }): Promise<void> {
    try {
      // Get the latest audit log entry to compute parent hash
      const latestEntry = await prisma.auditLog.findFirst({
        where: { organizationId: data.organizationId },
        orderBy: { createdAt: 'desc' },
        select: { entryHash: true },
      });

      const parentHash = latestEntry?.entryHash ?? null;

      // Compute the entry hash using SHA-256 with parent hash
      const entryContent = {
        actionType: data.actionType,
        actor: data.actor,
        organizationId: data.organizationId,
        resourceId: data.resourceId,
        resourceType: data.resourceType,
        changes: data.changes ? JSON.stringify(data.changes) : null,
      };

      const canonical = JSON.stringify({
        actionType: entryContent.actionType,
        actor: entryContent.actor,
        changes: entryContent.changes,
        organizationId: entryContent.organizationId,
        resourceId: entryContent.resourceId,
        resourceType: entryContent.resourceType,
      });

      const payload = canonical + (parentHash ?? '');
      const entryHash = createHash('sha256').update(payload, 'utf8').digest('hex');

      // Create the audit log entry
      await prisma.auditLog.create({
        data: {
          organizationId: data.organizationId,
          actionType: data.actionType,
          actor: data.actor,
          resourceId: data.resourceId,
          resourceType: data.resourceType,
          changes: data.changes ? JSON.parse(JSON.stringify(data.changes)) : null,
          entryHash,
          parentHash,
          verified: false,
        },
      });

      logger.debug('Audit log entry created for member action', {
        organizationId: data.organizationId,
        actionType: data.actionType,
        entryHash,
      });
    } catch (error) {
      logger.error('Failed to create audit log entry for member action', error, {
        organizationId: data.organizationId,
        actionType: data.actionType,
      });
      throw error;
    }
  }
}

// Export singleton instance
export const organizationMemberService = new OrganizationMemberService();
