import { AnalyticsDatabase } from "./storage.js";

export interface RetentionPolicyConfig {
  rawEventsDays: number; // e.g. 90 days for raw event payloads
  gasRecordsDays: number; // e.g. 180 days for granular tx gas logs
  hourlyRollupDays: number; // e.g. 365 days
  dailyRollupDays: number; // 0 = keep permanently
}

export interface RetentionRunResult {
  timestamp: string;
  prunedRawEvents: number;
  prunedGasRecords: number;
  dailyRollupsCount: number;
  activeStreamsCount: number;
  totalTvlSnapshotsCount: number;
}

export class RetentionManager {
  private db: AnalyticsDatabase;
  private config: RetentionPolicyConfig;

  constructor(db: AnalyticsDatabase, config?: Partial<RetentionPolicyConfig>) {
    this.db = db;
    this.config = {
      rawEventsDays: config?.rawEventsDays ?? parseInt(process.env.RETENTION_RAW_EVENTS_DAYS || "90", 10),
      gasRecordsDays: config?.gasRecordsDays ?? 180,
      hourlyRollupDays: config?.hourlyRollupDays ?? parseInt(process.env.RETENTION_HOURLY_ROLLUP_DAYS || "365", 10),
      dailyRollupDays: config?.dailyRollupDays ?? parseInt(process.env.RETENTION_DAILY_ROLLUP_DAYS || "0", 10),
    };
  }

  /**
   * Execute historical data retention run.
   * Prunes low-level transaction payloads while ensuring daily aggregates
   * and active state remain permanently available for analytical reporting.
   */
  public executeRetentionPolicy(): RetentionRunResult {
    const prunedRawEvents = this.db.pruneOldEvents(this.config.rawEventsDays);
    const prunedGasRecords = this.db.pruneOldGasRecords(this.config.gasRecordsDays);

    const rollups = this.db.getDailyRollups();
    const activeStreams = this.db.getStreams({ status: "ACTIVE" });
    const tvlSnapshots = this.db.getTvlSnapshots();

    return {
      timestamp: new Date().toISOString(),
      prunedRawEvents,
      prunedGasRecords,
      dailyRollupsCount: rollups.length,
      activeStreamsCount: activeStreams.length,
      totalTvlSnapshotsCount: tvlSnapshots.length,
    };
  }

  public getConfig(): RetentionPolicyConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<RetentionPolicyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}
