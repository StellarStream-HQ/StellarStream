import { Router, Request, Response } from "express";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import { wsService } from "../index.js";

const router = Router();

/**
 * GET /api/v1/dashboard/updates
 *
 * Returns recent dashboard updates since a given timestamp.
 * This serves as a polling fallback when WebSocket is disconnected.
 *
 * Query Parameters:
 *  - since: ISO timestamp (optional, defaults to 5 minutes ago)
 *  - address: Stellar address (optional, for user-specific updates)
 *
 * Response:
 * {
 *   success: true,
 *   updates: {
 *     payments: [...],
 *     notifications: [...],
 *     streamProgress: [...],
 *     protocolStats: {...},
 *     activeUsers: number
 *   }
 * }
 */
router.get("/updates", async (req: Request, res: Response) => {
    try {
        const since = req.query.since
            ? new Date(req.query.since as string)
            : new Date(Date.now() - 5 * 60 * 1000);
        const address = req.query.address as string | undefined;

        // Fetch recent streams (created since timestamp)
        const recentStreams = await prisma.stream.findMany({
            where: {
                createdAt: { gte: since },
                ...(address
                    ? {
                        OR: [{ sender: address }, { receiver: address }],
                    }
                    : {}),
            },
            select: {
                streamId: true,
                sender: true,
                receiver: true,
                amount: true,
                withdrawn: true,
                status: true,
                tokenAddress: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        // Fetch recent event logs
        let eventWhereClause: any = { createdAt: { gte: since } };
        if (address) {
            const userStreams = await prisma.stream.findMany({
                where: {
                    OR: [{ sender: address }, { receiver: address }],
                },
                select: { streamId: true },
            });
            const streamIds = userStreams.map(s => s.streamId).filter((id): id is string => id !== null);
            if (streamIds.length > 0) {
                eventWhereClause.streamId = { in: streamIds };
            }
        }
        const recentEvents = await prisma.eventLog.findMany({
            where: eventWhereClause,
            orderBy: { createdAt: "desc" },
            take: 100,
        });

        // Build payment status updates
        const payments = recentStreams.map((stream) => ({
            streamId: stream.streamId,
            status: stream.status === "ACTIVE" ? "confirmed" : stream.status === "CANCELED" ? "failed" : "confirmed",
            sender: stream.sender,
            receiver: stream.receiver,
            amount: stream.amount,
            asset: stream.tokenAddress || "XLM",
            timestamp: stream.createdAt.toISOString(),
        }));

        // Build stream progress updates
        const streamProgress = recentStreams
            .filter((s) => s.status === "ACTIVE" && s.amount)
            .map((stream) => {
                const total = BigInt(stream.amount || "0");
                const streamed = BigInt(stream.withdrawn || "0");
                const percentage = total > 0n ? Number((streamed * 100n) / total) : 0;
                return {
                    streamId: stream.streamId,
                    sender: stream.sender,
                    receiver: stream.receiver,
                    totalAmount: stream.amount,
                    streamedAmount: stream.withdrawn,
                    percentage,
                    remainingAmount: (total - streamed).toString(),
                    estimatedCompletion: new Date(
                        Date.now() + Math.max(1, 100 - percentage) * 60000
                    ).toISOString(),
                    timestamp: stream.createdAt.toISOString(),
                };
            });

        // Build notifications from events
        const notifications = recentEvents.map((event) => ({
            id: `${event.eventType}-${event.id}`,
            type: event.eventType === "create" ? "stream_created"
                : event.eventType === "cancel" ? "stream_cancelled"
                    : event.eventType === "withdrawal" ? "payment_received"
                        : "system_alert",
            title: `${event.eventType.charAt(0).toUpperCase() + event.eventType.slice(1)} Event`,
            message: `Stream ${event.streamId}: ${event.eventType} event recorded`,
            severity: event.eventType === "cancel" ? "warning" : "info",
            read: false,
            timestamp: event.createdAt.toISOString(),
        }));

        // Get protocol stats
        const protocolStats = await getProtocolStats();

        // Get active user count from WebSocket service
        const activeUsers = wsService.getConnectedUsers().length;

        res.json({
            success: true,
            updates: {
                payments,
                notifications,
                streamProgress,
                protocolStats,
                activeUsers,
                since: since.toISOString(),
            },
        });
    } catch (error) {
        logger.error("Failed to fetch dashboard updates", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch dashboard updates",
        });
    }
});

/**
 * GET /api/v1/dashboard/stats
 *
 * Returns current protocol statistics for the dashboard.
 * Lightweight endpoint for periodic polling.
 */
router.get("/stats", async (_req: Request, res: Response) => {
    try {
        const stats = await getProtocolStats();
        const activeUsers = wsService.getConnectedUsers().length;

        res.json({
            success: true,
            stats: {
                ...stats,
                activeUsers,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        logger.error("Failed to fetch dashboard stats", error);
        res.status(500).json({
            success: false,
            error: "Failed to fetch dashboard stats",
        });
    }
});

async function getProtocolStats() {
    const [totalStreams, activeStreams] = await Promise.all([
        prisma.stream.count(),
        prisma.stream.count({ where: { status: "ACTIVE" } }),
    ]);

    // Use raw query to sum string amounts
    const volumeResult = await prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(amount::numeric)::text AS total FROM "Stream" WHERE status = 'ACTIVE'
    `;
    const totalVolume = volumeResult[0]?.total || "0";

    return {
        totalStreams,
        activeStreams,
        totalVolume,
    };
}

// ─── Dashboard Customization Endpoints ─────────────────────────────────────

/**
 * GET /api/v1/dashboard/layouts
 * Get all dashboard layouts for the authenticated user
 */
router.get("/layouts", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const layouts = await prisma.dashboardLayout.findMany({
            where: { userId },
            include: { widgets: { orderBy: { position: "asc" } } },
            orderBy: { isDefault: "desc" },
        });

        res.json({ success: true, data: layouts });
    } catch (error) {
        logger.error("Failed to fetch dashboard layouts", error);
        res.status(500).json({ success: false, error: "Failed to fetch layouts" });
    }
});

/**
 * POST /api/v1/dashboard/layouts
 * Create a new dashboard layout
 */
router.post("/layouts", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { name, description, isDefault } = req.body;
        if (!name || typeof name !== "string") {
            return res.status(400).json({ success: false, error: "Layout name is required" });
        }

        const layout = await prisma.dashboardLayout.create({
            data: {
                userId,
                name,
                description: description || null,
                isDefault: isDefault || false,
            },
        });

        res.status(201).json({ success: true, data: layout });
    } catch (error: any) {
        if (error.code === "P2002") {
            return res.status(409).json({ success: false, error: "Layout name already exists" });
        }
        logger.error("Failed to create dashboard layout", error);
        res.status(500).json({ success: false, error: "Failed to create layout" });
    }
});

/**
 * PUT /api/v1/dashboard/layouts/:id
 * Update a dashboard layout
 */
router.put("/layouts/:id", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { id } = req.params;
        const { name, description, isDefault } = req.body;

        const layout = await prisma.dashboardLayout.findUnique({ where: { id } });
        if (!layout || layout.userId !== userId) {
            return res.status(404).json({ success: false, error: "Layout not found" });
        }

        const updated = await prisma.dashboardLayout.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(isDefault !== undefined && { isDefault }),
            },
            include: { widgets: { orderBy: { position: "asc" } } },
        });

        res.json({ success: true, data: updated });
    } catch (error: any) {
        if (error.code === "P2002") {
            return res.status(409).json({ success: false, error: "Layout name already exists" });
        }
        logger.error("Failed to update dashboard layout", error);
        res.status(500).json({ success: false, error: "Failed to update layout" });
    }
});

/**
 * DELETE /api/v1/dashboard/layouts/:id
 * Delete a dashboard layout
 */
router.delete("/layouts/:id", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { id } = req.params;
        const layout = await prisma.dashboardLayout.findUnique({ where: { id } });
        if (!layout || layout.userId !== userId) {
            return res.status(404).json({ success: false, error: "Layout not found" });
        }

        await prisma.dashboardLayout.delete({ where: { id } });
        res.json({ success: true, message: "Layout deleted" });
    } catch (error) {
        logger.error("Failed to delete dashboard layout", error);
        res.status(500).json({ success: false, error: "Failed to delete layout" });
    }
});

/**
 * POST /api/v1/dashboard/layouts/:id/widgets
 * Add a widget to a layout
 */
router.post("/layouts/:id/widgets", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { id } = req.params;
        const { widgetType, position, size, config } = req.body;

        const layout = await prisma.dashboardLayout.findUnique({ where: { id } });
        if (!layout || layout.userId !== userId) {
            return res.status(404).json({ success: false, error: "Layout not found" });
        }

        if (!widgetType) {
            return res.status(400).json({ success: false, error: "Widget type is required" });
        }

        const widget = await prisma.dashboardWidget.create({
            data: {
                layoutId: id,
                widgetType,
                position: position ?? 0,
                size: size || "medium",
                config: config ? JSON.stringify(config) : null,
            },
        });

        res.status(201).json({ success: true, data: widget });
    } catch (error) {
        logger.error("Failed to add widget", error);
        res.status(500).json({ success: false, error: "Failed to add widget" });
    }
});

/**
 * PUT /api/v1/dashboard/layouts/:layoutId/widgets/:widgetId
 * Update a widget configuration
 */
router.put("/layouts/:layoutId/widgets/:widgetId", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { layoutId, widgetId } = req.params;
        const { position, size, enabled, config } = req.body;

        const layout = await prisma.dashboardLayout.findUnique({ where: { id: layoutId } });
        if (!layout || layout.userId !== userId) {
            return res.status(404).json({ success: false, error: "Layout not found" });
        }

        const widget = await prisma.dashboardWidget.update({
            where: { id: widgetId },
            data: {
                ...(position !== undefined && { position }),
                ...(size && { size }),
                ...(enabled !== undefined && { enabled }),
                ...(config !== undefined && { config: config ? JSON.stringify(config) : null }),
            },
        });

        res.json({ success: true, data: widget });
    } catch (error) {
        logger.error("Failed to update widget", error);
        res.status(500).json({ success: false, error: "Failed to update widget" });
    }
});

/**
 * DELETE /api/v1/dashboard/layouts/:layoutId/widgets/:widgetId
 * Remove a widget from a layout
 */
router.delete("/layouts/:layoutId/widgets/:widgetId", async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const { layoutId, widgetId } = req.params;

        const layout = await prisma.dashboardLayout.findUnique({ where: { id: layoutId } });
        if (!layout || layout.userId !== userId) {
            return res.status(404).json({ success: false, error: "Layout not found" });
        }

        await prisma.dashboardWidget.delete({ where: { id: widgetId } });
        res.json({ success: true, message: "Widget removed" });
    } catch (error) {
        logger.error("Failed to delete widget", error);
        res.status(500).json({ success: false, error: "Failed to delete widget" });
    }
});

export default router;

