import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/db.js';
// import { verifySignature } from '../../security/signature-verification.js';
import { logger } from '../../logger.js';

const router = Router();

interface CollectSignatureRequest {
  proposalId: string;
  organizationId: string;
  signer: string;
  signature: string;
  transactionXdr?: string;
  requiredSigners?: number;
  expiresAt?: string;
}

interface MultisigProposalResponse {
  id: string;
  proposalId: string;
  organizationId: string;
  status: string;
  signatures: Array<{ signer: string; signature: string }>;
  requiredSigners: number;
  signatureCount: number;
  isComplete: boolean;
}

// POST /api/v3/multisig/collect - Append signature to proposal
router.post('/multisig/collect', async (req: Request<{}, {}, CollectSignatureRequest>, res: Response) => {
  try {
    const { proposalId, organizationId, signer, signature, transactionXdr, requiredSigners, expiresAt } = req.body;

    // Validate required fields
    if (!proposalId || !organizationId || !signer || !signature) {
      return res.status(400).json({
        error: 'Missing required fields: proposalId, organizationId, signer, signature',
      });
    }

    // TODO: Verify signature against signer's public key
    // For now, accept all signatures - implement when signature verification is ready
    // const isValidSignature = await verifySignature(signer, signature, proposalId);
    // if (!isValidSignature) {
    //   logger.warn(`Invalid signature from ${signer} for proposal ${proposalId}`);
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // Find or create proposal
    let proposal = await prisma.multisigProposal.findUnique({
      where: { proposalId: proposalId },
    });

    if (!proposal) {
      if (!transactionXdr || !requiredSigners) {
        return res.status(400).json({
          error: 'New proposal requires transactionXdr and requiredSigners',
        });
      }

      proposal = await prisma.multisigProposal.create({
        data: {
          proposalId: proposalId,
          organizationId: organizationId,
          transactionXdr: transactionXdr,
          requiredSigners: requiredSigners,
          signatures: [{ signer, signature }],
          expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING',
        },
      });
    } else {
      // Check if signer already signed
      const existingSignatures = proposal.signatures as Array<{ signer: string; signature: string }>;
      const alreadySigned = existingSignatures.some((sig) => sig.signer === signer);

      if (alreadySigned) {
        return res.status(400).json({ error: 'Signer has already signed this proposal' });
      }

      // Add signature
      existingSignatures.push({ signer, signature });
      const newStatus = existingSignatures.length >= proposal.requiredSigners ? 'SIGNED' : 'PENDING';

      proposal = await prisma.multisigProposal.update({
        where: { id: proposal.id },
        data: {
          signatures: existingSignatures,
          status: newStatus,
        },
      });
    }

    const signatures = proposal.signatures as Array<{ signer: string; signature: string }>;
    const response: MultisigProposalResponse = {
      id: proposal.id,
      proposalId: proposal.proposalId,
      organizationId: proposal.organizationId,
      status: proposal.status,
      signatures,
      requiredSigners: proposal.requiredSigners,
      signatureCount: signatures.length,
      isComplete: signatures.length >= proposal.requiredSigners,
    };

    return res.status(200).json(response);
  } catch (error) {
    logger.error('Error collecting signature:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v3/multisig/:proposalId - Get proposal status
router.get('/multisig/:proposalId', async (req: Request<{ proposalId: string }>, res: Response) => {
  try {
    const { proposalId } = req.params;

    const proposal = await prisma.multisigProposal.findUnique({
      where: { proposalId: proposalId },
    });

    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const signatures = proposal.signatures as Array<{ signer: string; signature: string }>;
    const response: MultisigProposalResponse = {
      id: proposal.id,
      proposalId: proposal.proposalId,
      organizationId: proposal.organizationId,
      status: proposal.status,
      signatures,
      requiredSigners: proposal.requiredSigners,
      signatureCount: signatures.length,
      isComplete: signatures.length >= proposal.requiredSigners,
    };

    return res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching proposal:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
