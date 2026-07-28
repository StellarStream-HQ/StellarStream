/**
 * Snapshot Scheduler
 * Runs monthly snapshot and archival tasks
 */

// import { SnapshotService } from "../services/snapshot.service";
import { logger } from "../logger.js";

const snapshotService = new SnapshotService();

/**
 * Schedule snapshot maintenance to run monthly
 * Runs on the 1st of each month at 2 AM
 */
export function scheduleSnapshotMaintenance() {
  const runMaintenance = async () => {
    try {
      logger.info("Starting monthly snapshot maintenance");
      const result = await snapshotService.runMaintenance();
      logger.info("Monthly snapshot maintenance completed", result);
    } catch (error) {
      logger.error("Monthly snapshot maintenance failed", error);
    }
  };

  // Calculate time until next run (1st of next month at 2 AM)
  const scheduleNext = () => {
    const now = new Date();
    const nextRun = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      2,
      0,
      0,
      0
    );
    
    const delay = nextRun.getTime() - now.getTime();
    
    logger.info("Scheduled next snapshot maintenance", {
      nextRun: nextRun.toISOString(),
      delayMs: delay,
    });

    setTimeout(async () => {
      await runMaintenance();
      scheduleNext(); // Schedule next run
    }, delay);
  };

  scheduleNext();
  logger.info("Snapshot maintenance scheduler initialized");
}

/**
 * Run maintenance immediately (for manual triggers or testing)
 */
export async function runMaintenanceNow() {
  const snapshotService = new SnapshotService();
  return snapshotService.runMaintenance();
}
