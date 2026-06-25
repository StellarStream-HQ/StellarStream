// API routes and controllers
// Will contain REST API endpoints for querying stream data

import { Router } from "express";
import clawbackRoutes from "./clawback.routes.js";

const router = Router();

/**
 * V2 API Routes — clawback
 * POST   /api/v2/streams/:streamId/clawback
 * GET    /api/v2/streams/:streamId/clawback/status
 * GET    /api/v2/streams/:streamId/clawback/history
 */
router.use("/v2/streams/:streamId/clawback", clawbackRoutes);

export default router;

export {};