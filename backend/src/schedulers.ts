import cron from "node-cron";
import { PriceService } from "./services/price.service.js";
import { TvlAggregatorService } from "./services/tvl-aggregator.service.js";
import { AssetMetadataService } from "./services/asset-metadata.service.js";
import { StellarExpertEnrichmentWorker } from "./services/stellar-expert-enrichment.service.js";
import { DisbursementArchivalWorker } from "./workers/disbursement-archival.worker.js";
import { AutopilotService } from "./services/autopilot.service.js";
import { MultisigNotifierService } from "./services/multisig-notifier.service.js";
import { archiveOldDisbursements } from "./services/disbursement-archive.service.js";
import { LedgerConsistencyChecker } from "./services/ledger-consistency.service.js";
import { V3VolumeAggregatorService } from "./services/v3-volume-aggregator.service.js";
import { scheduleWeeklyForecastReport, scheduleDailyForecastCacheWarm } from "./schedulers/forecast-scheduler.js";
import { complianceReportService } from "./services/compliance-report.service.js";
import { logger } from "./logger.js";

const priceService = new PriceService();
const tvlService = new TvlAggregatorService();
const assetService = new AssetMetadataService();
const stellarExpertWorker = new StellarExpertEnrichmentWorker();
const disbursementArchiver = new DisbursementArchivalWorker();
const autopilotService = new AutopilotService();

/**
 * Update prices every 5 minutes (300 seconds)
 */
export function schedulePriceUpdates() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      logger.info("Starting scheduled price update");
      await priceService.updateAllPrices();
      logger.info("Price update completed");
    } catch (error) {
      logger.error("Failed to update prices in scheduled task", error);
    }
  });

  logger.info("Price update scheduler started (every 5 minutes)");
}

/**
 * Update global stats every 10 minutes
 */
export function scheduleGlobalStatsUpdate() {
  cron.schedule("*/10 * * * *", async () => {
    try {
      logger.info("Starting scheduled global stats aggregation");
      await tvlService.aggregateStats();
      logger.info("Global stats aggregation completed");
    } catch (error) {
      logger.error("Failed to aggregate stats in scheduled task", error);
    }
  });

  logger.info("Global stats scheduler started (every 10 minutes)");
}

/**
 * Save daily TVL snapshot at midnight UTC
 */
export function scheduleDailyTvlSnapshot() {
  cron.schedule("0 0 * * *", async () => {
    try {
      logger.info("Starting daily TVL snapshot");
      await tvlService.saveDailySnapshot();
      logger.info("Daily TVL snapshot completed");
    } catch (error) {
      logger.error("Failed to save daily TVL snapshot", error);
    }
  });

  logger.info("Daily TVL snapshot scheduler started (midnight UTC)");
}

/**
 * Discover new asset metadata every 6 hours
 */
export function scheduleAssetDiscovery() {
  cron.schedule("0 */6 * * *", async () => {
    try {
      logger.info("Starting scheduled asset discovery");
      await assetService.discoverNewAssets();
      logger.info("Asset discovery completed");
    } catch (error) {
      logger.error("Failed to discover new assets in scheduled task", error);
    }
  });

  logger.info("Asset discovery scheduler started (every 6 hours)");
}

/**
 * Enrich assets with Stellar-Expert data every 12 hours
 */
export function scheduleStellarExpertEnrichment() {
  cron.schedule("0 */12 * * *", async () => {
    try {
      logger.info("Starting Stellar-Expert enrichment");
      await stellarExpertWorker.enrichBatch();
      logger.info("Stellar-Expert enrichment completed");
    } catch (error) {
      logger.error("Failed to enrich assets in scheduled task", error);
    }
  });

  logger.info("Stellar-Expert enrichment scheduler started (every 12 hours)");
}

/**
 * Archive old disbursements monthly (1st of month at 3 AM UTC)
 */
export function scheduleDisbursementArchival() {
  cron.schedule("0 3 1 * *", async () => {
    try {
      logger.info("Starting disbursement archival");
      const archived = await disbursementArchiver.archiveOldDisbursements();
      logger.info("Disbursement archival completed", { archived });
    } catch (error) {
      logger.error("Failed to archive disbursements in scheduled task", error);
    }
  });

  logger.info("Disbursement archival scheduler started (monthly on 1st at 3 AM UTC)");
}

/**
 * Initialize all scheduled tasks
 */
export function initializeSchedulers() {
  schedulePriceUpdates();
  scheduleGlobalStatsUpdate();
  scheduleDailyTvlSnapshot();
  scheduleAssetDiscovery();
  scheduleStellarExpertEnrichment();
  scheduleDisbursementArchival();
  scheduleAutopilot();
  scheduleMultisigNotifier();
  scheduleDisbursementArchive();
  scheduleLedgerConsistencyCheck();
  scheduleV3VolumeAggregation();
  scheduleComplianceReportGeneration();
  scheduleWeeklyEmailSummaries();
}

/**
 * Autopilot: scan for due periodic split schedules every hour.
 */
export function scheduleAutopilot() {
  cron.schedule("0 * * * *", async () => {
    try {
      logger.info("[Autopilot] Starting hourly schedule scan");
      await autopilotService.runDueSchedules();
      logger.info("[Autopilot] Hourly schedule scan completed");
    } catch (error) {
      logger.error("[Autopilot] Hourly scan failed", error);
    }
  });

  logger.info("Autopilot scheduler started (every hour)");
}

/**
 * Multi-sig notifier: ping signers 24 hours before a scheduled split's release time.
 * Runs every hour — idempotent (notifiedAt prevents duplicate alerts).
 */
export function scheduleMultisigNotifier() {
  const notifier = new MultisigNotifierService();

  cron.schedule("0 * * * *", async () => {
    try {
      logger.info("[MultisigNotifier] Starting 24-hour window scan");
      await notifier.notifyPendingSigners();
      logger.info("[MultisigNotifier] 24-hour window scan completed");
    } catch (error) {
      logger.error("[MultisigNotifier] Scan failed", error);
    }
  });

  logger.info("Multi-sig notifier scheduler started (every hour)");
}

/**
 * Disbursement Archive (#845): move EventLog rows older than 1 year to cold storage.
 * Runs on the 1st of every month at 02:00 UTC.
 */
export function scheduleDisbursementArchive() {
  cron.schedule("0 2 1 * *", async () => {
    try {
      logger.info("[DisbursementArchive] Starting monthly archive job");
      await archiveOldDisbursements();
      logger.info("[DisbursementArchive] Monthly archive job completed");
    } catch (error) {
      logger.error("[DisbursementArchive] Monthly archive job failed", error);
    }
  });

  logger.info("Disbursement archive scheduler started (1st of each month, 02:00 UTC)");
}

/**
 * Ledger Consistency Checker (#849): verify DB entries against the Stellar ledger.
 * Runs every 6 hours.
 */
export function scheduleLedgerConsistencyCheck() {
  const checker = new LedgerConsistencyChecker();

  cron.schedule("0 */6 * * *", async () => {
    try {
      logger.info("[LedgerConsistency] Starting consistency audit");
      await checker.run();
      logger.info("[LedgerConsistency] Consistency audit completed");
    } catch (error) {
      logger.error("[LedgerConsistency] Consistency audit failed", error);
    }
  });

  logger.info("Ledger consistency checker started (every 6 hours)");
}

/**
 * #649 — V3 Volume Aggregator: update GlobalStats_V3 daily at 00:05 UTC.
 */
export function scheduleV3VolumeAggregation() {
  const v3Aggregator = new V3VolumeAggregatorService();

  cron.schedule("5 0 * * *", async () => {
    try {
      logger.info("[V3VolumeAggregator] Starting daily aggregation");
      await v3Aggregator.aggregateStats();
      logger.info("[V3VolumeAggregator] Daily aggregation completed");
    } catch (error) {
      logger.error("[V3VolumeAggregator] Daily aggregation failed", error);
    }
  });

  logger.info("V3 volume aggregator scheduler started (daily at 00:05 UTC)");
}

/**
 * Compliance Reports (#1359): automatically generate the previous calendar
 * month's regulatory filing bundle and audit trail report.
 * Runs on the 1st of every month at 04:00 UTC — after disbursement archival
 * (03:00) so the period's data is settled.
 */
export function scheduleComplianceReportGeneration() {
  cron.schedule("0 4 1 * *", async () => {
    try {
      logger.info("[ComplianceReport] Starting monthly automated report generation");

      const periodEnd = new Date();
      periodEnd.setUTCDate(1);
      periodEnd.setUTCHours(0, 0, 0, 0);
      const periodStart = new Date(periodEnd);
      periodStart.setUTCMonth(periodStart.getUTCMonth() - 1);

      for (const reportType of ["REGULATORY_FILING", "AUDIT_TRAIL"] as const) {
        await complianceReportService.generateReport({
          reportType,
          format: "pdf",
          periodStart,
          periodEnd,
          generatedBy: "system-scheduler",
        });
      }

      logger.info("[ComplianceReport] Monthly automated report generation completed", {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      });
    } catch (error) {
      logger.error("[ComplianceReport] Monthly automated report generation failed", error);
    }
  });

  logger.info("Compliance report scheduler started (monthly on 1st at 04:00 UTC)");
}

/**
 * Email Weekly Summaries (#1004): send weekly summary emails to all
 * subscribers every Monday at 08:00 UTC.
 */
export function scheduleWeeklyEmailSummaries() {
  cron.schedule("0 8 * * 1", async () => {
    try {
      logger.info("[EmailNotification] Starting weekly summary dispatch");
      const { emailService } = await import("./services/email.service.js");
      const result = await emailService.sendWeeklySummaries();
      logger.info("[EmailNotification] Weekly summary dispatch completed", result);
    } catch (error) {
      logger.error("[EmailNotification] Weekly summary dispatch failed", error);
    }
  });

  logger.info("Weekly email summary scheduler started (every Monday at 08:00 UTC)");
}
