import { Router, Request, Response } from "express";
import { WebhookDispatcherService } from "../services/webhook-dispatcher.service.js";
import { logger } from "../logger.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import asyncHandler from "../utils/asyncHandler.js";
import { ValidationError } from "../lib/app-error.js";
import { DELIVERY_STATUSES, type DeliveryStatus } from "../lib/webhook-retry.js";

const router = Router();
const webhookService = new WebhookDispatcherService();

function parseStatus(value: unknown): DeliveryStatus | undefined {
  if (value === undefined || value === "") return undefined;

  if (typeof value !== "string" || !DELIVERY_STATUSES.includes(value as DeliveryStatus)) {
    throw new ValidationError(
      `status must be one of: ${DELIVERY_STATUSES.join(", ")}`,
      { details: { status: value } },
    );
  }

  return value as DeliveryStatus;
}

function parseNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === "") return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative number`, {
      details: { [field]: value },
    });
  }

  return parsed;
}

/**
 * @swagger
 * /api/v1/webhooks/register:
 *   post:
 *     summary: Register a new webhook
 *     description: Registers a webhook endpoint to receive event notifications. Returns a secret key that must be stored securely — it will not be shown again.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 example: https://example.com/webhook
 *               eventType:
 *                 type: string
 *                 example: stream.created
 *                 description: Event type to subscribe to. Use "*" for all events.
 *               description:
 *                 type: string
 *                 example: My payment notification webhook
 *     responses:
 *       201:
 *         description: Webhook registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               webhook:
 *                 id: wh_abc123
 *                 url: https://example.com/webhook
 *                 eventType: stream.created
 *                 secretKey: sk_live_xxxxxxxxxxxx
 *               message: Webhook registered successfully. Store the secretKey securely.
 *       400:
 *         description: URL is required
 *         content:
 *           application/json:
 *             example:
 *               error: URL is required
 *       500:
 *         description: Failed to register webhook
 *         content:
 *           application/json:
 *             example:
 *               error: Failed to register webhook
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { url, eventType, description } = req.body;

    if (!url) {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    const webhook = await webhookService.registerWebhook(
      url,
      eventType || "*",
      description
    );

    res.status(201).json({
      success: true,
      webhook,
      message: "Webhook registered successfully. Store the secretKey securely.",
    });
  } catch (error) {
    logger.error("Error registering webhook", error);
    res.status(500).json({ error: "Failed to register webhook" });
  }
});

/**
 * @swagger
 * /api/v1/webhooks/test:
 *   post:
 *     summary: Test webhook delivery
 *     description: Dispatches a test event payload to the registered webhook URL to verify connectivity and signature validation.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [webhookId]
 *             properties:
 *               webhookId:
 *                 type: string
 *                 example: wh_abc123
 *     responses:
 *       200:
 *         description: Test webhook dispatched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               success: true
 *               message: Test webhook dispatched
 *       400:
 *         description: Webhook ID is required
 *         content:
 *           application/json:
 *             example:
 *               error: Webhook ID is required
 *       404:
 *         description: Webhook not found
 *         content:
 *           application/json:
 *             example:
 *               error: Webhook not found
 *       500:
 *         description: Failed to test webhook
 *         content:
 *           application/json:
 *             example:
 *               error: Failed to test webhook
 */
router.post("/test", async (req: Request, res: Response) => {
  try {
    const { webhookId } = req.body;

    if (!webhookId) {
      res.status(400).json({ error: "Webhook ID is required" });
      return;
    }

    const testPayload = {
      eventType: "test",
      streamId: null,
      txHash: "test_" + Date.now(),
      sender: "GTEST",
      receiver: "GTEST",
      amount: "1000000",
      timestamp: new Date().toISOString(),
    };

    await webhookService.dispatch(testPayload);

    res.json({ success: true, message: "Test webhook dispatched" });
  } catch (error) {
    logger.error("Error testing webhook", error);
    res.status(500).json({ error: "Failed to test webhook" });
  }
});

/**
 * @swagger
 * /api/v1/webhooks/deliveries/stats:
 *   get:
 *     summary: Webhook delivery queue statistics
 *     description: Aggregate counters backing the retry dashboard — per-status totals, dead letter breakdown by reason, deliveries due for retry now, and the overall success rate. Admin only.
 *     tags: [Webhooks]
 *     responses:
 *       200:
 *         description: Delivery statistics
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 counts: { pending: 4, delivering: 1, success: 812, dead_letter: 7 }
 *                 total: 824
 *                 deadLetterByReason: { retries_exhausted: 5, non_retryable_response: 2 }
 *                 dueNow: 2
 *                 oldestPendingAt: "2026-07-28T09:12:44.000Z"
 *                 successRate: 0.9914
 *       403:
 *         description: Admin credentials required
 */
router.get(
  "/deliveries/stats",
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await webhookService.getDeliveryStats();
    res.json({ success: true, data: stats });
  })
);

/**
 * @swagger
 * /api/v1/webhooks/deliveries:
 *   get:
 *     summary: List webhook deliveries
 *     description: Paginated delivery log for the retry dashboard. Filter by status to inspect the dead letter queue. Admin only.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, delivering, success, dead_letter]
 *       - in: query
 *         name: webhookId
 *         schema: { type: string }
 *       - in: query
 *         name: eventType
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Matching deliveries
 *       400:
 *         description: Invalid filter value
 *       403:
 *         description: Admin credentials required
 */
router.get(
  "/deliveries",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await webhookService.listDeliveries({
      status: parseStatus(req.query.status),
      webhookId: typeof req.query.webhookId === "string" ? req.query.webhookId : undefined,
      eventType: typeof req.query.eventType === "string" ? req.query.eventType : undefined,
      limit: parseNumber(req.query.limit, "limit"),
      offset: parseNumber(req.query.offset, "offset"),
    });

    res.json({ success: true, data: result });
  })
);

/**
 * @swagger
 * /api/v1/webhooks/deliveries/{deliveryId}:
 *   get:
 *     summary: Inspect a single webhook delivery
 *     description: Returns the full delivery record including the original payload and the last recorded error. Admin only.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery record
 *       403:
 *         description: Admin credentials required
 *       404:
 *         description: Delivery not found
 */
router.get(
  "/deliveries/:deliveryId",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const delivery = await webhookService.getDelivery(req.params.deliveryId);
    res.json({ success: true, data: delivery });
  })
);

/**
 * @swagger
 * /api/v1/webhooks/deliveries/{deliveryId}/retry:
 *   post:
 *     summary: Manually retry a webhook delivery
 *     description: Requeues a dead lettered delivery for immediate re-delivery with a fresh retry budget. Admin only.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery requeued
 *       403:
 *         description: Admin credentials required
 *       404:
 *         description: Delivery not found
 *       409:
 *         description: Delivery is in flight or already succeeded
 */
router.post(
  "/deliveries/:deliveryId/retry",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const delivery = await webhookService.retryDelivery(req.params.deliveryId);

    res.json({
      success: true,
      data: delivery,
      message: "Delivery requeued for immediate retry",
    });
  })
);

/**
 * @swagger
 * /api/v1/webhooks/deliveries/retry:
 *   post:
 *     summary: Bulk retry dead lettered deliveries
 *     description: Requeues dead lettered deliveries, either by explicit id list or by draining a single webhook's dead letter queue. Admin only.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveryIds:
 *                 type: array
 *                 items: { type: string }
 *               webhookId:
 *                 type: string
 *               limit:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Deliveries requeued
 *       400:
 *         description: Neither deliveryIds nor webhookId supplied
 *       403:
 *         description: Admin credentials required
 */
router.post(
  "/deliveries/retry",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { deliveryIds, webhookId, limit } = req.body ?? {};

    if (deliveryIds !== undefined && !Array.isArray(deliveryIds)) {
      throw new ValidationError("deliveryIds must be an array of delivery ids");
    }

    const result = await webhookService.retryDeadLetterQueue({
      deliveryIds,
      webhookId,
      limit: parseNumber(limit, "limit"),
    });

    res.json({
      success: true,
      data: result,
      message: `Requeued ${result.retried} deliveries`,
    });
  })
);

/**
 * POST /api/v1/webhooks/:webhookId/rotate-secret
 * Rotate a webhook signing secret. Admin only.
 */
router.post("/:webhookId/rotate-secret", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { webhookId } = req.params;

    const webhook = await webhookService.rotateWebhookSecret(webhookId);

    res.json({
      success: true,
      webhook,
      message: "Webhook secret rotated successfully. Store the new secretKey securely.",
    });
  } catch (error) {
    logger.error("Error rotating webhook secret", error);
    res.status(500).json({ error: "Failed to rotate webhook secret" });
  }
});

export default router;
