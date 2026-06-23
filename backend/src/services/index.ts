// Business logic and service layer
// Handles stream calculations and data processing

export {
  StreamLifecycleService,
  toBigIntOrNull,
  toObjectOrNull,
} from "./stream-lifecycle-service.js";

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
