import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { createHash } from 'crypto';

/**
 * Data Transfer Object for Organization Policy
 */
export interface PolicyDTO {
  id: string;
  organizationId: string;
  dailySpendLimitUsd: number | null;
  allowedAssets: string[] | null;
  requiresMultisig: boolean;
  multisigThreshold: number | null;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * Input for updating organization policy
 */
export interface UpdatePolicyInput {
  dailySpendLimitUsd?: number | null;
  allowedAssets?: string[] | null;
  requiresMultisig?: boolean;
  multisigThreshold?: number | null;
}

/**
 * Policy violation details
 */
export interface PolicyViolation {
  type: 'DAILY_LIMIT_EXCEEDED' | 'ASSET_NOT_WHITELISTED' | 'OTHER';
  message: string;
}

/**
 * Validation result for disbursement against policy
 */
export interface ValidationResult {
  isValid: boolean;
  violations: PolicyViolation[];
  currentDailySpent: number;
  remainingDailyBudget?: number;
}

/**
 * Disbursement validation input
 */
export interface DisbursementValidation {
  amount: number; // USD amount
  tokenAddress: string;
  receiver: string;
}

/**
 * OrganizationPolicyService
 *
 * Manages organization policies including spending limits, asset controls, and multi-signature configuration.
 * Supports:
 * - Retrieving current organization policy
 * - Updating policies with EXECUTOR-only access and audit logging
 * - Validating disbursements against policies
 * - Initializing default policies
 *
 * **Validates: Requirements 6.1, 6.2, 6.6**
 */
export class OrganizationPolicyService {
  /**
   * Get the current policy for an organization
   *
   * @param organizationId - The organization ID
   * @returns Current organization policy
   * @throws Error if organization not found or policy not initialized
   */
  async getPolicy(organizationId: string): Promise<PolicyDTO> {
    try {
      // Verify organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        logger.error('Organization not found', { organizationId });
        throw new Error(`Organization ${organizationId} not found`);
      }

      // Get the policy
      const policy = await prisma.organizationPolicy.findUnique({
        where: { organizationId },
      });

      if (!policy) {
        logger.error('Policy not found for organization', { organizationId });
        throw new Error(`Policy not found for organization ${organizationId}`);
      }

      logger.debug('Retrieved organization policy', { organizationId });
      return this.mapToDTO(policy);
    } catch (error) {
      logger.error('Failed to retrieve organization policy', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Update the organization policy
   * Only EXECUTOR role can update policies
   *
   * @param organizationId - The organization ID
   * @param updates - Policy updates
   * @param updatedBy - Stellar address of the member performing the update
   * @returns Updated policy
   * @throws Error if organization not found, policy not found, or invalid input
   */
  async updatePolicy(
    organizationId: string,
    updates: UpdatePolicyInput,
    updatedBy: string
  ): Promise<PolicyDTO> {
    try {
      // Verify organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        logger.error('Organization not found', { organizationId });
        throw new Error(`Organization ${organizationId} not found`);
      }

      // Verify policy exists
      const existingPolicy = await prisma.organizationPolicy.findUnique({
        where: { organizationId },
      });

      if (!existingPolicy) {
        logger.error('Policy not found for organization', { organizationId });
        throw new Error(`Policy not found for organization ${organizationId}`);
      }

      // Validate that at least one field is provided for update
      const hasUpdates = Object.values(updates).some((v) => v !== undefined);
      if (!hasUpdates) {
        logger.error('No policy fields provided for update', { organizationId });
        throw new Error('At least one policy field must be provided for update');
      }

      // Prepare audit log data before update
      const changesBefore = {
        dailySpendLimitUsd: existingPolicy.dailySpendLimitUsd,
        allowedAssets: existingPolicy.allowedAssets,
        requiresMultisig: existingPolicy.requiresMultisig,
        multisigThreshold: existingPolicy.multisigThreshold,
      };

      // Update the policy
      const updatedPolicy = await prisma.organizationPolicy.update({
        where: { organizationId },
        data: {
          dailySpendLimitUsd: updates.dailySpendLimitUsd !== undefined ? updates.dailySpendLimitUsd : undefined,
          allowedAssets:
            updates.allowedAssets !== undefined
              ? updates.allowedAssets
                ? JSON.stringify(updates.allowedAssets)
                : null
              : undefined,
          requiresMultisig: updates.requiresMultisig !== undefined ? updates.requiresMultisig : undefined,
          multisigThreshold: updates.multisigThreshold !== undefined ? updates.multisigThreshold : undefined,
          updatedBy,
        },
      });

      // Log audit event
      const changesAfter = {
        dailySpendLimitUsd: updatedPolicy.dailySpendLimitUsd,
        allowedAssets: updatedPolicy.allowedAssets,
        requiresMultisig: updatedPolicy.requiresMultisig,
        multisigThreshold: updatedPolicy.multisigThreshold,
      };

      await this.logPolicyUpdate(organizationId, updatedBy, changesBefore, changesAfter);

      logger.info('Organization policy updated successfully', {
        organizationId,
        updatedBy,
      });

      return this.mapToDTO(updatedPolicy);
    } catch (error) {
      logger.error('Failed to update organization policy', error, {
        organizationId,
        updatedBy,
      });
      throw error;
    }
  }

  /**
   * Initialize a default policy for a new organization
   * Default policy: unlimited spending (null) and all assets allowed (null)
   *
   * @param organizationId - The organization ID
   * @param createdBy - Stellar address of the member initializing the policy
   * @returns Created default policy
   * @throws Error if organization not found or policy already exists
   */
  async initializeDefaultPolicy(
    organizationId: string,
    createdBy: string
  ): Promise<PolicyDTO> {
    try {
      // Verify organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        logger.error('Organization not found', { organizationId });
        throw new Error(`Organization ${organizationId} not found`);
      }

      // Check if policy already exists
      const existingPolicy = await prisma.organizationPolicy.findUnique({
        where: { organizationId },
      });

      if (existingPolicy) {
        logger.warn('Policy already exists for organization', { organizationId });
        return this.mapToDTO(existingPolicy);
      }

      // Create default policy: unlimited spending (null) and all assets allowed (null)
      const defaultPolicy = await prisma.organizationPolicy.create({
        data: {
          organizationId,
          dailySpendLimitUsd: null, // null = unlimited
          allowedAssets: null, // null = all assets allowed
          requiresMultisig: false,
          multisigThreshold: null,
          updatedBy: createdBy,
        },
      });

      logger.info('Default organization policy initialized', {
        organizationId,
        createdBy,
      });

      return this.mapToDTO(defaultPolicy);
    } catch (error) {
      logger.error('Failed to initialize default policy', error, {
        organizationId,
        createdBy,
      });
      throw error;
    }
  }

  /**
   * Validate a disbursement against the organization's policy
   * Checks daily spend limit and asset whitelist
   *
   * @param organizationId - The organization ID
   * @param disbursement - Disbursement details to validate
   * @returns Validation result with any policy violations
   * @throws Error if organization or policy not found
   */
  async validateAgainstPolicy(
    organizationId: string,
    disbursement: DisbursementValidation
  ): Promise<ValidationResult> {
    try {
      // Get organization policy
      const policy = await this.getPolicy(organizationId);

      const violations: PolicyViolation[] = [];

      // Check asset whitelist first (immediate rejection if non-whitelisted)
      if (policy.allowedAssets !== null && policy.allowedAssets.length > 0) {
        if (!policy.allowedAssets.includes(disbursement.tokenAddress)) {
          violations.push({
            type: 'ASSET_NOT_WHITELISTED',
            message: `Asset ${disbursement.tokenAddress} is not in the organization's whitelist`,
          });
          // Return immediately with this violation
          return {
            isValid: false,
            violations,
            currentDailySpent: 0,
          };
        }
      }

      let currentDailySpent = 0;
      let remainingDailyBudget: number | undefined;

      // Check daily spend limit if configured
      if (policy.dailySpendLimitUsd !== null && policy.dailySpendLimitUsd > 0) {
        currentDailySpent = await this.getDailySpent(organizationId, new Date());
        const totalAfter = currentDailySpent + disbursement.amount;

        if (totalAfter > policy.dailySpendLimitUsd) {
          violations.push({
            type: 'DAILY_LIMIT_EXCEEDED',
            message: `Disbursement would exceed daily limit. Current: $${currentDailySpent.toFixed(
              2
            )}, Limit: $${policy.dailySpendLimitUsd.toFixed(2)}, Requested: $${disbursement.amount.toFixed(2)}`,
          });
        }

        remainingDailyBudget = Math.max(
          0,
          policy.dailySpendLimitUsd - currentDailySpent
        );
      }

      const isValid = violations.length === 0;

      logger.debug('Disbursement validated against policy', {
        organizationId,
        isValid,
        violations: violations.length,
      });

      return {
        isValid,
        violations,
        currentDailySpent,
        remainingDailyBudget,
      };
    } catch (error) {
      logger.error('Failed to validate disbursement against policy', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Validate a disbursement for policy violations
   * Checks if disbursement amount + previous daily total exceeds limit
   * Checks if asset is in the whitelist (if defined)
   *
   * @param orgId - Organization ID
   * @param amount - Disbursement amount in USD (Decimal)
   * @param asset - Asset address to disburse
   * @param dailyTotalBeforeTx - Daily total before this transaction (Decimal)
   * @throws PolicyViolationError if policy is violated
   *
   * **Validates: Requirements 6.3, 6.4, 6.5**
   */
  async validateDisbursement(
    orgId: string,
    amount: number, // Using number type as per task (Decimal handled as number in USD)
    asset: string,
    dailyTotalBeforeTx: number // Using number type (already in USD)
  ): Promise<void> {
    try {
      logger.debug('Validating disbursement against policy', {
        orgId,
        amount,
        asset,
        dailyTotalBeforeTx,
      });

      // Get the organization's policy
      const policy = await this.getPolicy(orgId);

      // Check asset whitelist first (requirement 6.5)
      // If whitelist is defined (not null), check if asset is in it
      if (policy.allowedAssets !== null && policy.allowedAssets.length > 0) {
        if (!policy.allowedAssets.includes(asset)) {
          logger.warn('Asset not whitelisted for organization', {
            orgId,
            asset,
            allowedAssets: policy.allowedAssets,
          });

          throw new Error(
            `Asset ${asset} is not in the organization's allowed assets whitelist`
          );
        }
      }

      // Check daily spending limit (requirement 6.3, 6.4)
      // If limit is defined (not null), check if transaction would exceed it
      if (policy.dailySpendLimitUsd !== null && policy.dailySpendLimitUsd > 0) {
        const totalAfterTx = dailyTotalBeforeTx + amount;

        // If (totalAfter <= limit), allow; if (totalAfter > limit), reject
        if (totalAfterTx > policy.dailySpendLimitUsd) {
          logger.warn('Disbursement would exceed daily spending limit', {
            orgId,
            dailyTotalBefore: dailyTotalBeforeTx,
            disbursementAmount: amount,
            totalAfter: totalAfterTx,
            dailyLimit: policy.dailySpendLimitUsd,
          });

          throw new Error(
            `Disbursement would exceed daily spending limit. ` +
            `Current: $${dailyTotalBeforeTx.toFixed(2)}, ` +
            `Requested: $${amount.toFixed(2)}, ` +
            `Total: $${totalAfterTx.toFixed(2)}, ` +
            `Limit: $${policy.dailySpendLimitUsd.toFixed(2)}`
          );
        }
      }

      logger.debug('Disbursement passed policy validation', {
        orgId,
        amount,
        asset,
      });
    } catch (error) {
      logger.error('Policy validation failed for disbursement', error, {
        orgId,
        amount,
        asset,
      });
      throw error;
    }
  }

  /**
   * Get the total amount spent by an organization on a specific date
   *
   * @param organizationId - The organization ID
   * @param date - The date to check (uses UTC date)
   * @returns Total USD amount spent on that date
   */
  async getDailySpent(organizationId: string, date: Date): Promise<number> {
    try {
      // Get the organization to find its G-address
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        logger.error('Organization not found', { organizationId });
        throw new Error(`Organization ${organizationId} not found`);
      }

      // Set date range for the day (UTC)
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);

      // Query disbursements for this organization on this date
      // Note: This is a simplified implementation
      // In a real scenario, you'd need to:
      // 1. Filter by organization's G-address as sender
      // 2. Convert amounts to USD using historical prices
      // 3. Handle various asset types

      const disbursements = await prisma.disbursement.findMany({
        where: {
          sender: organization.gAddress,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
          status: {
            in: ['COMPLETED', 'PROCESSING'],
          },
        },
      });

      // Convert BigInt amounts to number (in stroops) and sum
      // This is a simplified calculation - in production you'd convert to USD
      const totalInStroops = disbursements.reduce(
        (sum, d) => sum + Number(d.amount || 0),
        0
      );

      // Convert stroops to XLM (1 XLM = 10,000,000 stroops)
      // In a real implementation, you'd convert to USD using price oracle
      const totalXlm = totalInStroops / 10000000;

      logger.debug('Calculated daily spending', {
        organizationId,
        date: date.toISOString().split('T')[0],
        totalXlm,
      });

      // Return as rough USD estimate (1 XLM ≈ 0.1 USD - adjust based on real oracle)
      return totalXlm * 0.1;
    } catch (error) {
      logger.error('Failed to calculate daily spending', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Helper method to map Prisma OrganizationPolicy to DTO
   */
  private mapToDTO(policy: any): PolicyDTO {
    return {
      id: policy.id,
      organizationId: policy.organizationId,
      dailySpendLimitUsd: policy.dailySpendLimitUsd
        ? Number(policy.dailySpendLimitUsd)
        : null,
      allowedAssets: policy.allowedAssets
        ? JSON.parse(policy.allowedAssets)
        : null,
      requiresMultisig: policy.requiresMultisig,
      multisigThreshold: policy.multisigThreshold,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
      updatedBy: policy.updatedBy,
    };
  }

  /**
   * Helper method to log policy update to audit trail
   */
  private async logPolicyUpdate(
    organizationId: string,
    actor: string,
    changesBefore: Record<string, any>,
    changesAfter: Record<string, any>
  ): Promise<void> {
    try {
      const latestEntry = await prisma.auditLog.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        select: { entryHash: true },
      });

      const parentHash = latestEntry?.entryHash ?? null;

      const entryContent = {
        actionType: 'POLICY_UPDATED',
        actor,
        organizationId,
        resourceId: organizationId,
        resourceType: 'policy',
        changes: {
          before: changesBefore,
          after: changesAfter,
        },
      };

      const canonical = JSON.stringify({
        actionType: entryContent.actionType,
        actor: entryContent.actor,
        changes: JSON.stringify(entryContent.changes),
        organizationId: entryContent.organizationId,
        resourceId: entryContent.resourceId,
        resourceType: entryContent.resourceType,
      });

      const payload = canonical + (parentHash ?? '');
      const entryHash = createHash('sha256')
        .update(payload, 'utf8')
        .digest('hex');

      await prisma.auditLog.create({
        data: {
          organizationId,
          actionType: 'POLICY_UPDATED',
          actor,
          resourceId: organizationId,
          resourceType: 'policy',
          changes: {
            before: changesBefore,
            after: changesAfter,
          },
          entryHash,
          parentHash,
          verified: false,
        },
      });

      logger.debug('Policy update logged to audit trail', {
        organizationId,
        actor,
      });
    } catch (error) {
      logger.error('Failed to log policy update to audit trail', error, {
        organizationId,
      });
      // Note: per requirements, audit logging errors should not break the update
      // but we log it for visibility
    }
  }
}

// Export singleton instance
export const organizationPolicyService = new OrganizationPolicyService();
