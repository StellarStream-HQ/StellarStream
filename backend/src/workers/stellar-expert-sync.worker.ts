import { syncCachedAssets } from '../api/v3/cached-assets.routes';
import { logger } from '../logger.js';

/**
 * Daily cron job to sync Stellar-Expert asset metadata
 * Runs at 2 AM UTC daily
 */
export async function stellarExpertSyncWorker(): Promise<void> {
  try {
    logger.info('Starting Stellar-Expert sync worker');
    const syncedCount = await syncCachedAssets();
    logger.info(`Stellar-Expert sync completed: ${syncedCount} assets synced`);
  } catch (error) {
    logger.error('Stellar-Expert sync worker failed:', error);
  }
}

// Export for PM2 ecosystem or cron scheduler
export default stellarExpertSyncWorker;
