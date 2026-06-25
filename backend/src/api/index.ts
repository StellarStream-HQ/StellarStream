// API routes and controllers
// Will contain REST API endpoints for querying stream data

import { Router } from "express";
import clawbackRoutes from "./clawback.routes.js";

const router = Router();

/**
 * V2 API Routes — clawback
 * POST   /api/v2/streams/:streamId/clawback
 * GET    /api/v2/streams/:streamId/clawback/status
 * GET    /api/v2/streams/:streamId/clawback/history
 */
router.use("/v2/streams/:streamId/clawback", clawbackRoutes);

export default router;

export {};
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
router.use("/asset-mapping", assetMappingRouter);
router.use("/dust-audit", dustAuditRouter);
router.use("/recipient", recipientRouter);

const auditLogService = new AuditLogService();
const chainVerificationService = new AuditChainVerificationService();

/**
 * @swagger
 * /api/v1/audit-log:
 *   get:
 *     summary: Get recent audit log events
 *     description: Returns the most recent protocol events in chronological order.
 *     tags: [Audit Log]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Number of events to return (default 50, max 100)
 *     responses:
 *       200:
 *         description: Audit log events returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               count: 2
 *               events:
 *                 - id: 1
 *                   eventType: create
 *                   streamId: stream-001
 *                   txHash: abc123
 *                   createdAt: "2024-01-01T00:00:00.000Z"
 *       500:
 *         description: Failed to retrieve audit log
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Failed to retrieve audit log
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
 * @swagger
 * /api/v1/audit-log/chain/verify:
 *   get:
 *     summary: Verify audit log hash chain integrity
 *     description: Verifies the cryptographic hash chain of the audit log. Returns whether the chain is intact and reports any broken links.
 *     tags: [Audit Log]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of most recent events to include in verification (omit for full chain)
 *     responses:
 *       200:
 *         description: Chain verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               verification:
 *                 isValid: true
 *                 checkedCount: 100
 *                 brokenLinks: []
 *       500:
 *         description: Failed to verify audit log chain
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Failed to verify audit log chain
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
 * @swagger
 * /api/v1/audit-log/{streamId}:
 *   get:
 *     summary: Get audit log events for a specific stream
 *     description: Returns all audit log events associated with the given stream ID.
 *     tags: [Audit Log]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *           example: stream-001
 *         description: The unique stream identifier
 *     responses:
 *       200:
 *         description: Stream events returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               streamId: stream-001
 *               count: 3
 *               events:
 *                 - id: 1
 *                   eventType: create
 *                   streamId: stream-001
 *                   txHash: abc123
 *                   createdAt: "2024-01-01T00:00:00.000Z"
 *       400:
 *         description: Stream ID is required
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Stream ID is required
 *       500:
 *         description: Failed to retrieve stream events
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Failed to retrieve stream events
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
 * @swagger
 * /api/v1/transaction/{txHash}:
 *   get:
 *     summary: Get transaction data by hash
 *     description: Returns raw transaction data including the XDR envelope, parsed JSON, and associated Soroban contract events for the given transaction hash.
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema:
 *           type: string
 *           example: a1b2c3d4e5f6...
 *         description: The Stellar transaction hash
 *     responses:
 *       200:
 *         description: Transaction data returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               xdr: AAAAAgAAAAA...
 *               json:
 *                 transaction:
 *                   hash: a1b2c3d4e5f6...
 *                 ledger: 50000000
 *                 status: SUCCESS
 *               events:
 *                 - type: contract
 *                   txHash: a1b2c3d4e5f6...
 *       400:
 *         description: Transaction hash is required
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Transaction hash is required
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Transaction not found
 *       500:
 *         description: Failed to retrieve transaction data
 *         content:
 *           application/json:
 *             example:
 *               success: false
 *               error: Failed to retrieve transaction data
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
