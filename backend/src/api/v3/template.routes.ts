import { Router, Request, Response } from "express";
import { TemplateService } from "../../services/template.service.js";
import { requireOfacCheck } from "../../middleware/requireOfacCheck.js";
import asyncHandler from "../../utils/asyncHandler.js";

const router = Router();
const templateService = new TemplateService();

// ── StreamTemplate CRUD endpoints (#1185) ───────────────────────────────────────

/**
 * GET /api/v3/templates
 * List all templates, optionally filtered by createdBy.
 * Query params:
 *   - createdBy: (optional) Stellar address to filter by
 */
router.get(
  "/templates",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = req.query.createdBy as string | undefined;
    const templates = await templateService.listTemplates(createdBy || undefined);
    res.json(templates);
  })
);

/**
 * POST /api/v3/templates
 * Create a new stream template.
 */
router.post(
  "/templates",
  requireOfacCheck(),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, asset, recipientAddress, splitEnabled, splitAddress, splitPercent, totalAmount, rateType, durationPreset, createdBy } = req.body;

    if (!name?.trim() || !asset?.trim() || !recipientAddress?.trim() || !totalAmount?.trim() || !rateType?.trim() || !durationPreset?.trim() || !createdBy?.trim()) {
      res.status(400).json({ error: "Missing required fields: name, asset, recipientAddress, totalAmount, rateType, durationPreset, createdBy" });
      return;
    }

    try {
      const template = await templateService.createTemplate({
        name: name.trim(),
        asset: asset.trim(),
        recipientAddress: recipientAddress.trim(),
        splitEnabled: splitEnabled ?? false,
        splitAddress: splitAddress?.trim() ?? undefined,
        splitPercent: splitPercent ?? 0,
        totalAmount: totalAmount.trim(),
        rateType: rateType.trim(),
        durationPreset: durationPreset.trim(),
        createdBy: createdBy.trim(),
      });

      res.status(201).json(template);
    } catch (err: any) {
      res.status(422).json({ error: err.message });
    }
  })
);

/**
 * GET /api/v3/templates/:id
 * Get a single template by ID.
 */
router.get(
  "/templates/:id",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const template = await templateService.getTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  })
);

/**
 * PUT /api/v3/templates/:id
 * Update an existing template. Only whitelisted fields are applied.
 */
router.put(
  "/templates/:id",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    try {
      const template = await templateService.updateTemplate(req.params.id, req.body);
      if (!template) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      res.json(template);
    } catch (err: any) {
      res.status(422).json({ error: err.message });
    }
  })
);

/**
 * DELETE /api/v3/templates/:id
 * Delete a template by ID.
 */
router.delete(
  "/templates/:id",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const template = await templateService.deleteTemplate(req.params.id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ deleted: true, id: template.id });
  })
);

/**
 * POST /api/v3/templates/:id/use
 * Increment the usage count when a stream is created from this template.
 */
router.post(
  "/templates/:id/use",
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const template = await templateService.incrementUsage(req.params.id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ usageCount: template.usageCount });
  })
);

// ── CSV template download (existing, unchanged) ─────────────────────────────────

/**
 * GET /api/v3/tools/download-template
 *
 * Dynamically generates a CSV template based on optional query parameters.
 */
router.get("/tools/download-template", (req: Request, res: Response) => {
  const includeAsset = req.query.includeAsset !== "false";
  const includeMemo = req.query.includeMemo !== "false";

  const headers: string[] = ["Address", "Amount"];
  if (includeAsset) headers.push("Asset");
  if (includeMemo) headers.push("Memo (Optional)");

  const exampleRow: string[] = ["GABC...XYZ", "100.00"];
  if (includeAsset) exampleRow.push("native");
  if (includeMemo) exampleRow.push("");

  const csv = [headers.join(","), exampleRow.join(","), ""].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="stellarstream-template.csv"',
  );
  res.send(csv);
});

export default router;
