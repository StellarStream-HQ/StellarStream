/**
 * Dispute Service — Payment Dispute Resolution System
 *
 * Provides:
 *  - fileDispute(input)          — create a dispute + notify both parties
 *  - addEvidence(disputeId, ...) — attach evidence with party role checks
 *  - transitionDispute(id, ...)  — move a dispute through its resolution workflow
 *  - resolveDispute(id, ...)     — decide the dispute (GRANTED / DENIED / PARTIAL)
 *  - getDispute(id) / listDisputes(filters) / getDisputeHistory(id)
 *  - getDisputesForAddress(address) — dispute history for a user
 *  - getDisputeByRef(ref)        — look up by human-readable reference
 *
 * Workflow:
 *   FILED ──► EVIDENCE_REVIEW ──► RESOLVED | REJECTED ──► CLOSED
 *
 * Notifications (automatic):
 *   - Discord/Telegram via NotificationService for subscribed addresses
 *   - Real-time WebSocket push to both parties via WebSocketService registry
 */

import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    ForbiddenError,
    BusinessRuleError,
} from "../lib/app-error.js";
import { NotificationService } from "./notification.service.js";
import { getWebSocketService } from "./websocket-registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DisputeStatus =
    | "FILED"
    | "EVIDENCE_REVIEW"
    | "RESOLVED"
    | "REJECTED"
    | "CLOSED";

export type DisputeDecision = "GRANTED" | "DENIED" | "PARTIAL";

export type DisputeAction =
    | "FILED"
    | "EVIDENCE_ADDED"
    | "STATUS_CHANGED"
    | "RESOLVED"
    | "REJECTED"
    | "CLOSED"
    | "NOTE_ADDED";

export interface FileDisputeInput {
    streamId?: string;
    txHash?: string;
    filerAddress: string;
    /** Optional — auto-filled from the stream (the counterparty) when omitted. */
    respondentAddress?: string;
    reason: string;
    description?: string;
    amount: string;
    tokenAddress?: string;
}

export interface AddEvidenceInput {
    disputeId: string;
    uploaderAddress: string;
    fileName: string;
    fileUrl: string;
    mimeType?: string;
    fileSize?: number;
    description?: string;
}

export interface TransitionDisputeInput {
    disputeId: string;
    actorAddress: string;
    toStatus: DisputeStatus;
    comment?: string;
}

export interface ResolveDisputeInput {
    disputeId: string;
    resolverAddress: string;
    decision: DisputeDecision;
    resolutionNotes?: string;
}

export interface DisputeRecord {
    id: string;
    disputeRef: string;
    streamId: string | null;
    txHash: string | null;
    filerAddress: string;
    respondentAddress: string;
    reason: string;
    description: string | null;
    amount: string;
    tokenAddress: string | null;
    status: DisputeStatus;
    decision: DisputeDecision | null;
    resolutionNotes: string | null;
    resolvedBy: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface DisputeListFilters {
    status?: DisputeStatus;
    address?: string;
    role?: "filer" | "respondent" | "either";
    streamId?: string;
    txHash?: string;
    limit?: number;
    offset?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES: DisputeStatus[] = [
    "FILED",
    "EVIDENCE_REVIEW",
    "RESOLVED",
    "REJECTED",
    "CLOSED",
];

const VALID_DECISIONS: DisputeDecision[] = ["GRANTED", "DENIED", "PARTIAL"];

const ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
    FILED: ["EVIDENCE_REVIEW", "REJECTED", "CLOSED"],
    EVIDENCE_REVIEW: ["RESOLVED", "REJECTED", "FILED", "CLOSED"],
    RESOLVED: ["CLOSED"],
    REJECTED: ["CLOSED"],
    CLOSED: [],
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class DisputeService {
    /**
     * File a new payment dispute.
     * Validates the payload, ensures at least one of streamId/txHash is present,
     * creates the dispute + initial history entry, then notifies both parties.
     */
    async fileDispute(input: FileDisputeInput): Promise<DisputeRecord> {
        // ── Validation ────────────────────────────────────────────────────────
        if (!input.streamId && !input.txHash) {
            throw new ValidationError(
                "At least one of streamId or txHash must be provided to file a dispute.",
            );
        }

        if (!input.filerAddress) {
            throw new ValidationError("filerAddress is required.");
        }

        if (!input.reason || input.reason.trim().length < 5) {
            throw new ValidationError(
                "reason must be at least 5 characters describing the dispute.",
            );
        }

        let amount = "0";
        try {
            amount = BigInt(input.amount ?? "0").toString();
            if (BigInt(amount) < 0n) {
                throw new Error("negative");
            }
        } catch {
            throw new ValidationError(
                `Invalid dispute amount: "${input.amount}". Must be a non-negative integer.`,
            );
        }

        // ── Optional: verify the stream/tx exists ─────────────────────────────
        if (input.streamId) {
            const stream = await prisma.stream.findFirst({
                where: { OR: [{ streamId: input.streamId }, { id: input.streamId }] },
                select: { id: true, sender: true, receiver: true, amount: true, tokenAddress: true },
            });
            if (!stream) {
                throw new NotFoundError("Stream", input.streamId);
            }
            if (
                input.filerAddress !== stream.sender &&
                input.filerAddress !== stream.receiver
            ) {
                throw new ForbiddenError(
                    "Only the sender or receiver of the stream may file a dispute against it.",
                );
            }
            // Fill respondent if not provided
            if (!input.respondentAddress) {
                input.respondentAddress =
                    input.filerAddress === stream.sender
                        ? stream.receiver
                        : stream.sender;
            }
        }

        // Respondent must now be present (matched against the stream, or explicit).
        if (!input.respondentAddress) {
            throw new ValidationError(
                "respondentAddress is required when filing without a stream reference.",
            );
        }

        if (input.filerAddress === input.respondentAddress) {
            throw new ValidationError(
                "A dispute cannot be filed against yourself.",
            );
        }

        const disputeRef = this.generateDisputeRef();
        const now = new Date();

        const dispute = await prisma.paymentDispute.create({
            data: {
                disputeRef,
                streamId: input.streamId ?? null,
                txHash: input.txHash ?? null,
                filerAddress: input.filerAddress,
                respondentAddress: input.respondentAddress,
                reason: input.reason.trim(),
                description: input.description?.trim() ?? null,
                amount,
                tokenAddress: input.tokenAddress ?? null,
                status: "FILED",
                createdAt: now,
                updatedAt: now,
            },
        });

        // ── Initial history entry ─────────────────────────────────────────────
        await prisma.disputeHistory.create({
            data: {
                disputeId: dispute.id,
                actorAddress: input.filerAddress,
                action: "FILED",
                toStatus: "FILED",
                comment: input.description?.trim() ?? `Dispute filed: ${input.reason}`,
                createdAt: now,
            },
        });

        logger.info("[Dispute] Filed", {
            disputeRef,
            filer: input.filerAddress,
            respondent: input.respondentAddress,
            amount,
        });

        // ── Automatic notifications ───────────────────────────────────────────
        await this.notifyParties(disputeRef, "filed", input.filerAddress, input.respondentAddress);
        this.pushDisputeUpdate(dispute);

        return this.toDisputeRecord(dispute);
    }

    /**
     * Attach evidence to a dispute.
     * Only the filer or respondent may upload evidence.
     */
    async addEvidence(input: AddEvidenceInput): Promise<DisputeRecord> {
        if (!input.fileName || !input.fileUrl) {
            throw new ValidationError("fileName and fileUrl are required.");
        }

        const dispute = await this.getDisputeEntity(input.disputeId);

        if (dispute.status === "CLOSED" || dispute.status === "RESOLVED" || dispute.status === "REJECTED") {
            throw new ConflictError(
                "Cannot add evidence to a dispute that is already resolved or closed.",
            );
        }

        if (
            input.uploaderAddress !== dispute.filerAddress &&
            input.uploaderAddress !== dispute.respondentAddress
        ) {
            throw new ForbiddenError(
                "Only the filer or respondent of this dispute may upload evidence.",
            );
        }

        await prisma.disputeEvidence.create({
            data: {
                disputeId: dispute.id,
                uploaderAddress: input.uploaderAddress,
                fileName: input.fileName,
                fileUrl: input.fileUrl,
                mimeType: input.mimeType ?? null,
                fileSize: input.fileSize ?? 0,
                description: input.description?.trim() ?? null,
            },
        });

        // Move to evidence review if still FILED
        if (dispute.status === "FILED") {
            await prisma.paymentDispute.update({
                where: { id: dispute.id },
                data: { status: "EVIDENCE_REVIEW", updatedAt: new Date() },
            });
        }

        await prisma.disputeHistory.create({
            data: {
                disputeId: dispute.id,
                actorAddress: input.uploaderAddress,
                action: "EVIDENCE_ADDED",
                toStatus: dispute.status === "FILED" ? "EVIDENCE_REVIEW" : dispute.status,
                comment: input.description?.trim() ?? `Evidence uploaded: ${input.fileName}`,
                createdAt: new Date(),
            },
        });

        logger.info("[Dispute] Evidence added", {
            disputeId: dispute.id,
            file: input.fileName,
            uploader: input.uploaderAddress,
        });

        const updated = await this.getDisputeEntity(dispute.id);
        await this.notifyParties(
            updated.disputeRef,
            "evidence_added",
            updated.filerAddress,
            updated.respondentAddress,
        );
        this.pushDisputeUpdate(updated);

        return this.toDisputeRecord(updated);
    }

    /**
     * Transition a dispute through its workflow (FILED → EVIDENCE_REVIEW → RESOLVED/REJECTED → CLOSED).
     * Enforces allowed transitions and that only the filer or respondent can act.
     */
    async transitionDispute(input: TransitionDisputeInput): Promise<DisputeRecord> {
        const dispute = await this.getDisputeEntity(input.disputeId);

        if (
            input.actorAddress !== dispute.filerAddress &&
            input.actorAddress !== dispute.respondentAddress
        ) {
            throw new ForbiddenError(
                "Only the filer or respondent of this dispute may update it.",
            );
        }

        const allowed = ALLOWED_TRANSITIONS[dispute.status as DisputeStatus] ?? [];
        if (!allowed.includes(input.toStatus)) {
            throw new BusinessRuleError(
                `Invalid dispute transition: ${dispute.status} → ${input.toStatus}. ` +
                `Allowed transitions: ${allowed.join(", ") || "none"}.`,
            );
        }

        await prisma.paymentDispute.update({
            where: { id: dispute.id },
            data: { status: input.toStatus, updatedAt: new Date() },
        });

        await prisma.disputeHistory.create({
            data: {
                disputeId: dispute.id,
                actorAddress: input.actorAddress,
                action: input.toStatus === "RESOLVED" ? "RESOLVED"
                    : input.toStatus === "REJECTED" ? "REJECTED"
                        : "STATUS_CHANGED",
                fromStatus: dispute.status,
                toStatus: input.toStatus,
                comment: input.comment ?? null,
                createdAt: new Date(),
            },
        });

        logger.info("[Dispute] Status changed", {
            disputeId: dispute.id,
            from: dispute.status,
            to: input.toStatus,
            actor: input.actorAddress,
        });

        const refreshed = await this.getDisputeEntity(dispute.id);
        await this.notifyParties(
            refreshed.disputeRef,
            `status_${input.toStatus.toLowerCase()}`,
            refreshed.filerAddress,
            refreshed.respondentAddress,
        );
        this.pushDisputeUpdate(refreshed);

        return this.toDisputeRecord(refreshed);
    }

    /**
     * Resolve a dispute with a decision (GRANTED / DENIED / PARTIAL).
     * Sets RESOLVED/REJECTED status and stores the decision + notes.
     */
    async resolveDispute(input: ResolveDisputeInput): Promise<DisputeRecord> {
        if (!VALID_DECISIONS.includes(input.decision)) {
            throw new ValidationError(
                `Invalid decision "${input.decision}". Must be one of: ${VALID_DECISIONS.join(", ")}.`,
            );
        }

        const dispute = await this.getDisputeEntity(input.disputeId);

        if (
            input.resolverAddress !== dispute.filerAddress &&
            input.resolverAddress !== dispute.respondentAddress
        ) {
            throw new ForbiddenError(
                "Only the filer or respondent of this dispute may resolve it.",
            );
        }

        if (dispute.status === "CLOSED") {
            throw new ConflictError("This dispute is already closed.");
        }

        const toStatus: DisputeStatus = input.decision === "DENIED" ? "REJECTED" : "RESOLVED";
        const now = new Date();

        await prisma.paymentDispute.update({
            where: { id: dispute.id },
            data: {
                status: toStatus,
                decision: input.decision,
                resolutionNotes: input.resolutionNotes?.trim() ?? null,
                resolvedBy: input.resolverAddress,
                resolvedAt: now,
                updatedAt: now,
            },
        });

        await prisma.disputeHistory.create({
            data: {
                disputeId: dispute.id,
                actorAddress: input.resolverAddress,
                action: input.decision === "DENIED" ? "REJECTED" : "RESOLVED",
                fromStatus: dispute.status,
                toStatus,
                comment: input.resolutionNotes?.trim() ?? `Decision: ${input.decision}`,
                createdAt: now,
            },
        });

        logger.info("[Dispute] Resolved", {
            disputeId: dispute.id,
            decision: input.decision,
            resolver: input.resolverAddress,
        });

        const refreshed = await this.getDisputeEntity(dispute.id);
        await this.notifyParties(
            refreshed.disputeRef,
            `resolved_${input.decision.toLowerCase()}`,
            refreshed.filerAddress,
            refreshed.respondentAddress,
        );
        this.pushDisputeUpdate(refreshed);

        return this.toDisputeRecord(refreshed);
    }

    /**
     * Add a note to the dispute timeline without changing its status.
     */
    async addNote(disputeId: string, actorAddress: string, note: string): Promise<DisputeRecord> {
        if (!note || note.trim().length === 0) {
            throw new ValidationError("note is required.");
        }

        const dispute = await this.getDisputeEntity(disputeId);

        if (
            actorAddress !== dispute.filerAddress &&
            actorAddress !== dispute.respondentAddress
        ) {
            throw new ForbiddenError(
                "Only the filer or respondent of this dispute may add notes.",
            );
        }

        await prisma.disputeHistory.create({
            data: {
                disputeId: dispute.id,
                actorAddress,
                action: "NOTE_ADDED",
                toStatus: dispute.status,
                comment: note.trim(),
                createdAt: new Date(),
            },
        });

        return this.getDispute(dispute.id);
    }

    // ── Queries ────────────────────────────────────────────────────────────────

    /**
     * Fetch a single dispute by its internal ID or human-readable reference.
     */
    async getDispute(idOrRef: string): Promise<DisputeRecord> {
        const dispute = await this.getDisputeEntity(idOrRef);
        return this.toDisputeRecord(dispute);
    }

    /**
     * List disputes with optional filters (status, address, role, streamId, txHash).
     */
    async listDisputes(filters: DisputeListFilters = {}): Promise<{
        items: DisputeRecord[];
        total: number;
    }> {
        const where: Record<string, unknown> = {};

        if (filters.status) {
            if (!VALID_STATUSES.includes(filters.status)) {
                throw new ValidationError(`Invalid status: ${filters.status}`);
            }
            where.status = filters.status;
        }

        if (filters.streamId) {
            where.streamId = filters.streamId;
        }
        if (filters.txHash) {
            where.txHash = filters.txHash;
        }

        if (filters.address) {
            if (filters.role === "filer") {
                where.filerAddress = filters.address;
            } else if (filters.role === "respondent") {
                where.respondentAddress = filters.address;
            } else {
                where.OR = [
                    { filerAddress: filters.address },
                    { respondentAddress: filters.address },
                ];
            }
        }

        const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
        const offset = Math.max(filters.offset ?? 0, 0);

        const [items, total] = await Promise.all([
            prisma.paymentDispute.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: limit,
                skip: offset,
            }),
            prisma.paymentDispute.count({ where }),
        ]);

        return {
            items: items.map((d) => this.toDisputeRecord(d)),
            total,
        };
    }

    /**
     * Dispute history for a user — either as filer or respondent.
     */
    async getDisputesForAddress(address: string): Promise<DisputeRecord[]> {
        const disputes = await prisma.paymentDispute.findMany({
            where: {
                OR: [{ filerAddress: address }, { respondentAddress: address }],
            },
            orderBy: { createdAt: "desc" },
        });

        return disputes.map((d) => this.toDisputeRecord(d));
    }

    /**
     * Full immutable timeline of a dispute.
     */
    async getDisputeHistory(idOrRef: string): Promise<Array<{
        id: string;
        actorAddress: string;
        action: string;
        fromStatus: string | null;
        toStatus: string | null;
        comment: string | null;
        createdAt: Date;
    }>> {
        const dispute = await this.getDisputeEntity(idOrRef);

        const history = await prisma.disputeHistory.findMany({
            where: { disputeId: dispute.id },
            orderBy: { createdAt: "asc" },
        });

        return history.map((h) => ({
            id: h.id,
            actorAddress: h.actorAddress,
            action: h.action,
            fromStatus: h.fromStatus,
            toStatus: h.toStatus,
            comment: h.comment,
            createdAt: h.createdAt,
        }));
    }

    /**
     * Evidence attached to a dispute.
     */
    async getDisputeEvidence(idOrRef: string): Promise<Array<{
        id: string;
        uploaderAddress: string;
        fileName: string;
        fileUrl: string;
        mimeType: string | null;
        fileSize: number;
        description: string | null;
        createdAt: Date;
    }>> {
        const dispute = await this.getDisputeEntity(idOrRef);

        const evidence = await prisma.disputeEvidence.findMany({
            where: { disputeId: dispute.id },
            orderBy: { createdAt: "desc" },
        });

        return evidence.map((e) => ({
            id: e.id,
            uploaderAddress: e.uploaderAddress,
            fileName: e.fileName,
            fileUrl: e.fileUrl,
            mimeType: e.mimeType,
            fileSize: e.fileSize,
            description: e.description,
            createdAt: e.createdAt,
        }));
    }

    // ── Private helpers ─────────────────────────────────────────────────────────

    private async getDisputeEntity(idOrRef: string): Promise<{
        id: string;
        disputeRef: string;
        streamId: string | null;
        txHash: string | null;
        filerAddress: string;
        respondentAddress: string;
        reason: string;
        description: string | null;
        amount: string;
        tokenAddress: string | null;
        status: string;
        decision: string | null;
        resolutionNotes: string | null;
        resolvedBy: string | null;
        resolvedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }> {
        const dispute = await prisma.paymentDispute.findFirst({
            where: { OR: [{ id: idOrRef }, { disputeRef: idOrRef }] },
        });

        if (!dispute) {
            throw new NotFoundError("Dispute", idOrRef);
        }

        return dispute;
    }

    private toDisputeRecord(d: {
        id: string;
        disputeRef: string;
        streamId: string | null;
        txHash: string | null;
        filerAddress: string;
        respondentAddress: string;
        reason: string;
        description: string | null;
        amount: string;
        tokenAddress: string | null;
        status: string;
        decision: string | null;
        resolutionNotes: string | null;
        resolvedBy: string | null;
        resolvedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }): DisputeRecord {
        return {
            ...d,
            status: d.status as DisputeStatus,
            decision: d.decision as DisputeDecision | null,
        };
    }

    private generateDisputeRef(): string {
        const year = new Date().getFullYear();
        const random = Math.random().toString(36).slice(2, 8).toUpperCase();
        return `DSP-${year}-${random}`;
    }

    private async notifyParties(
        disputeRef: string,
        action: string,
        filer: string,
        respondent: string,
    ): Promise<void> {
        try {
            const notificationService = new NotificationService();

            // Notify filer & respondent through Discord/Telegram subscriptions.
            // We send a synthetic "stream received" event shaped for both addresses.
            await Promise.allSettled([
                notificationService.notifyStreamReceived({
                    streamId: disputeRef,
                    sender: respondent,
                    receiver: filer,
                    amount: "dispute",
                    tokenAddress: action,
                    txHash: "dispute",
                }),
                notificationService.notifyStreamReceived({
                    streamId: disputeRef,
                    sender: filer,
                    receiver: respondent,
                    amount: "dispute",
                    tokenAddress: action,
                    txHash: "dispute",
                }),
            ]);
        } catch (error) {
            logger.warn("[Dispute] Notification dispatch failed", error);
        }
    }

    private pushDisputeUpdate(dispute: {
        id: string;
        disputeRef: string;
        status: string;
        decision: string | null;
        filerAddress: string;
        respondentAddress: string;
        amount: string;
    }): void {
        try {
            const ws = getWebSocketService();
            if (ws) {
                ws.emitDisputeUpdate({
                    id: dispute.id,
                    disputeRef: dispute.disputeRef,
                    status: dispute.status,
                    decision: dispute.decision,
                    action: dispute.status.toLowerCase(),
                    filerAddress: dispute.filerAddress,
                    respondentAddress: dispute.respondentAddress,
                    amount: dispute.amount,
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (error) {
            logger.warn("[Dispute] WebSocket push failed", error);
        }
    }
}

// ─── Factory export ──────────────────────────────────────────────────────────

let _disputeService: DisputeService | null = null;

export function getDisputeService(): DisputeService {
    if (!_disputeService) {
        _disputeService = new DisputeService();
    }
    return _disputeService;
}

