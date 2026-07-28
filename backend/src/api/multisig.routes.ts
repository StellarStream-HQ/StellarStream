import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireWalletAuth } from '../middleware/requireWalletAuth.js';
import { requireOrgContext } from '../middleware/requireOrgContext.js';
import { multisigService } from '../services/multisig.service.js';
import { authorizationService } from '../services/authorization.service.js';
import { logger } from '../logger.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

/**
 * POST /api/v1/orgs/:gAddress/multisig/proposals - Create proposal
 * Request body validation
 */
const createProposalSchema = z.object({
  description: z.string().max(1000).optional(),
  transactionXdr: z.string(),
  requiredSigners: z.number().positive().int(),
});

/**
 * POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/sign - Sign proposal
 * Request body validation
 */
const signProposalSchema = z.object({
  signature: z.string(),
  signerAddress: z.string(),
});

/**
 * POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/submit - Submit proposal
 */

// ── POST /api/v1/orgs/:gAddress/multisig/proposals
// Create multi-signature proposal (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/multisig/proposals',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const memberAddress = req.walletAddress!;

      // Parse request body
      const parsed = createProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
        return;
      }

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, memberAddress);

      // Calculate expiration date (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create proposal
      const proposal = await multisigService.createProposal(
        organizationId,
        {
          description: parsed.data.description,
          transactionXdr: parsed.data.transactionXdr,
          requiredSigners: parsed.data.requiredSigners,
          expiresAt,
        },
        memberAddress
      );

      res.status(201).json({
        success: true,
        proposal: {
          proposalId: proposal.proposalId,
          organizationId: proposal.organizationId,
          description: proposal.description,
          status: proposal.status,
          requiredSigners: proposal.requiredSigners,
          currentSignatures: 0,
          expiresAt: proposal.expiresAt,
          createdAt: proposal.createdAt,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized proposal creation', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to create proposal', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to create proposal',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/multisig/proposals/:proposalId
// Get proposal details (DRAFTER+)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/multisig/proposals/:proposalId',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const { proposalId } = req.params;

      // Get proposal
      const proposal = await multisigService.getProposal(proposalId, organizationId);

      if (!proposal) {
        res.status(404).json({
          success: false,
          error: 'Proposal not found',
        });
        return;
      }

      const signatureCount = proposal.signatures ? JSON.parse(proposal.signatures).length : 0;

      res.json({
        success: true,
        proposal: {
          proposalId: proposal.proposalId,
          organizationId: proposal.organizationId,
          description: proposal.description,
          status: proposal.status,
          requiredSigners: proposal.requiredSigners,
          currentSignatures: signatureCount,
          signatures: proposal.signatures ? JSON.parse(proposal.signatures) : [],
          submittedTxHash: proposal.submittedTxHash,
          errorMessage: proposal.errorMessage,
          expiresAt: proposal.expiresAt,
          createdAt: proposal.createdAt,
          updatedAt: proposal.updatedAt,
        },
      });
    } catch (error) {
      logger.error('Failed to get proposal', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to get proposal',
      });
    }
  }
);

// ── POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/sign
// Add signature to proposal (APPROVER+ with SEP-10 verification)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/multisig/proposals/:proposalId/sign',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const memberAddress = req.walletAddress!;
      const { proposalId } = req.params;

      // Parse request body
      const parsed = signProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
        return;
      }

      // Verify APPROVER+ role
      await authorizationService.requireApprover(organizationId, memberAddress);

      // Add signature
      const proposal = await multisigService.addSignature(
        proposalId,
        organizationId,
        memberAddress,
        parsed.data.signature
      );

      if (!proposal) {
        res.status(404).json({
          success: false,
          error: 'Proposal not found',
        });
        return;
      }

      const signatureCount = proposal.signatures ? JSON.parse(proposal.signatures).length : 0;

      res.json({
        success: true,
        proposal: {
          proposalId: proposal.proposalId,
          status: proposal.status,
          requiredSigners: proposal.requiredSigners,
          currentSignatures: signatureCount,
          expiresAt: proposal.expiresAt,
        },
      });
    } catch (error: any) {
      if (error.message?.includes('APPROVER')) {
        logger.warn('Unauthorized signature addition', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      if (error.message?.includes('already signed') || error.message?.includes('duplicate')) {
        res.status(400).json({
          success: false,
          error: 'Member already signed this proposal',
        });
        return;
      }

      logger.error('Failed to add signature', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to add signature',
      });
    }
  }
);

// ── POST /api/v1/orgs/:gAddress/multisig/proposals/:proposalId/submit
// Submit proposal to blockchain when threshold reached (EXECUTOR only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/multisig/proposals/:proposalId/submit',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const memberAddress = req.walletAddress!;
      const { proposalId } = req.params;

      // Verify EXECUTOR role
      await authorizationService.requireExecutor(organizationId, memberAddress);

      // Get proposal
      const proposal = await multisigService.getProposal(proposalId, organizationId);
      if (!proposal) {
        res.status(404).json({
          success: false,
          error: 'Proposal not found',
        });
        return;
      }

      // Check if threshold reached
      const signatureCount = proposal.signatures ? JSON.parse(proposal.signatures).length : 0;
      if (signatureCount < proposal.requiredSigners) {
        res.status(400).json({
          success: false,
          error: `Insufficient signatures. Current: ${signatureCount}, Required: ${proposal.requiredSigners}`,
        });
        return;
      }

      // Check if expired
      if (new Date() > new Date(proposal.expiresAt)) {
        res.status(400).json({
          success: false,
          error: 'Proposal has expired',
        });
        return;
      }

      // Submit transaction
      const result = await multisigService.submitProposal(organizationId, proposalId);

      res.json({
        success: true,
        message: 'Transaction submitted successfully',
        transactionHash: result.txHash,
        proposalId,
      });
    } catch (error: any) {
      if (error.message?.includes('EXECUTOR')) {
        logger.warn('Unauthorized submit attempt', { organizationId: req.organizationId });
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        });
        return;
      }

      logger.error('Failed to submit proposal', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to submit proposal',
      });
    }
  }
);

// ── GET /api/v1/orgs/:gAddress/multisig/proposals
// List all proposals for organization (DRAFTER+)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/multisig/proposals',
  requireWalletAuth,
  requireOrgContext,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId!;
      const status = (req.query.status as string) || 'all';
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      // Get proposals
      const proposals = await multisigService.listProposals(organizationId, {
        status: status !== 'all' ? (status as any) : undefined,
        limit,
      });

      res.json({
        success: true,
        proposals: proposals.map((p) => ({
          proposalId: p.proposalId,
          description: p.description,
          status: p.status,
          requiredSigners: p.requiredSigners,
          currentSignatures: p.signatures ? (JSON.parse(p.signatures) as any[]).length : 0,
          expiresAt: p.expiresAt,
          createdAt: p.createdAt,
        })),
        count: proposals.length,
        limit,
      });
    } catch (error) {
      logger.error('Failed to list proposals', error, { organizationId: req.organizationId });
      res.status(500).json({
        success: false,
        error: 'Failed to list proposals',
      });
    }
  }
);

export default router;
