import { Router, Request, Response } from "express";
import { invoiceLinkService } from "../services/invoice-link.service.js";
import { requireWalletAuth } from "../middleware/requireWalletAuth.js";
import { requireOfacCheck } from "../middleware/requireOfacCheck.js";
import asyncHandler from "../utils/asyncHandler.js";

const router = Router();

/**
 * POST /api/v1/invoice-links
 * Create a new invoice link (draft)
 */
router.post(
  "/",
  requireWalletAuth,
  requireOfacCheck(),
  asyncHandler(async (req: Request, res: Response) => {
    const { receiver, amount, tokenAddress, duration, description, pdfUrl, expiresAt } = req.body;
    const sender = req.user?.address;

    if (!sender) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!receiver || !amount || !tokenAddress || !duration) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const link = await invoiceLinkService.createInvoiceLink({
      sender,
      receiver,
      amount,
      tokenAddress,
      duration,
      description,
      pdfUrl,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    res.status(201).json(link);
  }),
);

/**
 * GET /api/v1/invoice-links/:slug
 * Retrieve invoice link by slug (public endpoint)
 */
router.get(
  "/:slug",
  asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;
    const link = await invoiceLinkService.getInvoiceLinkBySlug(slug);

    if (!link) {
      res.status(404).json({ error: "Invoice link not found or expired" });
      return;
    }

    res.json(link);
  }),
);

/**
 * GET /api/v1/invoice-links
 * List invoice links for authenticated sender
 */
router.get(
  "/",
  requireWalletAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const sender = req.user?.address;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!sender) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const links = await invoiceLinkService.listInvoiceLinks(sender, limit, offset);
    res.json(links);
  }),
);

/**
 * PATCH /api/v1/invoice-links/:id/status
 * Update invoice link status
 */
router.patch(
  "/:id/status",
  requireWalletAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ error: "Status is required" });
      return;
    }

    const link = await invoiceLinkService.updateInvoiceLinkStatus(id, status);
    res.json(link);
  }),
);

/**
 * DELETE /api/v1/invoice-links/:id
 * Delete an invoice link
 */
router.delete(
  "/:id",
  requireWalletAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await invoiceLinkService.deleteInvoiceLink(id);
    res.status(204).send();
  }),
);

export default router;
