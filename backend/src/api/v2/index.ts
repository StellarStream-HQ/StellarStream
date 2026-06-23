import { Router } from "express";
import { responseWrapper } from "../../middleware/responseWrapper.js";

import analyticsRouter from "./analytics.routes.js";
import priceRouter from "./price.routes.js";
import assetRouter from "./asset.routes.js";
import streamsRouter from "./streams.routes.js";
import statsRouter from "./stats.routes.js";
import affiliateRouter from "../affiliate.routes.js";
import adminAssetsRouter from "./admin/assets.routes.js";
import healthRouter from "./health.routes.js";
import trustRouter from "./trust.routes.js";
import dustRecoveryRouter from "./dust-recovery.routes.js";

const router = Router();

// Apply standard JSON response wrapper to all V2 endpoints
router.use(responseWrapper);

router.use("/analytics", analyticsRouter);
router.use("/prices", priceRouter);
router.use("/assets", assetRouter);
router.use("/streams", streamsRouter);
router.use("/stats", statsRouter);
router.use("/affiliate", affiliateRouter);
router.use("/admin/assets", adminAssetsRouter);
router.use("/dust", dustRecoveryRouter);
router.use("/", trustRouter);
router.use("/", healthRouter);

export default router;
