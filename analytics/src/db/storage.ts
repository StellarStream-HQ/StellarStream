import fs from "fs";
import path from "path";
import {
  AnalyticsDatabaseSchema,
  DailyMetricsRollup,
  FeatureUsageRecord,
  GasUsageRecord,
  IndexerState,
  RawContractEvent,
  RetentionCohort,
  StreamRecord,
  StreamWithdrawal,
  TokenTvlSnapshot,
} from "./types.js";

const DEFAULT_STATE: AnalyticsDatabaseSchema = {
  events: [],
  streams: [],
  withdrawals: [],
  tvlSnapshots: [],
  dailyRollups: [],
  retentionCohorts: [],
  gasUsage: [],
  featureUsage: [],
  indexerState: {
    lastLedger: 0,
    lastSyncTimestamp: new Date().toISOString(),
    totalEventsProcessed: 0,
    status: "IDLE",
  },
};

export class AnalyticsDatabase {
  private dbPath: string | null;
  private data: AnalyticsDatabaseSchema;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(filePath?: string) {
    this.dbPath = filePath ?? null;
    this.data = { ...DEFAULT_STATE };
    if (this.dbPath) {
      this.load();
    }
  }

  private load(): void {
    if (!this.dbPath) return;
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, "utf-8");
        const parsed = JSON.parse(raw);
        this.data = {
          ...DEFAULT_STATE,
          ...parsed,
          indexerState: {
            ...DEFAULT_STATE.indexerState,
            ...(parsed.indexerState || {}),
          },
        };
      } else {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.saveSync();
      }
    } catch (err) {
      console.warn(`[AnalyticsDB] Warning: Failed to load ${this.dbPath}, initializing fresh DB:`, err);
      this.data = { ...DEFAULT_STATE };
    }
  }

  public saveSync(): void {
    if (!this.dbPath) return;
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.dbPath);
      this.dirty = false;
    } catch (err) {
      console.error("[AnalyticsDB] Failed to save database to disk:", err);
    }
  }

  public scheduleSave(): void {
    this.dirty = true;
    if (!this.autoSaveTimer) {
      this.autoSaveTimer = setTimeout(() => {
        this.autoSaveTimer = null;
        if (this.dirty) {
          this.saveSync();
        }
      }, 500);
    }
  }

  public clear(): void {
    this.data = {
      events: [],
      streams: [],
      withdrawals: [],
      tvlSnapshots: [],
      dailyRollups: [],
      retentionCohorts: [],
      gasUsage: [],
      featureUsage: [],
      indexerState: {
        lastLedger: 0,
        lastSyncTimestamp: new Date().toISOString(),
        totalEventsProcessed: 0,
        status: "IDLE",
      },
    };
    this.scheduleSave();
  }

  // --- Events ---
  public insertEvent(event: RawContractEvent): boolean {
    const exists = this.data.events.some((e) => e.eventId === event.eventId || (e.txHash === event.txHash && e.topicAction === event.topicAction && e.sender === event.sender));
    if (exists) return false;
    this.data.events.push(event);
    this.scheduleSave();
    return true;
  }

  public insertEvents(events: RawContractEvent[]): number {
    let inserted = 0;
    for (const e of events) {
      if (this.insertEvent(e)) {
        inserted++;
      }
    }
    return inserted;
  }

  public getEvents(filter?: {
    contractVersion?: string;
    action?: string;
    tokenAddress?: string;
    sender?: string;
    receiver?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
    limit?: number;
    offset?: number;
  }): { events: RawContractEvent[]; total: number } {
    let filtered = [...this.data.events];

    if (filter?.contractVersion) {
      filtered = filtered.filter((e) => e.contractVersion === filter.contractVersion);
    }
    if (filter?.action) {
      filtered = filtered.filter((e) => e.topicAction.toLowerCase() === filter.action?.toLowerCase());
    }
    if (filter?.tokenAddress) {
      filtered = filtered.filter((e) => e.tokenAddress.toLowerCase() === filter.tokenAddress?.toLowerCase());
    }
    if (filter?.sender) {
      filtered = filtered.filter((e) => e.sender?.toLowerCase() === filter.sender?.toLowerCase());
    }
    if (filter?.receiver) {
      filtered = filtered.filter((e) => e.receiver?.toLowerCase() === filter.receiver?.toLowerCase());
    }
    if (filter?.fromTimestamp) {
      const fromMs = new Date(filter.fromTimestamp).getTime();
      filtered = filtered.filter((e) => new Date(e.ledgerClosedAt).getTime() >= fromMs);
    }
    if (filter?.toTimestamp) {
      const toMs = new Date(filter.toTimestamp).getTime();
      filtered = filtered.filter((e) => new Date(e.ledgerClosedAt).getTime() <= toMs);
    }

    const total = filtered.length;
    // sort descending by ledger / date
    filtered.sort((a, b) => new Date(b.ledgerClosedAt).getTime() - new Date(a.ledgerClosedAt).getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    return {
      events: filtered.slice(offset, offset + limit),
      total,
    };
  }

  // --- Streams ---
  public upsertStream(stream: StreamRecord): void {
    const index = this.data.streams.findIndex((s) => s.streamId === stream.streamId);
    if (index >= 0) {
      this.data.streams[index] = { ...this.data.streams[index], ...stream };
    } else {
      this.data.streams.push(stream);
    }
    this.scheduleSave();
  }

  public getStream(streamId: string): StreamRecord | undefined {
    return this.data.streams.find((s) => s.streamId === streamId);
  }

  public getStreams(filter?: {
    status?: string;
    tokenAddress?: string;
    tokenSymbol?: string;
    sender?: string;
    receiver?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }): StreamRecord[] {
    let list = [...this.data.streams];
    if (filter?.status) {
      list = list.filter((s) => s.status === filter.status);
    }
    if (filter?.tokenAddress) {
      list = list.filter((s) => s.tokenAddress.toLowerCase() === filter.tokenAddress?.toLowerCase());
    }
    if (filter?.tokenSymbol) {
      list = list.filter((s) => s.tokenSymbol.toLowerCase() === filter.tokenSymbol?.toLowerCase());
    }
    if (filter?.sender) {
      list = list.filter((s) => s.sender.toLowerCase() === filter.sender?.toLowerCase());
    }
    if (filter?.receiver) {
      list = list.filter((s) => s.receiver.toLowerCase() === filter.receiver?.toLowerCase());
    }
    if (filter?.fromTimestamp) {
      const fromMs = new Date(filter.fromTimestamp).getTime();
      list = list.filter((s) => new Date(s.createdAtTime).getTime() >= fromMs);
    }
    if (filter?.toTimestamp) {
      const toMs = new Date(filter.toTimestamp).getTime();
      list = list.filter((s) => new Date(s.createdAtTime).getTime() <= toMs);
    }
    return list;
  }

  // --- Withdrawals ---
  public insertWithdrawal(w: StreamWithdrawal): void {
    const exists = this.data.withdrawals.some((x) => x.id === w.id || (x.txHash === w.txHash && x.streamId === w.streamId));
    if (!exists) {
      this.data.withdrawals.push(w);
      this.scheduleSave();
    }
  }

  public getWithdrawals(filter?: {
    streamId?: string;
    receiver?: string;
    tokenAddress?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }): StreamWithdrawal[] {
    let list = [...this.data.withdrawals];
    if (filter?.streamId) {
      list = list.filter((w) => w.streamId === filter.streamId);
    }
    if (filter?.receiver) {
      list = list.filter((w) => w.receiver.toLowerCase() === filter.receiver?.toLowerCase());
    }
    if (filter?.tokenAddress) {
      list = list.filter((w) => w.tokenAddress.toLowerCase() === filter.tokenAddress?.toLowerCase());
    }
    if (filter?.fromTimestamp) {
      const fromMs = new Date(filter.fromTimestamp).getTime();
      list = list.filter((w) => new Date(w.withdrawnAt).getTime() >= fromMs);
    }
    if (filter?.toTimestamp) {
      const toMs = new Date(filter.toTimestamp).getTime();
      list = list.filter((w) => new Date(w.withdrawnAt).getTime() <= toMs);
    }
    return list;
  }

  // --- TVL Snapshots ---
  public insertTvlSnapshot(snapshot: TokenTvlSnapshot): void {
    const index = this.data.tvlSnapshots.findIndex(
      (s) => s.timestamp === snapshot.timestamp && s.tokenAddress === snapshot.tokenAddress
    );
    if (index >= 0) {
      this.data.tvlSnapshots[index] = snapshot;
    } else {
      this.data.tvlSnapshots.push(snapshot);
    }
    this.scheduleSave();
  }

  public getTvlSnapshots(filter?: {
    tokenAddress?: string;
    tokenSymbol?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }): TokenTvlSnapshot[] {
    let list = [...this.data.tvlSnapshots];
    if (filter?.tokenAddress) {
      list = list.filter((s) => s.tokenAddress.toLowerCase() === filter.tokenAddress?.toLowerCase());
    }
    if (filter?.tokenSymbol) {
      list = list.filter((s) => s.tokenSymbol.toLowerCase() === filter.tokenSymbol?.toLowerCase());
    }
    if (filter?.fromTimestamp) {
      const fromMs = new Date(filter.fromTimestamp).getTime();
      list = list.filter((s) => new Date(s.timestamp).getTime() >= fromMs);
    }
    if (filter?.toTimestamp) {
      const toMs = new Date(filter.toTimestamp).getTime();
      list = list.filter((s) => new Date(s.timestamp).getTime() <= toMs);
    }
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return list;
  }

  // --- Daily Rollups ---
  public upsertDailyRollup(rollup: DailyMetricsRollup): void {
    const index = this.data.dailyRollups.findIndex((r) => r.date === rollup.date);
    if (index >= 0) {
      this.data.dailyRollups[index] = rollup;
    } else {
      this.data.dailyRollups.push(rollup);
    }
    this.scheduleSave();
  }

  public getDailyRollups(fromDate?: string, toDate?: string): DailyMetricsRollup[] {
    let list = [...this.data.dailyRollups];
    if (fromDate) {
      list = list.filter((r) => r.date >= fromDate);
    }
    if (toDate) {
      list = list.filter((r) => r.date <= toDate);
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
    return list;
  }

  // --- Retention Cohorts ---
  public upsertRetentionCohort(cohort: RetentionCohort): void {
    const index = this.data.retentionCohorts.findIndex((c) => c.cohortMonth === cohort.cohortMonth);
    if (index >= 0) {
      this.data.retentionCohorts[index] = cohort;
    } else {
      this.data.retentionCohorts.push(cohort);
    }
    this.scheduleSave();
  }

  public getRetentionCohorts(): RetentionCohort[] {
    const list = [...this.data.retentionCohorts];
    list.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
    return list;
  }

  // --- Gas Usage ---
  public insertGasUsage(record: GasUsageRecord): void {
    this.data.gasUsage.push(record);
    this.scheduleSave();
  }

  public getGasUsage(filter?: {
    contractAction?: string;
    contractVersion?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }): GasUsageRecord[] {
    let list = [...this.data.gasUsage];
    if (filter?.contractAction) {
      list = list.filter((g) => g.contractAction.toLowerCase() === filter.contractAction?.toLowerCase());
    }
    if (filter?.contractVersion) {
      list = list.filter((g) => g.contractVersion === filter.contractVersion);
    }
    if (filter?.fromTimestamp) {
      const fromMs = new Date(filter.fromTimestamp).getTime();
      list = list.filter((g) => new Date(g.recordedAt).getTime() >= fromMs);
    }
    if (filter?.toTimestamp) {
      const toMs = new Date(filter.toTimestamp).getTime();
      list = list.filter((g) => new Date(g.recordedAt).getTime() <= toMs);
    }
    return list;
  }

  // --- Feature Usage ---
  public recordFeatureUsage(featureName: string, version: "V1" | "V2" | "V3", volumeFormatted = 0, isNewUser = false): void {
    const index = this.data.featureUsage.findIndex((f) => f.featureName === featureName && f.contractVersion === version);
    const now = new Date().toISOString();
    if (index >= 0) {
      const existing = this.data.featureUsage[index];
      this.data.featureUsage[index] = {
        ...existing,
        callCount: existing.callCount + 1,
        uniqueUsers: existing.uniqueUsers + (isNewUser ? 1 : 0),
        totalVolumeFormatted: existing.totalVolumeFormatted + volumeFormatted,
        lastUsedAt: now,
      };
    } else {
      this.data.featureUsage.push({
        featureName,
        contractVersion: version,
        callCount: 1,
        uniqueUsers: 1,
        totalVolumeFormatted: volumeFormatted,
        lastUsedAt: now,
      });
    }
    this.scheduleSave();
  }

  public getFeatureUsage(): FeatureUsageRecord[] {
    return [...this.data.featureUsage].sort((a, b) => b.callCount - a.callCount);
  }

  // --- Indexer State ---
  public getIndexerState(): IndexerState {
    return { ...this.data.indexerState };
  }

  public updateIndexerState(state: Partial<IndexerState>): void {
    this.data.indexerState = {
      ...this.data.indexerState,
      ...state,
      lastSyncTimestamp: new Date().toISOString(),
    };
    this.scheduleSave();
  }

  // --- Pruning and Retention ---
  public pruneOldEvents(olderThanDays: number): number {
    if (olderThanDays <= 0) return 0;
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const beforeCount = this.data.events.length;
    this.data.events = this.data.events.filter((e) => new Date(e.ledgerClosedAt).getTime() >= cutoffMs);
    const pruned = beforeCount - this.data.events.length;
    if (pruned > 0) {
      this.scheduleSave();
    }
    return pruned;
  }

  public pruneOldGasRecords(olderThanDays: number): number {
    if (olderThanDays <= 0) return 0;
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const beforeCount = this.data.gasUsage.length;
    this.data.gasUsage = this.data.gasUsage.filter((g) => new Date(g.recordedAt).getTime() >= cutoffMs);
    const pruned = beforeCount - this.data.gasUsage.length;
    if (pruned > 0) {
      this.scheduleSave();
    }
    return pruned;
  }

  // Export full snapshot
  public exportData(): AnalyticsDatabaseSchema {
    return JSON.parse(JSON.stringify(this.data));
  }
}

// Singleton helper
let defaultDbInstance: AnalyticsDatabase | null = null;

export function getDatabase(customPath?: string): AnalyticsDatabase {
  if (!defaultDbInstance || customPath) {
    const dbPath = customPath ?? process.env.ANALYTICS_DB_PATH ?? path.join(process.cwd(), "data", "analytics.json");
    defaultDbInstance = new AnalyticsDatabase(dbPath);
  }
  return defaultDbInstance;
}
