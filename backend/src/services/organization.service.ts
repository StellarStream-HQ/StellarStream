import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { createHash } from 'crypto';

/**
 * Regular expression to validate Stellar G-address format
 * G-address: starts with 'G' and is exactly 56 characters long
 */
const G_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export interface CreateOrganizationInput {
  gAddress: string;
  name: string;
  description?: string;
  logoUrl?: string;
  contactEmail?: string;
  creatorAddress: string;
}

export interface UpdateMetadataInput {
  name?: string;
  description?: string | null;
  logoUrl?: string | null;
  customDomain?: string | null;
  contactEmail?: string | null;
  isActive?: boolean;
}

export interface OrganizationDTO {
  id: string;
  gAddress: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  customDomain: string | null;
  contactEmail: string | null;
  createdBy: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditLogData {
  organizationId: string;
  actionType: string;
  actor: string;
  resourceId: string;
  resourceType: string;
  changes?: {
    before: Record<string, any>;
    after: Record<string, any>;
  };
}

export class OrganizationService {
  /**
   * Validate G-address format
   * G-addresses must start with 'G' and be exactly 56 characters long
   */
  private validateGAddress(gAddress: string): boolean {
    return G_ADDRESS_REGEX.test(gAddress);
  }

  /**
   * Create a new organization
   * - Validates G-address format
   * - Checks uniqueness of G-address
   * - Creates organization record
   * - Adds creator as initial EXECUTOR member
   * - Initializes default policy with unlimited spending
   */
  async create(input: CreateOrganizationInput): Promise<OrganizationDTO> {
    const { gAddress, name, description, logoUrl, creatorAddress, contactEmail } = input;

    // Validate G-address format
    if (!this.validateGAddress(gAddress)) {
      logger.error('Invalid G-address format', { gAddress });
      throw new Error(
        'Invalid G-address format. Must start with G and be 56 characters long.'
      );
    }

    // Check if G-address already exists
    const existingOrg = await prisma.organization.findUnique({
      where: { gAddress },
    });

    if (existingOrg) {
      logger.error('Organization with G-address already exists', { gAddress });
      throw new Error(`Organization with G-address ${gAddress} already exists`);
    }

    try {
      // Create organization, member, and policy in a transaction
      const organization = await prisma.organization.create({
        data: {
          gAddress,
          name,
          description: description || null,
          logoUrl: logoUrl || null,
          contactEmail: contactEmail || null,
          createdBy: creatorAddress,
          isActive: true,
        },
      });

      // Add creator as initial EXECUTOR member
      await prisma.organizationMember.create({
        data: {
          organizationId: organization.id,
          orgAddress: gAddress,
          memberAddress: creatorAddress,
          role: 'EXECUTOR',
          addedBy: creatorAddress,
          isActive: true,
        },
      });

      // Initialize default policy with unlimited spending and all assets allowed
      await prisma.organizationPolicy.create({
        data: {
          organizationId: organization.id,
          dailySpendLimitUsd: null, // null = unlimited
          allowedAssets: null, // null = all assets allowed
          requiresMultisig: false,
          multisigThreshold: null,
          updatedBy: creatorAddress,
        },
      });

      // Initialize billing record for current month (FREE plan)
      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      await prisma.billingRecord.create({
        data: {
          organizationId: organization.id,
          billingPeriod,
          streamsCreated: 0,
          disbursementsProcessed: 0,
          apiRequests: 0,
          volumeUsd: 0,
          chargeUsd: 0,
          plan: 'FREE',
          status: 'ACTIVE',
        },
      });

      logger.info('Organization created successfully', {
        organizationId: organization.id,
        gAddress,
        creator: creatorAddress,
      });

      return this.mapToDTO(organization);
    } catch (error) {
      logger.error('Failed to create organization', error, {
        gAddress,
        name,
        creator: creatorAddress,
      });
      throw error;
    }
  }

  /**
   * Get organization by ID
   * Returns null if organization not found
   */
  async getById(orgId: string): Promise<OrganizationDTO | null> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: orgId },
      });

      if (!organization) {
        logger.debug('Organization not found', { organizationId: orgId });
        return null;
      }

      return this.mapToDTO(organization);
    } catch (error) {
      logger.error('Failed to retrieve organization by ID', error, {
        organizationId: orgId,
      });
      throw error;
    }
  }

  /**
   * Get organization by G-address
   * Returns null if organization not found
   */
  async getByAddress(gAddress: string): Promise<OrganizationDTO | null> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { gAddress },
      });

      if (!organization) {
        logger.debug('Organization not found by G-address', { gAddress });
        return null;
      }

      return this.mapToDTO(organization);
    } catch (error) {
      logger.error('Failed to retrieve organization by G-address', error, {
        gAddress,
      });
      throw error;
    }
  }

  /**
   * Update organization metadata (name, description, logo, domain, contact email)
   * - Validates that at least one field is being updated
   * - Supports partial updates (only provided fields are updated)
   * - Logs the update to the audit trail with change details
   * - Returns the updated organization
   */
  async updateMetadata(
    organizationId: string,
    input: UpdateMetadataInput,
    updatedBy?: string
  ): Promise<OrganizationDTO> {
    // Validate that at least one field is being updated
    const hasFieldsToUpdate = Object.values(input).some(value => value !== undefined);
    
    if (!hasFieldsToUpdate) {
      logger.error('No fields provided for metadata update', { organizationId });
      throw new Error('At least one metadata field must be provided for update');
    }

    try {
      // Get current organization state for audit logging
      const currentOrg = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!currentOrg) {
        logger.error('Organization not found for metadata update', {
          organizationId,
        });
        throw new Error(`Organization with ID ${organizationId} not found`);
      }

      // Build update data with only provided fields
      const updateData: Record<string, any> = {};
      const beforeState: Record<string, any> = {};
      const afterState: Record<string, any> = {};

      if (input.name !== undefined) {
        updateData.name = input.name;
        beforeState.name = currentOrg.name;
        afterState.name = input.name;
      }

      if (input.description !== undefined) {
        updateData.description = input.description;
        beforeState.description = currentOrg.description;
        afterState.description = input.description;
      }

      if (input.logoUrl !== undefined) {
        updateData.logoUrl = input.logoUrl;
        beforeState.logoUrl = currentOrg.logoUrl;
        afterState.logoUrl = input.logoUrl;
      }

      if (input.customDomain !== undefined) {
        updateData.customDomain = input.customDomain;
        beforeState.customDomain = currentOrg.customDomain;
        afterState.customDomain = input.customDomain;
      }

      if (input.contactEmail !== undefined) {
        updateData.contactEmail = input.contactEmail;
        beforeState.contactEmail = currentOrg.contactEmail;
        afterState.contactEmail = input.contactEmail;
      }

      if (input.isActive !== undefined) {
        updateData.isActive = input.isActive;
        beforeState.isActive = currentOrg.isActive;
        afterState.isActive = input.isActive;
      }

      // Update the organization
      const updatedOrg = await prisma.organization.update({
        where: { id: organizationId },
        data: updateData,
      });

      // Log the update to audit trail if updatedBy is provided
      if (updatedBy) {
        await this.logAuditEvent({
          organizationId,
          actionType: 'ORGANIZATION_METADATA_UPDATED',
          actor: updatedBy,
          resourceId: organizationId,
          resourceType: 'organization',
          changes: {
            before: beforeState,
            after: afterState,
          },
        });
      }

      logger.info('Organization metadata updated successfully', {
        organizationId,
        updatedBy: updatedBy || 'system',
        changedFields: Object.keys(updateData),
      });

      return this.mapToDTO(updatedOrg);
    } catch (error) {
      logger.error('Failed to update organization metadata', error, {
        organizationId,
        updatedBy: updatedBy || 'system',
      });
      throw error;
    }
  }

  /**
   * Check if organization is active
   * Returns true if organization exists and isActive is true
   * Returns false if organization not found or is inactive
   */
  async isActive(orgId: string): Promise<boolean> {
    try {
      const organization = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { isActive: true },
      });

      return organization?.isActive ?? false;
    } catch (error) {
      logger.error('Failed to check organization active status', error, {
        organizationId: orgId,
      });
      throw error;
    }
  }

  /**
   * Log an audit event for organization actions
   * - Creates an immutable audit log entry with hash chain verification
   * - Computes entry hash based on event content and parent hash
   */
  private async logAuditEvent(data: AuditLogData): Promise<void> {
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

      logger.debug('Audit log entry created', {
        organizationId: data.organizationId,
        actionType: data.actionType,
        entryHash,
      });
    } catch (error) {
      logger.error('Failed to create audit log entry', error, {
        organizationId: data.organizationId,
        actionType: data.actionType,
      });
      throw error;
    }
  }

  /**
   * Helper method to map Prisma organization to DTO
   */
  private mapToDTO(org: any): OrganizationDTO {
    return {
      id: org.id,
      gAddress: org.gAddress,
      name: org.name,
      description: org.description,
      logoUrl: org.logoUrl,
      customDomain: org.customDomain,
      contactEmail: org.contactEmail,
      createdBy: org.createdBy,
      isActive: org.isActive,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }
}

// Export singleton instance
export const organizationService = new OrganizationService();
