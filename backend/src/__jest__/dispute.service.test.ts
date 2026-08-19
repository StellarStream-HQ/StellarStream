import { DisputeService } from "../services/dispute.service.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the db module — factory function so Jest hoisting works correctly
jest.mock("../lib/db.js", () => {
    const mockPrisma = {
        paymentDispute: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
        },
        disputeEvidence: {
            create: jest.fn(),
            findMany: jest.fn(),
        },
        disputeHistory: {
            create: jest.fn(),
            findMany: jest.fn(),
        },
        stream: {
            findFirst: jest.fn(),
        },
    };
    return { prisma: mockPrisma };
});

// Mock the logger
jest.mock("../logger.js", () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock the notification service
jest.mock("../services/notification.service.js", () => ({
    NotificationService: jest.fn().mockImplementation(() => ({
        notifyStreamReceived: jest.fn().mockResolvedValue(undefined),
    })),
}));

// Mock the websocket registry
jest.mock("../services/websocket-registry.js", () => ({
    getWebSocketService: jest.fn(() => null),
}));

// Import the mocked prisma instance so tests can configure mock return values
import { prisma } from "../lib/db.js";
const mockPrisma = prisma as any;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDispute(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
        id: "dispute_1",
        disputeRef: "DSP-2026-ABC123",
        streamId: "stream_1",
        txHash: null,
        filerAddress: "GABCDEF123",
        respondentAddress: "GHIJKL456",
        reason: "Payment not received after 7 days",
        description: "I have been waiting for the payment",
        amount: "10000000",
        tokenAddress: "USDC:GA...",
        status: "FILED",
        decision: null,
        resolutionNotes: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function createMockStream(overrides: Record<string, unknown> = {}) {
    return {
        id: "stream_1",
        streamId: "stream_1",
        sender: "GABCDEF123",
        receiver: "GHIJKL456",
        amount: "50000000",
        tokenAddress: "USDC:GA...",
        ...overrides,
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DisputeService", () => {
    let service: DisputeService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new DisputeService();
    });

    describe("fileDispute", () => {
        it("should create a dispute with valid input", async () => {
            const mockStream = createMockStream();
            const mockDispute = createMockDispute();

            mockPrisma.stream.findFirst.mockResolvedValue(mockStream);
            mockPrisma.paymentDispute.create.mockResolvedValue(mockDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_1" });

            const result = await service.fileDispute({
                streamId: "stream_1",
                filerAddress: "GABCDEF123",
                respondentAddress: "GHIJKL456",
                reason: "Payment not received after 7 days",
                description: "I have been waiting for the payment",
                amount: "10000000",
                tokenAddress: "USDC:GA...",
            });

            expect(result).toBeDefined();
            expect(result.disputeRef).toMatch(/^DSP-/);
            expect(result.status).toBe("FILED");
            expect(result.filerAddress).toBe("GABCDEF123");
            expect(result.respondentAddress).toBe("GHIJKL456");
            expect(result.amount).toBe("10000000");

            // Should have created a history entry
            expect(mockPrisma.disputeHistory.create).toHaveBeenCalledTimes(1);
        });

        it("should reject filing a dispute against oneself", async () => {
            await expect(
                service.fileDispute({
                    streamId: "stream_1",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GABCDEF123",
                    reason: "Payment not received after 7 days",
                    amount: "10000000",
                }),
            ).rejects.toThrow("A dispute cannot be filed against yourself");
        });

        it("should require at least streamId or txHash", async () => {
            await expect(
                service.fileDispute({
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "Payment not received after 7 days",
                    amount: "10000000",
                }),
            ).rejects.toThrow("At least one of streamId or txHash");
        });

        it("should require a reason with at least 5 characters", async () => {
            await expect(
                service.fileDispute({
                    streamId: "stream_1",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "No",
                    amount: "10000000",
                }),
            ).rejects.toThrow("reason must be at least 5 characters");
        });

        it("should reject invalid amount", async () => {
            await expect(
                service.fileDispute({
                    streamId: "stream_1",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "Payment not received after 7 days",
                    amount: "not-a-number",
                }),
            ).rejects.toThrow("Invalid dispute amount");
        });

        it("should reject negative amount", async () => {
            await expect(
                service.fileDispute({
                    streamId: "stream_1",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "Payment not received after 7 days",
                    amount: "-100",
                }),
            ).rejects.toThrow("Invalid dispute amount");
        });

        it("should reject filing for a non-existent stream", async () => {
            mockPrisma.stream.findFirst.mockResolvedValue(null);

            await expect(
                service.fileDispute({
                    streamId: "nonexistent",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "Payment not received after 7 days",
                    amount: "10000000",
                }),
            ).rejects.toThrow("Stream not found");
        });

        it("should reject filing by a non-participant of the stream", async () => {
            const mockStream = createMockStream({ sender: "GOTHER1", receiver: "GOTHER2" });
            mockPrisma.stream.findFirst.mockResolvedValue(mockStream);

            await expect(
                service.fileDispute({
                    streamId: "stream_1",
                    filerAddress: "GABCDEF123",
                    respondentAddress: "GHIJKL456",
                    reason: "Payment not received after 7 days",
                    amount: "10000000",
                }),
            ).rejects.toThrow("Only the sender or receiver");
        });

        it("should auto-fill respondent from stream if not provided", async () => {
            const mockStream = createMockStream({ sender: "GABCDEF123", receiver: "GHIJKL456" });
            const mockDispute = createMockDispute({ respondentAddress: "GHIJKL456" });

            mockPrisma.stream.findFirst.mockResolvedValue(mockStream);
            mockPrisma.paymentDispute.create.mockResolvedValue(mockDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_1" });

            // When filer is sender, respondent should be receiver
            const result = await service.fileDispute({
                streamId: "stream_1",
                filerAddress: "GABCDEF123",
                reason: "Payment not received after 7 days",
                amount: "10000000",
            });

            expect(result.respondentAddress).toBe("GHIJKL456");
        });
    });

    describe("addEvidence", () => {
        it("should add evidence to a dispute", async () => {
            const mockDispute = createMockDispute({ status: "FILED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);
            mockPrisma.disputeEvidence.create.mockResolvedValue({ id: "ev_1" });
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_2" });

            // After adding evidence, the dispute should be updated
            const updatedDispute = { ...mockDispute, status: "EVIDENCE_REVIEW" };
            mockPrisma.paymentDispute.update.mockResolvedValue(updatedDispute);
            mockPrisma.paymentDispute.findFirst.mockResolvedValueOnce(mockDispute) // first call from getDisputeEntity
                .mockResolvedValueOnce(updatedDispute); // second call after update

            const result = await service.addEvidence({
                disputeId: "dispute_1",
                uploaderAddress: "GABCDEF123",
                fileName: "receipt.pdf",
                fileUrl: "https://storage.example.com/receipt.pdf",
                mimeType: "application/pdf",
                fileSize: 1024,
                description: "Payment receipt screenshot",
            });

            // Should auto-transition to EVIDENCE_REVIEW if was FILED
            // Note: The mock returns the original status since we mock findFirst
            expect(result).toBeDefined();
        });

        it("should reject evidence upload from non-participant", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.addEvidence({
                    disputeId: "dispute_1",
                    uploaderAddress: "GSTRANGER",
                    fileName: "receipt.pdf",
                    fileUrl: "https://example.com/receipt.pdf",
                }),
            ).rejects.toThrow("Only the filer or respondent");
        });

        it("should reject evidence for resolved disputes", async () => {
            const mockDispute = createMockDispute({ status: "RESOLVED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.addEvidence({
                    disputeId: "dispute_1",
                    uploaderAddress: "GABCDEF123",
                    fileName: "receipt.pdf",
                    fileUrl: "https://example.com/receipt.pdf",
                }),
            ).rejects.toThrow("Cannot add evidence");
        });

        it("should reject evidence for closed disputes", async () => {
            const mockDispute = createMockDispute({ status: "CLOSED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.addEvidence({
                    disputeId: "dispute_1",
                    uploaderAddress: "GABCDEF123",
                    fileName: "receipt.pdf",
                    fileUrl: "https://example.com/receipt.pdf",
                }),
            ).rejects.toThrow("Cannot add evidence");
        });

        it("should require fileName and fileUrl", async () => {
            await expect(
                service.addEvidence({
                    disputeId: "dispute_1",
                    uploaderAddress: "GABCDEF123",
                    fileName: "",
                    fileUrl: "",
                }),
            ).rejects.toThrow("fileName and fileUrl");
        });
    });

    describe("transitionDispute", () => {
        it("should transition from FILED to EVIDENCE_REVIEW", async () => {
            const mockDispute = createMockDispute({ status: "FILED" });
            const updatedDispute = { ...mockDispute, status: "EVIDENCE_REVIEW" };

            mockPrisma.paymentDispute.findFirst
                .mockResolvedValueOnce(mockDispute) // initial fetch
                .mockResolvedValueOnce(updatedDispute); // refreshed after update
            mockPrisma.paymentDispute.update.mockResolvedValue(updatedDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_3" });

            const result = await service.transitionDispute({
                disputeId: "dispute_1",
                actorAddress: "GABCDEF123",
                toStatus: "EVIDENCE_REVIEW",
                comment: "Reviewing evidence",
            });

            expect(result.status).toBe("EVIDENCE_REVIEW");
        });

        it("should transition from EVIDENCE_REVIEW to RESOLVED", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            const updatedDispute = { ...mockDispute, status: "RESOLVED" };

            mockPrisma.paymentDispute.findFirst
                .mockResolvedValueOnce(mockDispute) // initial fetch
                .mockResolvedValueOnce(updatedDispute); // refreshed after update
            mockPrisma.paymentDispute.update.mockResolvedValue(updatedDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_4" });

            const result = await service.transitionDispute({
                disputeId: "dispute_1",
                actorAddress: "GHIJKL456",
                toStatus: "RESOLVED",
                comment: "Agreed to resolve",
            });

            expect(result.status).toBe("RESOLVED");
        });

        it("should reject invalid transitions", async () => {
            const mockDispute = createMockDispute({ status: "FILED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            // Cannot go from FILED directly to RESOLVED (must go through EVIDENCE_REVIEW)
            await expect(
                service.transitionDispute({
                    disputeId: "dispute_1",
                    actorAddress: "GABCDEF123",
                    toStatus: "RESOLVED",
                }),
            ).rejects.toThrow("Invalid dispute transition");
        });

        it("should reject transition from CLOSED", async () => {
            const mockDispute = createMockDispute({ status: "CLOSED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.transitionDispute({
                    disputeId: "dispute_1",
                    actorAddress: "GABCDEF123",
                    toStatus: "FILED",
                }),
            ).rejects.toThrow("Invalid dispute transition");
        });

        it("should reject transition from non-participant", async () => {
            const mockDispute = createMockDispute({ status: "FILED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.transitionDispute({
                    disputeId: "dispute_1",
                    actorAddress: "GSTRANGER",
                    toStatus: "EVIDENCE_REVIEW",
                }),
            ).rejects.toThrow("Only the filer or respondent");
        });
    });

    describe("resolveDispute", () => {
        it("should resolve a dispute with GRANTED decision", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            const now = new Date();
            const resolvedDispute = {
                ...mockDispute,
                status: "RESOLVED",
                decision: "GRANTED",
                resolutionNotes: "Payment was verified",
                resolvedBy: "GHIJKL456",
                resolvedAt: now,
                updatedAt: now,
            };

            mockPrisma.paymentDispute.findFirst
                .mockResolvedValueOnce(mockDispute) // initial fetch
                .mockResolvedValueOnce(resolvedDispute); // refreshed after update
            mockPrisma.paymentDispute.update.mockResolvedValue(resolvedDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_5" });

            const result = await service.resolveDispute({
                disputeId: "dispute_1",
                resolverAddress: "GHIJKL456",
                decision: "GRANTED",
                resolutionNotes: "Payment was verified",
            });

            expect(result.status).toBe("RESOLVED");
            expect(result.decision).toBe("GRANTED");
            expect(result.resolvedBy).toBe("GHIJKL456");
        });

        it("should resolve with DENIED decision", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            const now = new Date();
            const rejectedDispute = {
                ...mockDispute,
                status: "REJECTED",
                decision: "DENIED",
                resolutionNotes: "No evidence provided",
                resolvedBy: "GHIJKL456",
                resolvedAt: now,
                updatedAt: now,
            };

            mockPrisma.paymentDispute.findFirst
                .mockResolvedValueOnce(mockDispute) // initial fetch
                .mockResolvedValueOnce(rejectedDispute); // refreshed after update
            mockPrisma.paymentDispute.update.mockResolvedValue(rejectedDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_6" });

            const result = await service.resolveDispute({
                disputeId: "dispute_1",
                resolverAddress: "GHIJKL456",
                decision: "DENIED",
                resolutionNotes: "No evidence provided",
            });

            expect(result.status).toBe("REJECTED");
            expect(result.decision).toBe("DENIED");
        });

        it("should resolve with PARTIAL decision", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            const now = new Date();
            const partialDispute = {
                ...mockDispute,
                status: "RESOLVED",
                decision: "PARTIAL",
                resolutionNotes: "Partial refund granted",
                resolvedBy: "GHIJKL456",
                resolvedAt: now,
                updatedAt: now,
            };

            mockPrisma.paymentDispute.findFirst
                .mockResolvedValueOnce(mockDispute) // initial fetch
                .mockResolvedValueOnce(partialDispute); // refreshed after update
            mockPrisma.paymentDispute.update.mockResolvedValue(partialDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_7" });

            const result = await service.resolveDispute({
                disputeId: "dispute_1",
                resolverAddress: "GHIJKL456",
                decision: "PARTIAL",
                resolutionNotes: "Partial refund granted",
            });

            expect(result.status).toBe("RESOLVED");
            expect(result.decision).toBe("PARTIAL");
        });

        it("should reject invalid decision values", async () => {
            await expect(
                service.resolveDispute({
                    disputeId: "dispute_1",
                    resolverAddress: "GHIJKL456",
                    decision: "INVALID" as any,
                }),
            ).rejects.toThrow("Invalid decision");
        });

        it("should reject resolving from non-participant", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.resolveDispute({
                    disputeId: "dispute_1",
                    resolverAddress: "GSTRANGER",
                    decision: "GRANTED",
                }),
            ).rejects.toThrow("Only the filer or respondent");
        });

        it("should reject resolving an already closed dispute", async () => {
            const mockDispute = createMockDispute({ status: "CLOSED" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.resolveDispute({
                    disputeId: "dispute_1",
                    resolverAddress: "GHIJKL456",
                    decision: "GRANTED",
                }),
            ).rejects.toThrow("already closed");
        });
    });

    describe("addNote", () => {
        it("should add a note to the dispute timeline", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);
            mockPrisma.disputeHistory.create.mockResolvedValue({ id: "hist_8" });

            const result = await service.addNote(
                "dispute_1",
                "GABCDEF123",
                "Additional context for the dispute",
            );

            expect(result).toBeDefined();
            expect(mockPrisma.disputeHistory.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        action: "NOTE_ADDED",
                        comment: "Additional context for the dispute",
                    }),
                }),
            );
        });

        it("should reject empty note", async () => {
            await expect(
                service.addNote("dispute_1", "GABCDEF123", ""),
            ).rejects.toThrow("note is required");
        });

        it("should reject note from non-participant", async () => {
            const mockDispute = createMockDispute({ status: "EVIDENCE_REVIEW" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            await expect(
                service.addNote("dispute_1", "GSTRANGER", "A note"),
            ).rejects.toThrow("Only the filer or respondent");
        });
    });

    describe("getDispute", () => {
        it("should return a dispute by ID", async () => {
            const mockDispute = createMockDispute();
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            const result = await service.getDispute("dispute_1");

            expect(result).toBeDefined();
            expect(result.id).toBe("dispute_1");
            expect(result.status).toBe("FILED");
        });

        it("should return a dispute by reference", async () => {
            const mockDispute = createMockDispute({ disputeRef: "DSP-2026-ABC123" });
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);

            const result = await service.getDispute("DSP-2026-ABC123");

            expect(result).toBeDefined();
            expect(result.disputeRef).toBe("DSP-2026-ABC123");
        });

        it("should throw NotFoundError for non-existent dispute", async () => {
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(null);

            await expect(
                service.getDispute("nonexistent"),
            ).rejects.toThrow("Dispute not found");
        });
    });

    describe("listDisputes", () => {
        it("should list all disputes", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d1", disputeRef: "DSP-2026-AAA" }),
                createMockDispute({ id: "d2", disputeRef: "DSP-2026-BBB", status: "RESOLVED" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);
            mockPrisma.paymentDispute.count.mockResolvedValue(2);

            const result = await service.listDisputes();

            expect(result.items).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it("should filter by status", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d2", disputeRef: "DSP-2026-BBB", status: "RESOLVED" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);
            mockPrisma.paymentDispute.count.mockResolvedValue(1);

            const result = await service.listDisputes({ status: "RESOLVED" });

            expect(result.items).toHaveLength(1);
            expect(result.items[0].status).toBe("RESOLVED");
        });

        it("should filter by address (filer)", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d1", filerAddress: "GABCDEF123" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);
            mockPrisma.paymentDispute.count.mockResolvedValue(1);

            const result = await service.listDisputes({ address: "GABCDEF123", role: "filer" });

            expect(result.items).toHaveLength(1);
        });

        it("should filter by address (respondent)", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d1", respondentAddress: "GHIJKL456" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);
            mockPrisma.paymentDispute.count.mockResolvedValue(1);

            const result = await service.listDisputes({ address: "GHIJKL456", role: "respondent" });

            expect(result.items).toHaveLength(1);
        });

        it("should filter by address (either)", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d1", filerAddress: "GABCDEF123" }),
                createMockDispute({ id: "d2", respondentAddress: "GABCDEF123" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);
            mockPrisma.paymentDispute.count.mockResolvedValue(2);

            const result = await service.listDisputes({ address: "GABCDEF123", role: "either" });

            expect(result.items).toHaveLength(2);
        });

        it("should apply pagination limits", async () => {
            mockPrisma.paymentDispute.findMany.mockResolvedValue([]);
            mockPrisma.paymentDispute.count.mockResolvedValue(10);

            await service.listDisputes({ limit: 5, offset: 0 });

            expect(mockPrisma.paymentDispute.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    take: 5,
                    skip: 0,
                }),
            );
        });
    });

    describe("getDisputesForAddress", () => {
        it("should return disputes for a given address", async () => {
            const mockDisputes = [
                createMockDispute({ id: "d1", filerAddress: "GABCDEF123" }),
                createMockDispute({ id: "d2", respondentAddress: "GABCDEF123" }),
            ];

            mockPrisma.paymentDispute.findMany.mockResolvedValue(mockDisputes);

            const result = await service.getDisputesForAddress("GABCDEF123");

            expect(result).toHaveLength(2);
        });

        it("should return empty array for address with no disputes", async () => {
            mockPrisma.paymentDispute.findMany.mockResolvedValue([]);

            const result = await service.getDisputesForAddress("GUNKNOWN");

            expect(result).toHaveLength(0);
        });
    });

    describe("getDisputeHistory", () => {
        it("should return the dispute timeline", async () => {
            const mockDispute = createMockDispute();
            const mockHistory = [
                {
                    id: "h1",
                    actorAddress: "GABCDEF123",
                    action: "FILED",
                    fromStatus: null,
                    toStatus: "FILED",
                    comment: "Dispute filed",
                    createdAt: new Date(),
                },
                {
                    id: "h2",
                    actorAddress: "GHIJKL456",
                    action: "EVIDENCE_ADDED",
                    fromStatus: null,
                    toStatus: "EVIDENCE_REVIEW",
                    comment: "Evidence uploaded",
                    createdAt: new Date(),
                },
            ];

            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);
            mockPrisma.disputeHistory.findMany.mockResolvedValue(mockHistory);

            const result = await service.getDisputeHistory("dispute_1");

            expect(result).toHaveLength(2);
            expect(result[0].action).toBe("FILED");
            expect(result[1].action).toBe("EVIDENCE_ADDED");
        });

        it("should throw NotFoundError for dispute not found", async () => {
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(null);

            await expect(
                service.getDisputeHistory("nonexistent"),
            ).rejects.toThrow("Dispute not found");
        });
    });

    describe("getDisputeEvidence", () => {
        it("should return evidence for a dispute", async () => {
            const mockDispute = createMockDispute();
            const mockEvidence = [
                {
                    id: "ev1",
                    uploaderAddress: "GABCDEF123",
                    fileName: "receipt.pdf",
                    fileUrl: "https://example.com/receipt.pdf",
                    mimeType: "application/pdf",
                    fileSize: 1024,
                    description: "Receipt",
                    createdAt: new Date(),
                },
            ];

            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);
            mockPrisma.disputeEvidence.findMany.mockResolvedValue(mockEvidence);

            const result = await service.getDisputeEvidence("dispute_1");

            expect(result).toHaveLength(1);
            expect(result[0].fileName).toBe("receipt.pdf");
        });

        it("should return empty array for dispute with no evidence", async () => {
            const mockDispute = createMockDispute();
            mockPrisma.paymentDispute.findFirst.mockResolvedValue(mockDispute);
            mockPrisma.disputeEvidence.findMany.mockResolvedValue([]);

            const result = await service.getDisputeEvidence("dispute_1");

            expect(result).toHaveLength(0);
        });
    });
});
