// Business logic and service layer
// Handles stream calculations and data processing

export {
  StreamLifecycleService,
  toBigIntOrNull,
  toObjectOrNull,
} from "./stream-lifecycle-service.js";

export {
  ClawbackService,
  getClawbackService,
  ValidationResult,
  ClawbackRecord,
  ClawbackExecuteInput,
} from "./clawback.service.js";

// Payment Dispute Resolution System (#DISPUTES)
export {
  DisputeService,
  getDisputeService,
  DisputeRecord,
  DisputeStatus,
  DisputeDecision,
  DisputeAction,
  FileDisputeInput,
  AddEvidenceInput,
  TransitionDisputeInput,
  ResolveDisputeInput,
  DisputeListFilters,
} from "./dispute.service.js";

export { LedgerVerificationService } from "./ledger-verification.service.js";
export { AuditLogService } from "./audit-log.service.js";
export { AuditChainVerificationService } from "./audit-chain-verification.service.js";

// Event sourcing services for immutable audit trail
export { EventSourceService, type EventData, type EventChainEntry } from "./event-source.service.js";
export { HashChainVerificationService, type VerificationResult } from "./hash-chain-verification.service.js";
export { StreamMigrationService } from "./stream-migration.service.js";

export {
  BatchMetadataService,
  type BatchMetadataResponse,
  type StreamMetadataResult,
  type StreamMetadataError,
} from "./batch-metadata.service.js";

export { SnapshotService } from "./snapshot.service.js";
export {
  scheduleSnapshotMaintenance,
  runMaintenanceNow,
} from "./snapshot.scheduler.js";

export { WebhookService } from "./webhook.service.js";

// Bridge landing / cross-chain listener
export {
  BridgeListenerService,
  type BridgeLandingEvent,
} from "./bridge-listener.service.js";

// Background cleanup for stale streams
export {
  StaleStreamCleanupService,
  type CleanupResult,
} from "./stale-stream-cleanup.service.js";

export {
  GasTankService,
  type GasTankStatus,
  type GasTankConfig,
} from "./gas-tank.service.js";

export {
  DataIntegrityService,
  type DataIntegrityMismatch,
  type DataIntegrityReport,
} from "./data-integrity.service.js";

export {
  YieldAccrualService,
  type YieldAccrualReport,
  type YieldAccrualUpdate,
} from "./yield-accrual.service.js";

// Real-time push notifications
export { WarpService, type WarpEventPayload } from "./warp.service.js";

// Bridge observer for cross-chain transfers
export { BridgeObserverService, type BridgeTransferEvent } from "./bridge-observer.service.js";

// TTL archival monitoring
export { TTLArchivalMonitorService, type StreamTTLStatus } from "./ttl-archival-monitor.service.js";

// Template service (#1185)
export { TemplateService, type CreateTemplateInput, type UpdateTemplateInput } from "./template.service.js";

// Forecasting service for ML-based payment predictions
export {
  ForecastingService,
  type VolumeForecast,
  type VolumePrediction,
  type FailureRateForecast,
  type FailureRatePrediction,
  type CostForecast,
  type CostEstimate,
  type PeakTimeResult,
  type PeakTimeSlot,
  type AnomalyDetectionResult,
  type AnomalyPoint,
  type WeeklyForecastReport,
} from "./forecasting.service.js";

// Geolocation service for compliance and analytics
export {
  GeolocationService,
  geolocationService,
  type GeoLocation,
  type GeoRestrictionCheck,
  type GeoAnalyticsSummary,
  hashIP,
  getTimezoneForCountry,
} from "./geolocation.service.js";
// Fee Optimization service (#1363)
export {
  FeeOptimizationService,
  type FeeWindow,
  type BestTimeResult,
  type BatchOptimizationInput,
  type BatchOptimizationResult,
  type RouteFeeEstimate,
  type RouteSelectionResult,
  type FeePrediction,
  type FeePredictionResult,
  type CostReportEntry,
  type CostReport,
  type OptimizationSummary,
  type FeeOptimizationAction,
  type AutoOptimizationResult,
} from "./fee-optimization.service.js";

// Payment Reversal service (#1374)
export {
  PaymentReversalService,
  type ReversalReason,
  type ReversalStatus,
  type CreateReversalInput,
  type ReversalResult,
  type ReversalAuditEntry,
  type ReversalLimits,
  type ReversalStats,
  MAX_REVERSAL_PERCENT,
  MAX_DAILY_REVERSAL_STROOPS,
  MAX_REVERSAL_AGE_DAYS,
} from "./payment-reversal.service.js";
