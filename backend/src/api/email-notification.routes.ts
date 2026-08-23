/**
 * Email Notification Routes
 *
 * Manages email notification preferences, email subscriptions, and
 * delivery history for StellarStream users.
 *
 * POST   /api/v1/notifications/email/subscribe    — Register email for notifications
 * DELETE /api/v1/notifications/email/unsubscribe  — Unregister email notifications
 * GET    /api/v1/notifications/email/preferences/:address — Get preferences
 * PUT    /api/v1/notifications/email/preferences/:address — Update preferences
 * GET    /api/v1/notifications/email/deliveries/:address  — Get delivery history
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import { emailService } from "../services/email.service.js";

const router = Router();

// ── Validation Schemas ────────────────────────────────────────────────────────

const emailSubscribeSchema = z.object({
    stellarAddress: z.string().min(1),
    email: z.string().email(),
});

const emailUnsubscribeSchema = z.object({
    stellarAddress: z.string().min(1),
});

const updatePreferencesSchema = z.object({
    email: z.string().email(),
    paymentConfirmations: z.boolean().optional(),
    streamStatusUpdates: z.boolean().optional(),
    securityAlerts: z.boolean().optional(),
    weeklySummaries: z.boolean().optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/notifications/email/subscribe
 *
 * Register a Stellar address for email notifications.
 * Creates or updates the email notification preference record.
 */
router.post("/email/subscribe", async (req: Request, res: Response) => {
    const parsed = emailSubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
        return;
    }

    const { stellarAddress, email } = parsed.data;

    try {
        await emailService.upsertPreferences(stellarAddress, {
            email,
            paymentConfirmations: true,
            streamStatusUpdates: true,
            securityAlerts: true,
            weeklySummaries: false,
        });

        logger.info("[EmailNotification] Subscription saved", { stellarAddress, email });
        res.status(201).json({
            success: true,
            message: "Email notification preferences saved",
        });
    } catch (err) {
        logger.error("[EmailNotification] Subscribe failed", { err, stellarAddress });
        res.status(500).json({ error: "Failed to save email subscription" });
    }
});

/**
 * DELETE /api/v1/notifications/email/unsubscribe
 *
 * Remove email notification preferences for a Stellar address.
 * Sets the preference as inactive rather than deleting it.
 */
router.delete("/email/unsubscribe", async (req: Request, res: Response) => {
    const parsed = emailUnsubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
        return;
    }

    const { stellarAddress } = parsed.data;

    try {
        await prisma.notificationPreference.updateMany({
            where: {
                stellarAddress,
                platform: "email" as any,
            },
            data: { isActive: false },
        });

        res.json({ success: true, message: "Unsubscribed from email notifications" });
    } catch (err) {
        logger.error("[EmailNotification] Unsubscribe failed", { err, stellarAddress });
        res.status(500).json({ error: "Failed to unsubscribe" });
    }
});

/**
 * GET /api/v1/notifications/email/preferences/:address
 *
 * Get email notification preferences for a Stellar address.
 */
router.get("/email/preferences/:address", async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!address) {
        res.status(400).json({ error: "Stellar address is required" });
        return;
    }

    try {
        const prefs = await emailService.getPreferences(address);

        if (!prefs) {
            res.json({
                success: true,
                data: {
                    email: null,
                    emailVerified: false,
                    paymentConfirmations: true,
                    streamStatusUpdates: true,
                    securityAlerts: true,
                    weeklySummaries: false,
                },
            });
            return;
        }

        res.json({ success: true, data: prefs });
    } catch (err) {
        logger.error("[EmailNotification] Get preferences failed", { err, address });
        res.status(500).json({ error: "Failed to get preferences" });
    }
});

/**
 * PUT /api/v1/notifications/email/preferences/:address
 *
 * Update email notification preferences for a Stellar address.
 */
router.put("/email/preferences/:address", async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!address) {
        res.status(400).json({ error: "Stellar address is required" });
        return;
    }

    const parsed = updatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
        return;
    }

    try {
        await emailService.upsertPreferences(address, parsed.data);

        logger.info("[EmailNotification] Preferences updated", { address, ...parsed.data });
        res.json({ success: true, message: "Preferences updated" });
    } catch (err) {
        logger.error("[EmailNotification] Update preferences failed", { err, address });
        res.status(500).json({ error: "Failed to update preferences" });
    }
});

/**
 * GET /api/v1/notifications/email/deliveries/:address
 *
 * Get email delivery history for a Stellar address.
 * Supports pagination via query params (limit, offset).
 */
router.get("/email/deliveries/:address", async (req: Request, res: Response) => {
    const { address } = req.params;

    if (!address) {
        res.status(400).json({ error: "Stellar address is required" });
        return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    try {
        const history = await emailService.getDeliveryHistory(address, limit, offset);
        res.json({ success: true, data: history });
    } catch (err) {
        logger.error("[EmailNotification] Get delivery history failed", { err, address });
        res.status(500).json({ error: "Failed to get delivery history" });
    }
});

export default router;

