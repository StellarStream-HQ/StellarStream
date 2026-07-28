import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';

export type OrgRole = 'DRAFTER' | 'APPROVER' | 'EXECUTOR';

// Role hierarchy — higher index = more permissions
const ROLE_RANK: Record<OrgRole, number> = {
  DRAFTER: 1,
  APPROVER: 2,
  EXECUTOR: 3,
};

/** Returns true if `role` meets or exceeds `required`. */
export function hasMinRole(role: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * Data Transfer Object for Organization Member
 */
export interface MemberDTO {
  id: string;
  organizationId: string;
  orgAddress: string;
  memberAddress: string;
  role: OrgRole;
  addedBy: string;
  isActive: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OrgMemberService {
  /**
   * Resolve the active role for a member within an organization.
   * Returns null if not a member or inactive.
   * 
   * **Validates: Requirements 3.1**
   */
  async getRole(organizationId: string, memberAddress: string): Promise<OrgRole | null> {
    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
      select: { role: true, isActive: true },
    });
    if (!member || !member.isActive) return null;
    return member.role as OrgRole;
  }

  /**
   * Get a specific member from an organization.
   * Returns null if not found or inactive.
   * 
   * **Validates: Requirements 3.1, 12.1**
   */
  async getMember(
    organizationId: string,
    memberAddress: string,
  ): Promise<MemberDTO | null> {
    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
    });

    if (!member || !member.isActive) return null;

    return this.mapToDTO(member);
  }

  /**
   * Check if a Stellar address is an active member of an organization.
   * 
   * **Validates: Requirements 3.1, 12.1**
   */
  async isMember(organizationId: string, memberAddress: string): Promise<boolean> {
    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
    });
    return member !== null && member.isActive;
  }

  /**
   * Add or update a member's role.
   * Only an existing EXECUTOR of the org may call this.
   * 
   * **Validates: Requirements 3.4, 12.2**
   */
  async addMember(
    organizationId: string,
    memberAddress: string,
    role: OrgRole,
    addedBy: string,
  ): Promise<MemberDTO> {
    // Validate role
    const validRoles: OrgRole[] = ['DRAFTER', 'APPROVER', 'EXECUTOR'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Must be one of: DRAFTER, APPROVER, EXECUTOR`);
    }

    // Check if member already exists and is active
    const existingMember = await prisma.organizationMember.findUnique({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
    });

    if (existingMember && existingMember.isActive) {
      throw new Error(`Member ${memberAddress} already exists in organization`);
    }

    // Get organization to retrieve orgAddress (G-address)
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { gAddress: true },
    });

    if (!organization) {
      throw new Error('Organization not found');
    }

    // Create or update member
    const member = await prisma.organizationMember.upsert({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
      create: {
        organizationId,
        orgAddress: organization.gAddress,
        memberAddress,
        role,
        addedBy,
        isActive: true,
        lastActivityAt: new Date(),
      },
      update: {
        role,
        addedBy,
        isActive: true,
        lastActivityAt: new Date(),
      },
    });

    // Log the member addition action
    await this.logAuditEvent({
      organizationId,
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
      organizationId,
      memberAddress,
      role,
      addedBy,
    });

    return this.mapToDTO(member);
  }

  /**
   * Deactivate a member (soft-delete).
   * 
   * **Validates: Requirements 3.5, 12.3**
   */
  async removeMember(
    organizationId: string,
    memberAddress: string,
    removedBy?: string,
  ): Promise<void> {
    // Find the member to check current state
    const member = await prisma.organizationMember.findUnique({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
    });

    // Silent ignore if member doesn't exist or already inactive
    if (!member || !member.isActive) {
      logger.debug('Member not found or already inactive, skipping removal', {
        organizationId,
        memberAddress,
      });
      return;
    }

    // Soft delete by setting isActive to false
    await prisma.organizationMember.update({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
      data: { isActive: false },
    });

    // Log the member removal if removedBy is provided
    if (removedBy) {
      await this.logAuditEvent({
        organizationId,
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
    }

    logger.info('Member removed from organization', {
      organizationId,
      memberAddress,
      removedBy,
    });
  }

  /**
   * List all active members of an organization.
   * 
   * **Validates: Requirements 3.1, 12.1**
   */
  async listMembers(organizationId: string): Promise<MemberDTO[]> {
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
  }

  /**
   * Upsert a member (used by legacy routes).
   * Only an existing EXECUTOR of the org may call this.
   */
  async upsertMember(
    organizationId: string,
    memberAddress: string,
    role: OrgRole,
    addedBy: string,
  ): Promise<void> {
    await prisma.organizationMember.upsert({
      where: { organizationId_memberAddress: { organizationId, memberAddress } },
      create: { organizationId, memberAddress, role, addedBy, isActive: true },
      update: { role, addedBy, isActive: true },
    });
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
      role: member.role as OrgRole,
      addedBy: member.addedBy,
      isActive: member.isActive,
      lastActivityAt: member.lastActivityAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }

  /**
   * Log an audit event for member management actions
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
      const { createHash } = await import('crypto');
      const canonical = JSON.stringify({
        actionType: data.actionType,
        actor: data.actor,
        changes: JSON.stringify(data.changes),
        organizationId: data.organizationId,
        resourceId: data.resourceId,
        resourceType: data.resourceType,
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
          changes: data.changes,
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
export const orgMemberService = new OrgMemberService();
