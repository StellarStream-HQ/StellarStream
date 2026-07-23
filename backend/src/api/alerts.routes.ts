import { Router, Request, Response } from "express";
import { z } from "zod";
import { AnomalyDetectionService } from "../services/anomaly-detection.service.js";
import validateRequest from "../middleware/validateRequest.js";
import asyncHandler from "../utils/asyncHandler.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

const getAlertsQuerySchema = z.object({
  skip: z.string().optional().transform(val => val ? parseInt(val) : 0),
  take: z.string().optional().transform(val => val ? parseInt(val) : 50),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]).optional(),
});

const updateAlertBodySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
  resolvedBy: z.string().optional(),
  notes: z.string().optional(),
});

// Get all alerts (admin only)
router.get(
  "/",
  requireAdmin,
  validateRequest({ query: getAlertsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { skip, take, status } = req.query as any;
    const alerts = await AnomalyDetectionService.getAlerts({ skip, take, status });
    res.status(200).json({ data: alerts });
  })
);

// Update alert status (admin only)
router.patch(
  "/:alertId",
  requireAdmin,
  validateRequest({ body: updateAlertBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { alertId } = req.params;
    const { status, resolvedBy, notes } = req.body;
    const alert = await AnomalyDetectionService.updateAlertStatus(alertId, status, resolvedBy, notes);
    res.status(200).json({ data: alert });
  })
);

export default router;
