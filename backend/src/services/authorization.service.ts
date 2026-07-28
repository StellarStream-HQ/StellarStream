import { logger } from '../logger.js';
import { organizationMemberService } from './organization-member.service.js';

/**
 * Action types supported by the authorization service
 */
export type Action =
  | 'create_stream'
  | 'create_disbursement'
  | 'approve_disbursement'
  | 'execute_disbursement'
  | 'manage_members'
  | 'manage_policy'
  | 'update_settings'
  | 'view_members'
  | 'view_organization';

/**
 * Permission type
 */
export type Permission =
  | 'create_stream'
  | 'create_disbursement'
  | 'approve_disbursement'
  | 'execute_disbursement'
  | 'manage_members'
  | 'manage_policy'
  | 'update_settings'
  | 'view_members'
  | 'view_organization';

/**
 * Authorization context for additional checks
 */
export interface AuthorizationContext {
  resourceOrgAddress?: string;
  resourceId?: string;
  highRiskOperation?: boolean;
  amount?: number;
}

/**
 * Custom error for authorization failures
 */
export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 403,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * AuthorizationService
 *
 * Enforces role-based access control and permission checks for organization members.
 * Implements the authorization matrix where different roles have different permissions:
 * - EXECUTOR: Full permissions (all actions)
 * - APPROVER: Can approve and view, limited creation
 * - DRAFTER: Can create drafts and view
 *
 * **Validates: Requirements 3.1, 3.2, 3.3 (Role-based access control, authorization matrix, action validation)**
 */
export class AuthorizationService {
  /**
   * Check if a member can perform a specific action
   * Throws AuthorizationError if unauthorized
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param action - The action to authorize
   * @param context - Optional authorization context for additional checks
   * @throws AuthorizationError if member is unauthorized or does not belong to organization
   * @throws Error if database query fails
   */
  async authorize(
    organizationId: string,
    memberAddress: string,
    action: Action,
    context?: AuthorizationContext
  ): Promise<void> {
    try {
      // Verify member exists and belongs to organization
      const member = await organizationMemberService.getMember(
        organizationId,
        memberAddress
      );

      if (!member) {
        logger.warn('Authorization check on non-member', {
          organizationId,
          memberAddress,
          action,
        });
        throw new AuthorizationError('Unauthorized', 403);
      }

      // Verify cross-organization access if resourceOrgAddress is provided
      if (context?.resourceOrgAddress && context.resourceOrgAddress !== member.orgAddress) {
        logger.warn('Cross-organization access attempt detected', {
          organizationId,
          memberAddress,
          resourceOrgAddress: context.resourceOrgAddress,
          action,
        });
        throw new AuthorizationError('Not found', 404); // 404 to avoid leaking org existence
      }

      // Check if member has permission for the action
      const hasPermission = await organizationMemberService.hasPermission(
        organizationId,
        memberAddress,
        action
      );

      if (!hasPermission) {
        logger.warn('Authorization denied', {
          organizationId,
          memberAddress,
          action,
          role: member.role,
        });
        throw new AuthorizationError('Forbidden', 403);
      }

      logger.debug('Authorization granted', {
        organizationId,
        memberAddress,
        action,
        role: member.role,
      });
    } catch (error) {
      // Re-throw AuthorizationError as-is
      if (error instanceof AuthorizationError) {
        throw error;
      }

      // Log unexpected errors
      logger.error('Authorization check failed', error, {
        organizationId,
        memberAddress,
        action,
      });
      throw error;
    }
  }

  /**
   * Get all permissions available to a member
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @returns Array of permissions the member has
   * @throws Error if member not found or database query fails
   */
  async getPermissions(
    organizationId: string,
    memberAddress: string
  ): Promise<Permission[]> {
    try {
      const permissions = await organizationMemberService.getPermissions(
        organizationId,
        memberAddress
      );

      logger.debug('Retrieved member permissions', {
        organizationId,
        memberAddress,
        permissionCount: permissions.length,
      });

      return permissions as Permission[];
    } catch (error) {
      logger.error('Failed to get member permissions', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Require permission or throw error
   * Convenience method that throws if member lacks required permission
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @param action - The action to require
   * @throws AuthorizationError if member lacks permission
   * @throws Error if database query fails
   */
  async requirePermission(
    organizationId: string,
    memberAddress: string,
    action: Action
  ): Promise<void> {
    await this.authorize(organizationId, memberAddress, action);
  }

  /**
   * Verify that a member belongs to the given organization
   * Returns 404 on cross-org access to prevent information leakage
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @throws AuthorizationError with 404 if member does not belong to organization
   * @throws Error if database query fails
   */
  async verifySameOrganization(
    organizationId: string,
    memberAddress: string
  ): Promise<void> {
    try {
      const isMember = await organizationMemberService.isMember(
        organizationId,
        memberAddress
      );

      if (!isMember) {
        logger.warn('Cross-organization access attempt', {
          organizationId,
          memberAddress,
        });
        throw new AuthorizationError('Not found', 404); // 404 to avoid leaking org existence
      }

      logger.debug('Organization membership verified', {
        organizationId,
        memberAddress,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw error;
      }

      logger.error('Organization verification failed', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Check if a member has admin/EXECUTOR role in organization
   * Used for operations that require admin permissions
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @throws AuthorizationError with 403 if member is not EXECUTOR
   * @throws Error if database query fails
   */
  async requireAdmin(
    organizationId: string,
    memberAddress: string
  ): Promise<void> {
    try {
      const role = await organizationMemberService.getRole(
        organizationId,
        memberAddress
      );

      if (role !== 'EXECUTOR') {
        logger.warn('Admin permission required but member is not EXECUTOR', {
          organizationId,
          memberAddress,
          role,
        });
        throw new AuthorizationError('Forbidden', 403);
      }

      logger.debug('Admin permission verified', {
        organizationId,
        memberAddress,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw error;
      }

      logger.error('Admin verification failed', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Require EXECUTOR role
   * Throws error if member does not have EXECUTOR role
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @throws AuthorizationError with 403 if member is not EXECUTOR
   * @throws Error if database query fails
   */
  async requireExecutor(
    organizationId: string,
    memberAddress: string
  ): Promise<void> {
    await this.requireAdmin(organizationId, memberAddress);
  }

  /**
   * Require APPROVER or EXECUTOR role
   * Throws error if member does not have APPROVER+ role
   *
   * @param organizationId - The organization ID
   * @param memberAddress - The member's Stellar address
   * @throws AuthorizationError with 403 if member is not APPROVER+
   * @throws Error if database query fails
   */
  async requireApprover(
    organizationId: string,
    memberAddress: string
  ): Promise<void> {
    try {
      const role = await organizationMemberService.getRole(
        organizationId,
        memberAddress
      );

      if (role !== 'APPROVER' && role !== 'EXECUTOR') {
        logger.warn('APPROVER+ permission required but member is insufficient role', {
          organizationId,
          memberAddress,
          role,
        });
        throw new AuthorizationError('Forbidden', 403);
      }

      logger.debug('APPROVER+ permission verified', {
        organizationId,
        memberAddress,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw error;
      }

      logger.error('APPROVER verification failed', error, {
        organizationId,
        memberAddress,
      });
      throw error;
    }
  }
}

// Export singleton instance
export const authorizationService = new AuthorizationService();
