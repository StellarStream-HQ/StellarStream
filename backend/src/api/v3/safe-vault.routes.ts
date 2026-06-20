import { Router, Request, Response } from "express";
import { z } from "zod";
import { SafeVaultService } from "../../services/safe-vault.service.js";
import validateRequest from "../../middleware/validateRequest.js";
import asyncHandler from "../../utils/asyncHandler.js";

const router = Router();
const safeVaultService = new SafeVaultService();

const resolveRoutesSchema = z.object({
  recipients: z
    .array(
      z.object({
        address: z.string().min(56).max(56),
        amountStroops: z.string().regex(/^\d+$/, "Must be a whole number string"),
      })
    )
    .min(1)
    .max(1000),
});

/**
 * POST /api/v3/resolve-vault-routes
 *
 * Accepts a list of recipients and returns the correct disbursement route
 * for each — either a plain transfer or an invoke_contract call for vault addresses.
 *
 * Request body:
 *   { "recipients": [{ "address": "G...|C...", "amountStroops": "10000000" }] }
 *
 * Response:
 *   { success: true, data: { routes: [...] } }
 */
router.post(
  "/resolve-vault-routes",
  validateRequest({ body: resolveRoutesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { recipients } = req.body as z.infer<typeof resolveRoutesSchema>;
    const routes = safeVaultService.resolveRoutes(recipients);
    res.json({ success: true, data: { routes } });
  })
);

export default router;
