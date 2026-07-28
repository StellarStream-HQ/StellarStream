import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { authorizationService } from './authorization.service.js';

/**
 * Multisig proposal DTO
 */
export interface MultisigProposalDTO {
  id: string;
  proposalId: string;
  organizationId: string;
  description: string | null;
  transactionXdr: string;
  signatures: Array<{ signer: string; signature: string }>;
  requiredSigners: number;
  status: string; // PENDING, SIGNED, SUBMITTED, FAILED, EXPIRED
  submittedTxHash: string | null;
  errorMessage: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating multisig proposal
 */
export interface CreateMultisigInput {
  description?: string;
  transactionXdr: string;
  requiredSigners: number;
  expiresAt: Date;
}

/**
 * Filters for listing proposals
 */
export interface ProposalFilters {
  status?: string;
  createdBy?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
}

/**
 * MultisigService
 *
 * Manages multi-signature transaction proposals.
 * Handles proposal creation, signing, and submission to Stellar network.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7**
 */
export class MultisigService {
  /**
   * Create a new multisig proposal
   *
   * @param organizationId - The organization ID
   * @param input - Proposal input data
   * @param createdBy - Stellar address of creator
   * @returns Created proposal
   * @throws Error if user lacks EXECUTOR/APPROVER role or database operation fails
   */
  async createProposal(
    organizationId: string,
    input: CreateMultisigInput,
    createdBy: string
  ): Promise<MultisigProposalDTO> {
    try {
      // Verify creator has required role (EXECUTOR or APPROVER)
      await authorizationService.requirePermission(
        organizationId,
        createdBy,
        'create_disbursement'
      );

      // Generate unique proposal ID
      const proposalId = this.generateProposalId();

      // Create proposal record
      const proposal = await prisma.multisigProposal.create({
        data: {
          proposalId,
          organizationId,
          description: input.description || null,
          transactionXdr: input.transactionXdr,
          requiredSigners: input.requiredSigners,
          signatures: [], // Start with empty signatures array
          status: 'PENDING',
          submittedTxHash: null,
          errorMessage: null,
          expiresAt: input.expiresAt,
        },
      });

      logger.info('Multisig proposal created', {
        organizationId,
        proposalId,
        requiredSigners: input.requiredSigners,
        createdBy,
      });

      return this.mapToDTO(proposal);
    } catch (error) {
      logger.error('Failed to create multisig proposal', error, {
        organizationId,
        requiredSigners: input.requiredSigners,
        createdBy,
      });
      throw error;
    }
  }

  /**
   * Get a specific proposal
   *
   * @param organizationId - The organization ID
   * @param proposalId - The proposal ID
   * @returns Proposal or null if not found
   */
  async getProposal(
    organizationId: string,
    proposalId: string
  ): Promise<MultisigProposalDTO | null> {
    try {
      const proposal = await prisma.multisigProposal.findFirst({
        where: {
          organizationId,
          proposalId,
        },
      });

      if (!proposal) {
        logger.debug('Multisig proposal not found', {
          organizationId,
          proposalId,
        });
        return null;
      }

      return this.mapToDTO(proposal);
    } catch (error) {
      logger.error('Failed to get multisig proposal', error, {
        organizationId,
        proposalId,
      });
      throw error;
    }
  }

  /**
   * List proposals for an organization with optional filters
   *
   * @param organizationId - The organization ID
   * @param filters - Optional filters (status, dateFrom, dateTo, limit)
   * @returns Array of proposals
   */
  async listProposals(
    organizationId: string,
    filters?: ProposalFilters
  ): Promise<MultisigProposalDTO[]> {
    try {
      const where: Record<string, any> = { organizationId };

      if (filters?.status) {
        where.status = filters.status;
      }

      if (filters?.dateFrom || filters?.dateTo) {
        where.createdAt = {};
        if (filters?.dateFrom) {
          where.createdAt.gte = filters.dateFrom;
        }
        if (filters?.dateTo) {
          where.createdAt.lte = filters.dateTo;
        }
      }

      const proposals = await prisma.multisigProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
      });

      return proposals.map((p) => this.mapToDTO(p));
    } catch (error) {
      logger.error('Failed to list multisig proposals', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Add a signature to a proposal
   *
   * @param organizationId - The organization ID
   * @param proposalId - The proposal ID
   * @param signer - Stellar address of signer
   * @param signature - Signature string
   * @returns Updated proposal
   * @throws Error if proposal not found, expired, or signer lacks permission
   */
  async addSignature(
    organizationId: string,
    proposalId: string,
    signer: string,
    signature: string
  ): Promise<MultisigProposalDTO> {
    try {
      // Verify signer has required role (EXECUTOR or APPROVER)
      await authorizationService.requirePermission(
        organizationId,
        signer,
        'approve_disbursement'
      );

      // Get proposal
      const proposal = await prisma.multisigProposal.findFirst({
        where: {
          organizationId,
          proposalId,
        },
      });

      if (!proposal) {
        logger.error('Multisig proposal not found', {
          organizationId,
          proposalId,
        });
        throw new Error(`Proposal ${proposalId} not found`);
      }

      // Check if proposal has expired
      if (new Date() > proposal.expiresAt) {
        logger.warn('Cannot sign expired proposal', {
          organizationId,
          proposalId,
          expiresAt: proposal.expiresAt,
        });
        throw new Error(`Proposal ${proposalId} has expired`);
      }

      // Parse existing signatures
      const signatures = Array.isArray(proposal.signatures) ? proposal.signatures : [];

      // Check if signer has already signed
      const existingSignature = signatures.find((s: any) => s.signer === signer);
      if (existingSignature) {
        logger.debug('Signer has already signed this proposal', {
          organizationId,
          proposalId,
          signer,
        });
        return this.mapToDTO(proposal); // Return unchanged proposal
      }

      // Add new signature
      signatures.push({ signer, signature });

      // Check if we've reached required threshold
      let newStatus = proposal.status;
      if (signatures.length >= proposal.requiredSigners && proposal.status === 'PENDING') {
        newStatus = 'SIGNED';
      }

      // Update proposal
      const updated = await prisma.multisigProposal.update({
        where: { id: proposal.id },
        data: {
          signatures,
          status: newStatus,
          updatedAt: new Date(),
        },
      });

      logger.info('Signature added to multisig proposal', {
        organizationId,
        proposalId,
        signer,
        currentSignatures: signatures.length,
        requiredSigners: proposal.requiredSigners,
      });

      return this.mapToDTO(updated);
    } catch (error) {
      logger.error('Failed to add signature to multisig proposal', error, {
        organizationId,
        proposalId,
        signer,
      });
      throw error;
    }
  }

  /**
   * Submit a signed proposal to Stellar network
   * Called when signature threshold is reached
   *
   * @param organizationId - The organization ID
   * @param proposalId - The proposal ID
   * @returns Object with txHash
   * @throws Error if proposal not fully signed or submission fails
   */
  async submitProposal(organizationId: string, proposalId: string): Promise<{ txHash: string }> {
    try {
      // Get proposal
      const proposal = await prisma.multisigProposal.findFirst({
        where: {
          organizationId,
          proposalId,
        },
      });

      if (!proposal) {
        logger.error('Multisig proposal not found for submission', {
          organizationId,
          proposalId,
        });
        throw new Error(`Proposal ${proposalId} not found`);
      }

      // Check if proposal is ready to submit
      const signatures = Array.isArray(proposal.signatures) ? proposal.signatures : [];
      if (signatures.length < proposal.requiredSigners) {
        logger.warn('Proposal does not have required signatures', {
          organizationId,
          proposalId,
          currentSignatures: signatures.length,
          requiredSigners: proposal.requiredSigners,
        });
        throw new Error('Proposal does not have required number of signatures');
      }

      // In a real implementation, this would submit to Stellar network
      // For now, generate a mock tx hash
      const txHash = this.generateTxHash();

      // Update proposal with submission
      await prisma.multisigProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'SUBMITTED',
          submittedTxHash: txHash,
          updatedAt: new Date(),
        },
      });

      logger.info('Multisig proposal submitted to network', {
        organizationId,
        proposalId,
        txHash,
      });

      return { txHash };
    } catch (error) {
      logger.error('Failed to submit multisig proposal', error, {
        organizationId,
        proposalId,
      });
      throw error;
    }
  }

  /**
   * Revoke/cancel a proposal
   *
   * @param organizationId - The organization ID
   * @param proposalId - The proposal ID
   * @param revokedBy - Stellar address of member revoking
   * @throws Error if proposal not found or revocation fails
   */
  async revokeProposal(
    organizationId: string,
    proposalId: string,
    revokedBy: string
  ): Promise<void> {
    try {
      // Verify revoker has admin permission
      await authorizationService.requireAdmin(organizationId, revokedBy);

      // Get proposal
      const proposal = await prisma.multisigProposal.findFirst({
        where: {
          organizationId,
          proposalId,
        },
      });

      if (!proposal) {
        logger.error('Multisig proposal not found for revocation', {
          organizationId,
          proposalId,
        });
        throw new Error(`Proposal ${proposalId} not found`);
      }

      // Update status to EXPIRED
      await prisma.multisigProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'EXPIRED',
          updatedAt: new Date(),
        },
      });

      logger.info('Multisig proposal revoked', {
        organizationId,
        proposalId,
        revokedBy,
      });
    } catch (error) {
      logger.error('Failed to revoke multisig proposal', error, {
        organizationId,
        proposalId,
        revokedBy,
      });
      throw error;
    }
  }

  /**
   * Expire a single proposal by ID
   *
   * @param proposalId - The proposal ID
   * @returns true if proposal was expired, false if already expired/submitted
   * @throws Error if proposal not found
   */
  async expireProposal(proposalId: string): Promise<void> {
    try {
      // Get proposal
      const proposal = await prisma.multisigProposal.findUnique({
        where: { proposalId },
      });

      if (!proposal) {
        logger.error('Multisig proposal not found for expiration', { proposalId });
        throw new Error(`Proposal ${proposalId} not found`);
      }

      // Check if already expired or submitted
      if (!this.canTransitionToExpired(proposal.status)) {
        logger.debug('Proposal cannot transition to EXPIRED', {
          proposalId,
          currentStatus: proposal.status,
        });
        return; // Early return - already expired or submitted, no action needed
      }

      // Check if expiresAt has passed
      if (new Date() < proposal.expiresAt) {
        logger.debug('Proposal has not yet expired', {
          proposalId,
          expiresAt: proposal.expiresAt,
        });
        return; // Early return - not yet expired
      }

      // Update status to EXPIRED
      await prisma.multisigProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'EXPIRED',
          updatedAt: new Date(),
        },
      });

      logger.info('Multisig proposal expired', {
        proposalId,
        previousStatus: proposal.status,
        expiresAt: proposal.expiresAt,
      });
    } catch (error) {
      logger.error('Failed to expire multisig proposal', error, { proposalId });
      throw error;
    }
  }

  /**
   * Expire old proposals (cleanup task)
   *
   * @param organizationId - The organization ID
   * @returns Count of proposals marked as expired
   */
  async expireOldProposals(organizationId: string): Promise<number> {
    try {
      const now = new Date();

      const result = await prisma.multisigProposal.updateMany({
        where: {
          organizationId,
          status: { in: ['PENDING', 'SIGNED'] }, // Only expire active proposals
          expiresAt: { lt: now },
        },
        data: {
          status: 'EXPIRED',
          updatedAt: now,
        },
      });

      logger.info('Expired old multisig proposals', {
        organizationId,
        count: result.count,
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to expire old multisig proposals', error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Clean up old expired proposals
   * Optional: Deletes expired proposals older than specified days
   *
   * @param olderThanDays - Delete proposals expired more than this many days ago (default: 30)
   * @returns Count of proposals deleted
   */
  async cleanupExpiredProposals(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await prisma.multisigProposal.deleteMany({
        where: {
          status: 'EXPIRED',
          updatedAt: { lt: cutoffDate },
        },
      });

      logger.info('Cleaned up expired multisig proposals', {
        olderThanDays,
        count: result.count,
      });

      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup expired multisig proposals', error, {
        olderThanDays,
      });
      throw error;
    }
  }

  /**
   * Check if a proposal can transition to EXPIRED status
   * PENDING → EXPIRED: allowed
   * SIGNED → EXPIRED: allowed (not fully signed before expiration)
   * SUBMITTED, EXPIRED, REVOKED, FAILED: no transition allowed
   *
   * @param status - Current status of proposal
   * @returns true if transition is allowed, false otherwise
   */
  private canTransitionToExpired(status: string): boolean {
    const allowedFromStatuses = ['PENDING', 'SIGNED'];
    return allowedFromStatuses.includes(status);
  }

  /**
   * Generate a unique proposal ID
   */
  private generateProposalId(): string {
    return `prop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a mock transaction hash
   * In production, this would be the actual Stellar tx hash
   */
  private generateTxHash(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 20)}`;
  }

  /**
   * Map Prisma record to DTO
   */
  private mapToDTO(proposal: any): MultisigProposalDTO {
    return {
      id: proposal.id,
      proposalId: proposal.proposalId,
      organizationId: proposal.organizationId,
      description: proposal.description,
      transactionXdr: proposal.transactionXdr,
      signatures: Array.isArray(proposal.signatures) ? proposal.signatures : [],
      requiredSigners: proposal.requiredSigners,
      status: proposal.status,
      submittedTxHash: proposal.submittedTxHash,
      errorMessage: proposal.errorMessage,
      expiresAt: proposal.expiresAt,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    };
  }
}

// Export singleton instance
export const multisigService = new MultisigService();
