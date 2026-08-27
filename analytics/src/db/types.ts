export type ContractVersion = "V1" | "V2" | "V3";

export type StreamStatus = "ACTIVE" | "COMPLETED" | "CANCELLED" | "PAUSED";

export interface RawContractEvent {
  id: string;
  eventId: string;
  contractId: string;
  contractVersion: ContractVersion;
  topicAction: "create" | "withdraw" | "cancel" | "pause" | "resume" | string;
  ledger: number;
  ledgerClosedAt: string; // ISO 8601
  txHash: string;
  sender?: string;
  receiver?: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amount?: string; // Stroops or smallest unit
  amountFormatted?: number; // Standard float representation
  startTime?: number; // Unix timestamp seconds
  endTime?: number; // Unix timestamp seconds
  durationSeconds?: number;
  gasConsumed?: number; // CPU instructions or gas units
  feeChargedStroops?: number;
  memoryBytes?: number;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface StreamRecord {
  streamId: string;
  contractId: string;
  contractVersion: ContractVersion;
  sender: string;
  receiver: string;
  tokenAddress: string;
  tokenSymbol: string;
  totalAmount: string;
  totalAmountFormatted: number;
  withdrawnAmount: string;
  withdrawnAmountFormatted: number;
  status: StreamStatus;
  createdAtLedger: number;
  createdAtTime: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  ratePerSecondFormatted: number;
  cancelledAtTime?: string;
  refundAmount?: string;
  refundAmountFormatted?: number;
  lastWithdrawnAt?: string;
  withdrawalCount: number;
}

export interface StreamWithdrawal {
  id: string;
  streamId: string;
  contractId: string;
  txHash: string;
  receiver: string;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string;
  amountFormatted: number;
  elapsedSeconds: number;
  percentageWithdrawn: number;
  gasCost: number;
  feeStroops: number;
  withdrawnAt: string;
}

export interface TokenTvlSnapshot {
  id: string;
  timestamp: string; // ISO string rounded to hour/day
  tokenAddress: string;
  tokenSymbol: string;
  totalDepositedFormatted: number;
  totalWithdrawnFormatted: number;
  activeTvlFormatted: number;
  activeStreamCount: number;
}

export interface DailyMetricsRollup {
  date: string; // YYYY-MM-DD
  streamsCreated: number;
  streamsCompleted: number;
  streamsCancelled: number;
  streamsActive: number;
  totalVolumeStreamedFormatted: number;
  totalWithdrawnFormatted: number;
  activeTvlFormatted: number;
  avgDurationSeconds: number;
  avgStreamAmountFormatted: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  totalGasConsumed: number;
  avgTxGas: number;
  totalFeesStroops: number;
  cancellationRate: number;
}

export interface RetentionCohort {
  cohortMonth: string; // YYYY-MM
  cohortSize: number;
  activeSenders: number;
  day1RetentionRate: number; // 0 to 100
  day7RetentionRate: number;
  day14RetentionRate: number;
  day30RetentionRate: number;
  day60RetentionRate: number;
  day90RetentionRate: number;
  repeatStreamerRate: number;
  avgStreamsPerUser: number;
}

export interface GasUsageRecord {
  id: string;
  txHash: string;
  contractAction: string;
  contractVersion: ContractVersion;
  cpuInstructions: number;
  memoryBytes: number;
  feeChargedStroops: number;
  ledgerNumber: number;
  recordedAt: string;
}

export interface FeatureUsageRecord {
  featureName: string;
  contractVersion: ContractVersion;
  callCount: number;
  uniqueUsers: number;
  totalVolumeFormatted: number;
  lastUsedAt: string;
}

export interface IndexerState {
  lastLedger: number;
  lastSyncTimestamp: string;
  totalEventsProcessed: number;
  status: "RUNNING" | "PAUSED" | "ERROR" | "IDLE";
  errorMessage?: string;
}

export interface AnalyticsDatabaseSchema {
  events: RawContractEvent[];
  streams: StreamRecord[];
  withdrawals: StreamWithdrawal[];
  tvlSnapshots: TokenTvlSnapshot[];
  dailyRollups: DailyMetricsRollup[];
  retentionCohorts: RetentionCohort[];
  gasUsage: GasUsageRecord[];
  featureUsage: FeatureUsageRecord[];
  indexerState: IndexerState;
}
