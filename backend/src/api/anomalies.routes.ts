import { Router, Request, Response } from "express";
import { z } from "zod";
import { AnomalyDetectionService } from "../services/anomaly-detection.service.js";
import validateRequest from "../middleware/validateRequest.js";
import asyncHandler from "../utils/asyncHandler.js";
import { AnomalyType, AnomalySeverity } from "../generated/client/index.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

const getAnomaliesQuerySchema = z.object({
  skip: z.string().optional().transform(val => val ? parseInt(val) : 0),
  take: z.string().optional().transform(val => val ? parseInt(val) : 50),
  type: z.nativeEnum(AnomalyType).optional(),
  severity: z.nativeEnum(AnomalySeverity).optional(),
});

// Get all anomalies (admin only)
router.get(
  "/",
  requireAdmin,
  validateRequest({ query: getAnomaliesQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { skip, take, type, severity } = req.query as any;
    const anomalies = await AnomalyDetectionService.getAnomalies({ skip, take, type, severity });
    res.status(200).json({ data: anomalies });
  })
);

export default router;
