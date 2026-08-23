
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.PaymentCategoryScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  color: 'color',
  icon: 'icon',
  ownerAddress: 'ownerAddress',
  isDefault: 'isDefault',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentMetadataScalarFieldEnum = {
  id: 'id',
  entityType: 'entityType',
  entityId: 'entityId',
  key: 'key',
  value: 'value',
  ownerAddress: 'ownerAddress',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentAuthorizationScalarFieldEnum = {
  id: 'id',
  payerAddress: 'payerAddress',
  payeeAddress: 'payeeAddress',
  tokenAddress: 'tokenAddress',
  amount: 'amount',
  capturedAmount: 'capturedAmount',
  status: 'status',
  holdPeriodSecs: 'holdPeriodSecs',
  authorizedAt: 'authorizedAt',
  expiresAt: 'expiresAt',
  releasedAt: 'releasedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentCaptureScalarFieldEnum = {
  id: 'id',
  authorizationId: 'authorizationId',
  amount: 'amount',
  txHash: 'txHash',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentCategoryRuleScalarFieldEnum = {
  id: 'id',
  categoryId: 'categoryId',
  field: 'field',
  operator: 'operator',
  value: 'value',
  priority: 'priority',
  createdAt: 'createdAt'
};

exports.Prisma.StreamScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  txHash: 'txHash',
  version: 'version',
  sender: 'sender',
  receiver: 'receiver',
  contractId: 'contractId',
  tokenAddress: 'tokenAddress',
  amount: 'amount',
  duration: 'duration',
  status: 'status',
  withdrawn: 'withdrawn',
  legacy: 'legacy',
  migrated: 'migrated',
  isPrivate: 'isPrivate',
  yieldEnabled: 'yieldEnabled',
  vaultContractId: 'vaultContractId',
  vaultShareBalance: 'vaultShareBalance',
  vaultRatioScale: 'vaultRatioScale',
  accruedInterest: 'accruedInterest',
  lastYieldAccrualAt: 'lastYieldAccrualAt',
  isDust: 'isDust',
  affiliateId: 'affiliateId',
  categoryId: 'categoryId',
  startTime: 'startTime',
  endTime: 'endTime',
  cliffTime: 'cliffTime',
  isSoulbound: 'isSoulbound',
  isFrozen: 'isFrozen',
  pausedDuration: 'pausedDuration',
  vaultAddress: 'vaultAddress',
  vaultShares: 'vaultShares',
  createdAt: 'createdAt'
};

exports.Prisma.ContractEventScalarFieldEnum = {
  id: 'id',
  eventId: 'eventId',
  contractId: 'contractId',
  txHash: 'txHash',
  eventType: 'eventType',
  eventIndex: 'eventIndex',
  ledgerSequence: 'ledgerSequence',
  ledgerClosedAt: 'ledgerClosedAt',
  topicXdr: 'topicXdr',
  valueXdr: 'valueXdr',
  decodedJson: 'decodedJson',
  createdAt: 'createdAt'
};

exports.Prisma.TokenPriceScalarFieldEnum = {
  tokenAddress: 'tokenAddress',
  symbol: 'symbol',
  decimals: 'decimals',
  priceUsd: 'priceUsd',
  updatedAt: 'updatedAt'
};

exports.Prisma.WebhookScalarFieldEnum = {
  id: 'id',
  url: 'url',
  description: 'description',
  eventType: 'eventType',
  secretKey: 'secretKey',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WebhookDeliveryScalarFieldEnum = {
  id: 'id',
  webhookId: 'webhookId',
  eventType: 'eventType',
  payload: 'payload',
  status: 'status',
  attempts: 'attempts',
  maxRetries: 'maxRetries',
  nextRetryAt: 'nextRetryAt',
  lastError: 'lastError',
  lastStatusCode: 'lastStatusCode',
  lastAttemptAt: 'lastAttemptAt',
  deliveredAt: 'deliveredAt',
  deadLetteredAt: 'deadLetteredAt',
  deadLetterReason: 'deadLetterReason',
  lockedAt: 'lockedAt',
  lockedBy: 'lockedBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SyncStateScalarFieldEnum = {
  id: 'id',
  lastLedgerSequence: 'lastLedgerSequence'
};

exports.Prisma.EventLogScalarFieldEnum = {
  id: 'id',
  eventType: 'eventType',
  streamId: 'streamId',
  txHash: 'txHash',
  eventIndex: 'eventIndex',
  ledger: 'ledger',
  ledgerClosedAt: 'ledgerClosedAt',
  sender: 'sender',
  receiver: 'receiver',
  amount: 'amount',
  metadata: 'metadata',
  parentHash: 'parentHash',
  entryHash: 'entryHash',
  createdAt: 'createdAt'
};

exports.Prisma.StreamSnapshotScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  sender: 'sender',
  receiver: 'receiver',
  tokenAddress: 'tokenAddress',
  amountPerSecond: 'amountPerSecond',
  totalAmount: 'totalAmount',
  status: 'status',
  snapshotMonth: 'snapshotMonth',
  createdAt: 'createdAt'
};

exports.Prisma.ContractStateSnapshotScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  contractId: 'contractId',
  snapshotTime: 'snapshotTime',
  snapshotHour: 'snapshotHour',
  sender: 'sender',
  receiver: 'receiver',
  tokenAddress: 'tokenAddress',
  totalAmount: 'totalAmount',
  withdrawnAmount: 'withdrawnAmount',
  cliffTime: 'cliffTime',
  startTime: 'startTime',
  endTime: 'endTime',
  state: 'state',
  curveType: 'curveType',
  isSoulbound: 'isSoulbound',
  isFrozen: 'isFrozen',
  pausedDuration: 'pausedDuration',
  vaultAddress: 'vaultAddress',
  vaultShares: 'vaultShares',
  metadataHash: 'metadataHash',
  compressedState: 'compressedState',
  previousSnapshotId: 'previousSnapshotId'
};

exports.Prisma.StreamArchiveScalarFieldEnum = {
  id: 'id',
  eventType: 'eventType',
  streamId: 'streamId',
  txHash: 'txHash',
  ledger: 'ledger',
  ledgerClosedAt: 'ledgerClosedAt',
  sender: 'sender',
  receiver: 'receiver',
  amount: 'amount',
  metadata: 'metadata',
  createdAt: 'createdAt',
  archivedAt: 'archivedAt'
};

exports.Prisma.BridgeLogScalarFieldEnum = {
  id: 'id',
  bridge: 'bridge',
  eventType: 'eventType',
  sourceChain: 'sourceChain',
  targetChain: 'targetChain',
  sourceAsset: 'sourceAsset',
  targetAsset: 'targetAsset',
  amount: 'amount',
  sender: 'sender',
  recipient: 'recipient',
  txHash: 'txHash',
  status: 'status',
  payload: 'payload',
  landedAt: 'landedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProposalScalarFieldEnum = {
  id: 'id',
  creator: 'creator',
  description: 'description',
  quorum: 'quorum',
  votesFor: 'votesFor',
  votesAgainst: 'votesAgainst',
  txHash: 'txHash',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EventScalarFieldEnum = {
  id: 'id',
  eventId: 'eventId',
  streamId: 'streamId',
  eventType: 'eventType',
  payload: 'payload',
  timestamp: 'timestamp',
  hash: 'hash',
  previousHash: 'previousHash'
};

exports.Prisma.ReplayCheckpointScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  eventId: 'eventId',
  label: 'label',
  createdAt: 'createdAt'
};

exports.Prisma.ReplayRunScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  fromEventId: 'fromEventId',
  toEventId: 'toEventId',
  eventCount: 'eventCount',
  reconstructedStatus: 'reconstructedStatus',
  reconstructedWithdrawn: 'reconstructedWithdrawn',
  matchesLive: 'matchesLive',
  differences: 'differences',
  durationMs: 'durationMs',
  createdAt: 'createdAt'
};

exports.Prisma.OrganizationMemberScalarFieldEnum = {
  id: 'id',
  orgAddress: 'orgAddress',
  memberAddress: 'memberAddress',
  role: 'role',
  addedBy: 'addedBy',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ApiKeyScalarFieldEnum = {
  id: 'id',
  keyHash: 'keyHash',
  name: 'name',
  owner: 'owner',
  rateLimit: 'rateLimit',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  lastUsedAt: 'lastUsedAt'
};

exports.Prisma.LedgerHashScalarFieldEnum = {
  sequence: 'sequence',
  hash: 'hash',
  createdAt: 'createdAt'
};

exports.Prisma.SyncMetadataScalarFieldEnum = {
  id: 'id',
  lastLedgerSequence: 'lastLedgerSequence'
};

exports.Prisma.ClawbackHistoryScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  amount: 'amount',
  reason: 'reason',
  createdAt: 'createdAt',
  executedAt: 'executedAt',
  txHash: 'txHash',
  status: 'status'
};

exports.Prisma.NotificationSubscriptionScalarFieldEnum = {
  id: 'id',
  stellarAddress: 'stellarAddress',
  platform: 'platform',
  webhookUrl: 'webhookUrl',
  chatId: 'chatId',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NotificationPreferenceScalarFieldEnum = {
  id: 'id',
  stellarAddress: 'stellarAddress',
  email: 'email',
  emailVerified: 'emailVerified',
  platform: 'platform',
  paymentConfirmations: 'paymentConfirmations',
  streamStatusUpdates: 'streamStatusUpdates',
  securityAlerts: 'securityAlerts',
  weeklySummaries: 'weeklySummaries',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.EmailDeliveryScalarFieldEnum = {
  id: 'id',
  stellarAddress: 'stellarAddress',
  email: 'email',
  template: 'template',
  subject: 'subject',
  status: 'status',
  errorMessage: 'errorMessage',
  metadata: 'metadata',
  sentAt: 'sentAt',
  deliveredAt: 'deliveredAt',
  openedAt: 'openedAt',
  createdAt: 'createdAt'
};

exports.Prisma.InvoiceLinkScalarFieldEnum = {
  id: 'id',
  slug: 'slug',
  sender: 'sender',
  receiver: 'receiver',
  amount: 'amount',
  tokenAddress: 'tokenAddress',
  duration: 'duration',
  description: 'description',
  customMessage: 'customMessage',
  pdfUrl: 'pdfUrl',
  xdrParams: 'xdrParams',
  status: 'status',
  expiresAt: 'expiresAt',
  viewCount: 'viewCount',
  lastViewedAt: 'lastViewedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AffiliateScalarFieldEnum = {
  id: 'id',
  stellarAddress: 'stellarAddress',
  pendingClaim: 'pendingClaim',
  totalEarned: 'totalEarned',
  claimedAt: 'claimedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GlobalStatsScalarFieldEnum = {
  id: 'id',
  tvlUsd: 'tvlUsd',
  volume24hUsd: 'volume24hUsd',
  activeStreams: 'activeStreams',
  totalStreams: 'totalStreams',
  updatedAt: 'updatedAt'
};

exports.Prisma.GlobalStats_V3ScalarFieldEnum = {
  id: 'id',
  totalVolumeUsd: 'totalVolumeUsd',
  dailyVolumeUsd: 'dailyVolumeUsd',
  totalSplits: 'totalSplits',
  totalRecipients: 'totalRecipients',
  updatedAt: 'updatedAt'
};

exports.Prisma.TvlSnapshotScalarFieldEnum = {
  id: 'id',
  tvlUsd: 'tvlUsd',
  date: 'date',
  createdAt: 'createdAt'
};

exports.Prisma.AssetScalarFieldEnum = {
  id: 'id',
  tokenAddress: 'tokenAddress',
  homeDomain: 'homeDomain',
  name: 'name',
  symbol: 'symbol',
  imageUrl: 'imageUrl',
  decimals: 'decimals',
  isVerified: 'isVerified',
  stellarExpertVerified: 'stellarExpertVerified',
  tomlUrl: 'tomlUrl',
  orgVerified: 'orgVerified',
  orgHomeDomain: 'orgHomeDomain',
  lastFetchedAt: 'lastFetchedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AutopilotScheduleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  frequency: 'frequency',
  splitConfigId: 'splitConfigId',
  operatorAddress: 'operatorAddress',
  minGasTankXlm: 'minGasTankXlm',
  isActive: 'isActive',
  lastRun: 'lastRun',
  lastTxHash: 'lastTxHash',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AssetConfigScalarFieldEnum = {
  id: 'id',
  assetId: 'assetId',
  symbol: 'symbol',
  name: 'name',
  decimals: 'decimals',
  isVerified: 'isVerified',
  isVisible: 'isVisible',
  yieldEnabled: 'yieldEnabled',
  iconUrl: 'iconUrl',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ArchivedDisbursementScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  txHash: 'txHash',
  sender: 'sender',
  receiver: 'receiver',
  amount: 'amount',
  tokenAddress: 'tokenAddress',
  status: 'status',
  completedAt: 'completedAt',
  archivedAt: 'archivedAt',
  originalLedger: 'originalLedger'
};

exports.Prisma.DisbursementScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  txHash: 'txHash',
  sender: 'sender',
  receiver: 'receiver',
  amount: 'amount',
  tokenAddress: 'tokenAddress',
  status: 'status',
  createdAt: 'createdAt',
  completedAt: 'completedAt',
  ledger: 'ledger',
  batchId: 'batchId',
  categoryId: 'categoryId'
};

exports.Prisma.PaymentStatusEventScalarFieldEnum = {
  id: 'id',
  disbursementId: 'disbursementId',
  status: 'status',
  previousStatus: 'previousStatus',
  note: 'note',
  createdAt: 'createdAt'
};

exports.Prisma.AssetMappingScalarFieldEnum = {
  id: 'id',
  stellarAssetId: 'stellarAssetId',
  symbol: 'symbol',
  sourceChain: 'sourceChain',
  sourceContract: 'sourceContract',
  label: 'label',
  bridgeProtocol: 'bridgeProtocol',
  decimals: 'decimals',
  isNative: 'isNative',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PriceHistoryScalarFieldEnum = {
  id: 'id',
  asset: 'asset',
  symbol: 'symbol',
  priceUsd: 'priceUsd',
  source: 'source',
  recordedAt: 'recordedAt'
};

exports.Prisma.ProtocolInefficiencyReportScalarFieldEnum = {
  id: 'id',
  asset: 'asset',
  protocolVersion: 'protocolVersion',
  totalDustAmount: 'totalDustAmount',
  eventCount: 'eventCount',
  firstSeenLedger: 'firstSeenLedger',
  lastSeenLedger: 'lastSeenLedger',
  generatedAt: 'generatedAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SplitLogScalarFieldEnum = {
  id: 'id',
  streamId: 'streamId',
  asset: 'asset',
  amount: 'amount',
  sender: 'sender',
  receiver: 'receiver',
  txHash: 'txHash',
  priceUsd: 'priceUsd',
  priceSource: 'priceSource',
  priceRecordedAt: 'priceRecordedAt',
  executedAt: 'executedAt'
};

exports.Prisma.MonitoredTransactionScalarFieldEnum = {
  id: 'id',
  txHash: 'txHash',
  txXdr: 'txXdr',
  sourceAddress: 'sourceAddress',
  originalFeeSt: 'originalFeeSt',
  currentFeeSt: 'currentFeeSt',
  bumpCount: 'bumpCount',
  maxBumps: 'maxBumps',
  status: 'status',
  submittedAt: 'submittedAt',
  confirmedAt: 'confirmedAt',
  lastBumpAt: 'lastBumpAt',
  errorMessage: 'errorMessage',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DisbursementDraftScalarFieldEnum = {
  id: 'id',
  senderAddress: 'senderAddress',
  name: 'name',
  asset: 'asset',
  currentVersion: 'currentVersion',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DisbursementDraftVersionScalarFieldEnum = {
  id: 'id',
  draftId: 'draftId',
  version: 'version',
  totalAmount: 'totalAmount',
  recipients: 'recipients',
  changeNote: 'changeNote',
  changedBy: 'changedBy',
  createdAt: 'createdAt'
};

exports.Prisma.MultisigProposalScalarFieldEnum = {
  id: 'id',
  proposalId: 'proposalId',
  organizationId: 'organizationId',
  transactionXdr: 'transactionXdr',
  signatures: 'signatures',
  requiredSigners: 'requiredSigners',
  status: 'status',
  submittedTxHash: 'submittedTxHash',
  errorMessage: 'errorMessage',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  expiresAt: 'expiresAt'
};

exports.Prisma.CachedAssetScalarFieldEnum = {
  id: 'id',
  tokenAddress: 'tokenAddress',
  code: 'code',
  issuer: 'issuer',
  name: 'name',
  description: 'description',
  imageUrl: 'imageUrl',
  isVerified: 'isVerified',
  decimals: 'decimals',
  lastSyncedAt: 'lastSyncedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StreamTemplateScalarFieldEnum = {
  id: 'id',
  name: 'name',
  asset: 'asset',
  recipientAddress: 'recipientAddress',
  splitEnabled: 'splitEnabled',
  splitAddress: 'splitAddress',
  splitPercent: 'splitPercent',
  totalAmount: 'totalAmount',
  rateType: 'rateType',
  durationPreset: 'durationPreset',
  usageCount: 'usageCount',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SplitLinkScalarFieldEnum = {
  id: 'id',
  slug: 'slug',
  fullUrl: 'fullUrl',
  payloadHash: 'payloadHash',
  creatorAddress: 'creatorAddress',
  passwordHash: 'passwordHash',
  clickCount: 'clickCount',
  lastClickedAt: 'lastClickedAt',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt'
};

exports.Prisma.OfacAuditLogScalarFieldEnum = {
  id: 'id',
  address: 'address',
  isSanctioned: 'isSanctioned',
  checkedAt: 'checkedAt',
  source: 'source',
  createdAt: 'createdAt'
};

exports.Prisma.AdminAuditLogScalarFieldEnum = {
  id: 'id',
  timestamp: 'timestamp',
  userId: 'userId',
  userEmail: 'userEmail',
  method: 'method',
  path: 'path',
  statusCode: 'statusCode',
  executionTimeMs: 'executionTimeMs',
  clientIp: 'clientIp',
  userAgent: 'userAgent',
  requestBody: 'requestBody',
  responseBody: 'responseBody',
  beforeSnapshot: 'beforeSnapshot',
  afterSnapshot: 'afterSnapshot',
  error: 'error',
  changesSummary: 'changesSummary',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentRoutingRuleScalarFieldEnum = {
  id: 'id',
  ownerAddress: 'ownerAddress',
  name: 'name',
  description: 'description',
  route: 'route',
  priority: 'priority',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentRoutingConditionScalarFieldEnum = {
  id: 'id',
  ruleId: 'ruleId',
  type: 'type',
  operator: 'operator',
  value: 'value',
  value2: 'value2'
};

exports.Prisma.InvoiceScalarFieldEnum = {
  id: 'id',
  invoiceNumber: 'invoiceNumber',
  ownerAddress: 'ownerAddress',
  disbursementId: 'disbursementId',
  templateId: 'templateId',
  status: 'status',
  language: 'language',
  sender: 'sender',
  asset: 'asset',
  recipients: 'recipients',
  subtotal: 'subtotal',
  taxRate: 'taxRate',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  note: 'note',
  txHash: 'txHash',
  issuedAt: 'issuedAt',
  dueAt: 'dueAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InvoiceTemplateScalarFieldEnum = {
  id: 'id',
  ownerAddress: 'ownerAddress',
  name: 'name',
  language: 'language',
  isDefault: 'isDefault',
  accentColor: 'accentColor',
  logoBase64: 'logoBase64',
  footerText: 'footerText',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InvoiceCounterScalarFieldEnum = {
  ownerAddress: 'ownerAddress',
  year: 'year',
  lastSeq: 'lastSeq'
};

exports.Prisma.GeoRestrictionScalarFieldEnum = {
  id: 'id',
  ownerAddress: 'ownerAddress',
  region: 'region',
  action: 'action',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GeoAnalyticsEventScalarFieldEnum = {
  id: 'id',
  ipHash: 'ipHash',
  countryCode: 'countryCode',
  region: 'region',
  city: 'city',
  latitude: 'latitude',
  longitude: 'longitude',
  userAgent: 'userAgent',
  path: 'path',
  method: 'method',
  userId: 'userId',
  createdAt: 'createdAt'
};

exports.Prisma.DashboardLayoutScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  isDefault: 'isDefault',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DashboardWidgetScalarFieldEnum = {
  id: 'id',
  layoutId: 'layoutId',
  widgetType: 'widgetType',
  position: 'position',
  enabled: 'enabled',
  size: 'size',
  config: 'config',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExportAuditLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  streamId: 'streamId',
  format: 'format',
  recordCount: 'recordCount',
  fileSizeBytes: 'fileSizeBytes',
  dateRange: 'dateRange',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  status: 'status',
  errorMessage: 'errorMessage',
  createdAt: 'createdAt'
};

exports.Prisma.ReportScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  reportType: 'reportType',
  periodStart: 'periodStart',
  periodEnd: 'periodEnd',
  generatedAt: 'generatedAt',
  generatedBy: 'generatedBy',
  status: 'status',
  fileUrls: 'fileUrls',
  summary: 'summary',
  reconciliationStatus: 'reconciliationStatus',
  emailDeliveryStatus: 'emailDeliveryStatus',
  auditLog: 'auditLog',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReportConfigurationScalarFieldEnum = {
  id: 'id',
  organizationId: 'organizationId',
  reportType: 'reportType',
  enabled: 'enabled',
  schedule: 'schedule',
  exportFormats: 'exportFormats',
  emailConfig: 'emailConfig',
  storageConfig: 'storageConfig',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReportAuditLogScalarFieldEnum = {
  id: 'id',
  reportId: 'reportId',
  action: 'action',
  actor: 'actor',
  timestamp: 'timestamp',
  details: 'details',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentDisputeScalarFieldEnum = {
  id: 'id',
  disputeRef: 'disputeRef',
  streamId: 'streamId',
  txHash: 'txHash',
  filerAddress: 'filerAddress',
  respondentAddress: 'respondentAddress',
  reason: 'reason',
  description: 'description',
  amount: 'amount',
  tokenAddress: 'tokenAddress',
  status: 'status',
  decision: 'decision',
  resolutionNotes: 'resolutionNotes',
  resolvedBy: 'resolvedBy',
  resolvedAt: 'resolvedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DisputeEvidenceScalarFieldEnum = {
  id: 'id',
  disputeId: 'disputeId',
  uploaderAddress: 'uploaderAddress',
  fileName: 'fileName',
  fileUrl: 'fileUrl',
  mimeType: 'mimeType',
  fileSize: 'fileSize',
  description: 'description',
  createdAt: 'createdAt'
};

exports.Prisma.DisputeHistoryScalarFieldEnum = {
  id: 'id',
  disputeId: 'disputeId',
  actorAddress: 'actorAddress',
  action: 'action',
  fromStatus: 'fromStatus',
  toStatus: 'toStatus',
  comment: 'comment',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.AuthorizationStatus = exports.$Enums.AuthorizationStatus = {
  AUTHORIZED: 'AUTHORIZED',
  PARTIALLY_CAPTURED: 'PARTIALLY_CAPTURED',
  CAPTURED: 'CAPTURED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED'
};

exports.StreamStatus = exports.$Enums.StreamStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  ARCHIVED: 'ARCHIVED'
};

exports.OrgRole = exports.$Enums.OrgRole = {
  DRAFTER: 'DRAFTER',
  APPROVER: 'APPROVER',
  EXECUTOR: 'EXECUTOR'
};

exports.NotificationPlatform = exports.$Enums.NotificationPlatform = {
  discord: 'discord',
  telegram: 'telegram',
  email: 'email'
};

exports.EmailDeliveryStatus = exports.$Enums.EmailDeliveryStatus = {
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  OPENED: 'OPENED',
  BOUNCED: 'BOUNCED',
  FAILED: 'FAILED'
};

exports.DisbursementStatus = exports.$Enums.DisbursementStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

exports.PaymentTrackingStatus = exports.$Enums.PaymentTrackingStatus = {
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED'
};

exports.InvoiceStatus = exports.$Enums.InvoiceStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  VOID: 'VOID'
};

exports.ReportType = exports.$Enums.ReportType = {
  daily_summary: 'daily_summary',
  monthly_statement: 'monthly_statement',
  failed_payment: 'failed_payment',
  fee_analysis: 'fee_analysis',
  tax_report: 'tax_report'
};

exports.ReportStatus = exports.$Enums.ReportStatus = {
  pending: 'pending',
  generating: 'generating',
  generated: 'generated',
  failed: 'failed',
  archived: 'archived'
};

exports.DisputeStatus = exports.$Enums.DisputeStatus = {
  FILED: 'FILED',
  EVIDENCE_REVIEW: 'EVIDENCE_REVIEW',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED'
};

exports.DisputeDecision = exports.$Enums.DisputeDecision = {
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  PARTIAL: 'PARTIAL'
};

exports.Prisma.ModelName = {
  PaymentCategory: 'PaymentCategory',
  PaymentMetadata: 'PaymentMetadata',
  PaymentAuthorization: 'PaymentAuthorization',
  PaymentCapture: 'PaymentCapture',
  PaymentCategoryRule: 'PaymentCategoryRule',
  Stream: 'Stream',
  ContractEvent: 'ContractEvent',
  TokenPrice: 'TokenPrice',
  Webhook: 'Webhook',
  WebhookDelivery: 'WebhookDelivery',
  SyncState: 'SyncState',
  EventLog: 'EventLog',
  StreamSnapshot: 'StreamSnapshot',
  ContractStateSnapshot: 'ContractStateSnapshot',
  StreamArchive: 'StreamArchive',
  BridgeLog: 'BridgeLog',
  Proposal: 'Proposal',
  Event: 'Event',
  ReplayCheckpoint: 'ReplayCheckpoint',
  ReplayRun: 'ReplayRun',
  OrganizationMember: 'OrganizationMember',
  ApiKey: 'ApiKey',
  LedgerHash: 'LedgerHash',
  SyncMetadata: 'SyncMetadata',
  ClawbackHistory: 'ClawbackHistory',
  NotificationSubscription: 'NotificationSubscription',
  NotificationPreference: 'NotificationPreference',
  EmailDelivery: 'EmailDelivery',
  InvoiceLink: 'InvoiceLink',
  Affiliate: 'Affiliate',
  GlobalStats: 'GlobalStats',
  GlobalStats_V3: 'GlobalStats_V3',
  TvlSnapshot: 'TvlSnapshot',
  Asset: 'Asset',
  AutopilotSchedule: 'AutopilotSchedule',
  AssetConfig: 'AssetConfig',
  ArchivedDisbursement: 'ArchivedDisbursement',
  Disbursement: 'Disbursement',
  PaymentStatusEvent: 'PaymentStatusEvent',
  AssetMapping: 'AssetMapping',
  PriceHistory: 'PriceHistory',
  ProtocolInefficiencyReport: 'ProtocolInefficiencyReport',
  SplitLog: 'SplitLog',
  MonitoredTransaction: 'MonitoredTransaction',
  DisbursementDraft: 'DisbursementDraft',
  DisbursementDraftVersion: 'DisbursementDraftVersion',
  MultisigProposal: 'MultisigProposal',
  CachedAsset: 'CachedAsset',
  StreamTemplate: 'StreamTemplate',
  SplitLink: 'SplitLink',
  OfacAuditLog: 'OfacAuditLog',
  AdminAuditLog: 'AdminAuditLog',
  PaymentRoutingRule: 'PaymentRoutingRule',
  PaymentRoutingCondition: 'PaymentRoutingCondition',
  Invoice: 'Invoice',
  InvoiceTemplate: 'InvoiceTemplate',
  InvoiceCounter: 'InvoiceCounter',
  GeoRestriction: 'GeoRestriction',
  GeoAnalyticsEvent: 'GeoAnalyticsEvent',
  DashboardLayout: 'DashboardLayout',
  DashboardWidget: 'DashboardWidget',
  ExportAuditLog: 'ExportAuditLog',
  Report: 'Report',
  ReportConfiguration: 'ReportConfiguration',
  ReportAuditLog: 'ReportAuditLog',
  PaymentDispute: 'PaymentDispute',
  DisputeEvidence: 'DisputeEvidence',
  DisputeHistory: 'DisputeHistory'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
