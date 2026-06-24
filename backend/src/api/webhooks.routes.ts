import { Router, Request, Response } from "express";
import { WebhookDispatcherService } from "../services/webhook-dispatcher.service.js";
import { logger } from "../logger.js";

const router = Router();
const webhookService = new WebhookDispatcherService();

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

export default router;
