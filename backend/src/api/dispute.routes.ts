/**
 * Payment Dispute Resolution API Routes
 *
 * POST   /api/v1/disputes                      — file a new dispute
 * GET    /api/v1/disputes                      — list disputes with filters
 * GET    /api/v1/disputes/:idOrRef             — get a single dispute
 * GET    /api/v1/disputes/:idOrRef/history     — dispute timeline
 * GET    /api/v1/disputes/:idOrRef/evidence    — evidence attachments
 * POST   /api/v1/disputes/:idOrRef/evidence   — add evidence
 * POST   /api/v1/disputes/:idOrRef/transition  — transition status
 * POST   /api/v1/disputes/:idOrRef/resolve     — resolve with decision
 * POST   /api/v1/disputes/:idOrRef/notes       — add a note
 * GET    /api/v1/disputes/address/:address     — disputes for an address
 */

import { Router, Request, Response } from "express";
import { getDisputeService } from "../services/dispute.service.js";
import { logger } from "../logger.js";

const router = Router();
const disputeService = getDisputeService();

// ── POST /api/v1/disputes ─────────────────────────────────────────────────────

/**
 * File a new payment dispute.
 *
 * Request body:
 *   {
 *     "streamId": "optional-stream-id",
 *     "txHash": "optional-tx-hash",
 *     "filerAddress": "GABC...",
 *     "respondentAddress": "GDEF...",
 *     "reason": "Payment not received",
 *     "description": "Optional detailed description",
 *     "amount": "10000000",
 *     "tokenAddress": "optional-token-address"
 *   }
 */
router.post("/", async (req: Request, res: Response) => {
    try {
        const dispute = await disputeService.fileDispute(req.body);
        res.status(201).json({
            success: true,
            message: "Dispute filed successfully",
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] File failed", error, { body: req.body });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(400).json({ success: false, error: message });
    }
});

// ── GET /api/v1/disputes ──────────────────────────────────────────────────────

/**
 * List disputes with optional query filters.
 *
 * Query params:
 *   ?status=FILED&address=GABC...&role=filer&streamId=...&txHash=...&limit=50&offset=0
 */
router.get("/", async (req: Request, res: Response) => {
    try {
        const {
            status,
            address,
            role,
            streamId,
            txHash,
            limit,
            offset,
        } = req.query as Record<string, string | undefined>;

        const result = await disputeService.listDisputes({
            status: status as any,
            address,
            role: role as any,
            streamId,
            txHash,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        });

        res.json({
            success: true,
            ...result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] List failed", error, { query: req.query });
        res.status(400).json({ success: false, error: message });
    }
});

// ── GET /api/v1/disputes/address/:address ─────────────────────────────────────

/**
 * Get all disputes involving a specific address (as filer or respondent).
 */
router.get("/address/:address", async (req: Request, res: Response) => {
    try {
        const { address } = req.params;
        const disputes = await disputeService.getDisputesForAddress(address);

        res.json({
            success: true,
            count: disputes.length,
            data: disputes,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Address lookup failed", error, { address: req.params.address });
        res.status(500).json({ success: false, error: message });
    }
});

// ── GET /api/v1/disputes/:idOrRef ─────────────────────────────────────────────

/**
 * Get a single dispute by ID or human-readable reference.
 */
router.get("/:idOrRef", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const dispute = await disputeService.getDispute(idOrRef);

        res.json({
            success: true,
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Get failed", error, { idOrRef: req.params.idOrRef });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(500).json({ success: false, error: message });
    }
});

// ── GET /api/v1/disputes/:idOrRef/history ─────────────────────────────────────

/**
 * Get the immutable timeline of a dispute.
 */
router.get("/:idOrRef/history", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const history = await disputeService.getDisputeHistory(idOrRef);

        res.json({
            success: true,
            count: history.length,
            data: history,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] History failed", error, { idOrRef: req.params.idOrRef });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(500).json({ success: false, error: message });
    }
});

// ── GET /api/v1/disputes/:idOrRef/evidence ────────────────────────────────────

/**
 * Get evidence attachments for a dispute.
 */
router.get("/:idOrRef/evidence", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const evidence = await disputeService.getDisputeEvidence(idOrRef);

        res.json({
            success: true,
            count: evidence.length,
            data: evidence,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Evidence list failed", error, { idOrRef: req.params.idOrRef });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(500).json({ success: false, error: message });
    }
});

// ── POST /api/v1/disputes/:idOrRef/evidence ──────────────────────────────────

/**
 * Add evidence to a dispute.
 *
 * Request body:
 *   {
 *     "uploaderAddress": "GABC...",
 *     "fileName": "receipt.pdf",
 *     "fileUrl": "https://storage.example.com/evidence/abc123.pdf",
 *     "mimeType": "application/pdf",
 *     "fileSize": 1024,
 *     "description": "Payment receipt screenshot"
 *   }
 */
router.post("/:idOrRef/evidence", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const dispute = await disputeService.addEvidence({
            disputeId: idOrRef,
            uploaderAddress: req.body.uploaderAddress,
            fileName: req.body.fileName,
            fileUrl: req.body.fileUrl,
            mimeType: req.body.mimeType,
            fileSize: req.body.fileSize,
            description: req.body.description,
        });

        res.status(201).json({
            success: true,
            message: "Evidence added successfully",
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Evidence add failed", error, { body: req.body });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(400).json({ success: false, error: message });
    }
});

// ── POST /api/v1/disputes/:idOrRef/transition ────────────────────────────────

/**
 * Transition a dispute to a new status.
 *
 * Request body:
 *   {
 *     "actorAddress": "GABC...",
 *     "toStatus": "EVIDENCE_REVIEW",
 *     "comment": "Optional comment"
 *   }
 */
router.post("/:idOrRef/transition", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const dispute = await disputeService.transitionDispute({
            disputeId: idOrRef,
            actorAddress: req.body.actorAddress,
            toStatus: req.body.toStatus,
            comment: req.body.comment,
        });

        res.json({
            success: true,
            message: "Dispute status updated",
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Transition failed", error, { body: req.body });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(400).json({ success: false, error: message });
    }
});

// ── POST /api/v1/disputes/:idOrRef/resolve ───────────────────────────────────

/**
 * Resolve a dispute with a decision.
 *
 * Request body:
 *   {
 *     "resolverAddress": "GABC...",
 *     "decision": "GRANTED" | "DENIED" | "PARTIAL",
 *     "resolutionNotes": "Explanation of the decision"
 *   }
 */
router.post("/:idOrRef/resolve", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const dispute = await disputeService.resolveDispute({
            disputeId: idOrRef,
            resolverAddress: req.body.resolverAddress,
            decision: req.body.decision,
            resolutionNotes: req.body.resolutionNotes,
        });

        res.json({
            success: true,
            message: "Dispute resolved",
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Resolve failed", error, { body: req.body });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(400).json({ success: false, error: message });
    }
});

// ── POST /api/v1/disputes/:idOrRef/notes ────────────────────────────────────

/**
 * Add a note to the dispute timeline.
 *
 * Request body:
 *   {
 *     "actorAddress": "GABC...",
 *     "note": "Additional context for the dispute"
 *   }
 */
router.post("/:idOrRef/notes", async (req: Request, res: Response) => {
    try {
        const { idOrRef } = req.params;
        const dispute = await disputeService.addNote(
            idOrRef,
            req.body.actorAddress,
            req.body.note,
        );

        res.json({
            success: true,
            message: "Note added",
            data: dispute,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error("[Dispute] Note add failed", error, { body: req.body });

        if (message.includes("not found")) {
            res.status(404).json({ success: false, error: message });
            return;
        }

        res.status(400).json({ success: false, error: message });
    }
});

export default router;
