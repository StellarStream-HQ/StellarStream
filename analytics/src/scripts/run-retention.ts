import { getDatabase } from "../db/storage.js";
import { RetentionManager } from "../db/retention.js";

export function runRetention() {
  console.log("[Retention Worker] Starting analytics retention cleanup...");
  const db = getDatabase();
  const manager = new RetentionManager(db);
  const result = manager.executeRetentionPolicy();

  console.log("[Retention Worker] Retention run complete:");
  console.log(` - Pruned raw events older than ${manager.getConfig().rawEventsDays}d: ${result.prunedRawEvents}`);
  console.log(` - Pruned gas records older than ${manager.getConfig().gasRecordsDays}d: ${result.prunedGasRecords}`);
  console.log(` - Active streams preserved: ${result.activeStreamsCount}`);
  console.log(` - Daily metric rollups preserved: ${result.dailyRollupsCount}`);
  console.log(` - TVL snapshots preserved: ${result.totalTvlSnapshotsCount}`);
}

if (process.argv[1] && (process.argv[1].endsWith("run-retention.ts") || process.argv[1].endsWith("run-retention.js"))) {
  runRetention();
}
