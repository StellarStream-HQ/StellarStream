// API routes and controllers
// Will contain REST API endpoints for querying stream data

import { Router, Request, Response } from "express";
import { AuditLogService } from "../services/audit-log.service.js";
import { AuditChainVerificationService } from "../services/audit-chain-verification.service.js";
import { logger } from "../logger.js";
import { SorobanRpc } from "@stellar/stellar-sdk";
import streamsRouter from "./streams.routes";
import yieldRouter from "./yield.routes.js";
import snapshotRouter from "./snapshot.routes";
import governanceRouter from "./governance.routes.js";
import gasTankRouter from "./gas-tank.routes.js";
import analyticsRouter from "./analytics.routes.js";
import walletAuthRouter from "./wallet-auth.routes.js";
import notificationRouter from "./notification-subscription.routes.js";
import invoiceLinkRouter from "./invoice-link.routes.js";
import webhooksRouter from "./webhooks.routes.js";
import cachedStatsRouter from "./cached-stats.routes.js";

import orgMemberRouter from "./org-member.routes.js";
import orgMemberSyncRouter from "./org-member-sync.routes.js";
import organizationRouter from "./organization.routes.js";
import invitationRouter from "./invitation.routes.js";
import policyRouter from "./policy.routes.js";
import billingRouter from "./billing.routes.js";
import multisigRouter from "./multisig.routes.js";
import auditLogRouter from "./audit-log.routes.js";
import assetMappingRouter from "./asset-mapping.routes.js";
import dustAuditRouter from "./dust-audit.routes.js";
import recipientRouter from "./recipient.routes.js";

const router = Router();

// Sub-routers (mounted relative to /api/v1 in index.ts)
router.use("/", streamsRouter);
router.use("/yield", yieldRouter);
router.use("/snapshots", snapshotRouter);
router.use("/", governanceRouter);
router.use("/", gasTankRouter);
router.use("/analytics", analyticsRouter);
router.use("/auth", walletAuthRouter);
router.use("/notifications", notificationRouter);
router.use("/invoice-links", invoiceLinkRouter);
router.use("/webhooks", webhooksRouter);
router.use("/stats", cachedStatsRouter);
router.use("/", orgMemberRouter);
router.use("/", orgMemberSyncRouter);
router.use("/", organizationRouter);
router.use("/", invitationRouter);
router.use("/", policyRouter);
router.use("/", billingRouter);
router.use("/", multisigRouter);
router.use("/", auditLogRouter);
router.use("/asset-mapping", assetMappingRouter);
router.use("/dust-audit", dustAuditRouter);
router.use("/recipient", recipientRouter);

const auditLogService = new AuditLogService();
const chainVerificationService = new AuditChainVerificationService();

/**
 * GET /api/v1/audit-log
 * Returns the last 50 protocol events in chronological order
 * Query params:
 *   - limit: number of events to return (default: 50, max: 100)
 */
router.get("/audit-log", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit as string) || 50,
      100
    );

    const events = await auditLogService.getRecentEvents(limit);

    res.json({
      success: true,
      count: events.length,
      events,
    });
  } catch (error) {
    logger.error("Failed to retrieve audit log", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve audit log",
    });
  }
});

/**
 * GET /api/v1/audit-log/chain/verify
 * Verify the integrity of the audit log hash chain.
 * Returns verification result including any broken links.
 */
router.get("/audit-log/chain/verify", async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const result = await chainVerificationService.verifyChain(limit);

    res.json({
      success: true,
      verification: result,
    });
  } catch (error) {
    logger.error("Failed to verify audit log chain", error);
    res.status(500).json({
      success: false,
      error: "Failed to verify audit log chain",
    });
  }
});

/**
 * GET /api/audit-log/:streamId
 * Returns all events for a specific stream
 */
router.get("/audit-log/:streamId", async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params;

    if (!streamId) {
      res.status(400).json({
        success: false,
        error: "Stream ID is required",
      });
      return;
    }

    const events = await auditLogService.getStreamEvents(streamId);

    res.json({
      success: true,
      streamId,
      count: events.length,
      events,
    });
  } catch (error) {
    logger.error("Failed to retrieve stream events", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve stream events",
    });
  }
});

/**
 * GET /api/v1/transaction/:txHash
 * Returns raw transaction data including XDR and events for a specific transaction hash
 */
router.get("/transaction/:txHash", async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;

    if (!txHash) {
      res.status(400).json({
        success: false,
        error: "Transaction hash is required",
      });
      return;
    }

    // Initialize Soroban RPC server
    const server = new SorobanRpc.Server(process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org");

    // Fetch transaction data
    const txResponse = await server.getTransaction(txHash);

    if (!txResponse) {
      res.status(404).json({
        success: false,
        error: "Transaction not found",
      });
      return;
    }

    // Get events for this transaction
    const eventsResponse = await server.getEvents({
      startLedger: txResponse.ledger,
      endLedger: txResponse.ledger,
      filters: [{
        type: "transaction",
        transactionHash: txHash,
      }],
    });

    res.json({
      success: true,
      xdr: txResponse.envelopeXdr?.toXDR() || txResponse.resultXdr?.toXDR(),
      json: {
        transaction: txResponse,
        ledger: txResponse.ledger,
        status: txResponse.status,
      },
      events: eventsResponse.events || [],
    });
  } catch (error) {
    logger.error("Failed to retrieve transaction data", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve transaction data",
    });
  }
});

export default router;
