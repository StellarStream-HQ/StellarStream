use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Contract is already initialized
    AlreadyInitialized = 1,
    /// Invalid time range for the stream
    InvalidTimeRange = 2,
    /// Stream is not migratable
    StreamNotMigratable = 3,
    /// Proposal deadline has expired
    ExpiredDeadline = 6,
    /// Invalid signer nonce
    InvalidNonce = 7,
    /// Invalid multisig approval threshold
    InvalidThreshold = 8,
    /// Not enough signers/signatures for approval
    NotEnoughSigners = 9,
    /// Stream amount is below the dust threshold
    BelowDustThreshold = 10,
    /// Contract is paused
    ContractPaused = 11,
    /// Insufficient account balance
    InsufficientBalance = 12,
    /// Gas buffer is insufficient
    InsufficientGasBuffer = 13,
    /// Stream was not found
    StreamNotFound = 14,
    /// Stream is already cancelled
    AlreadyCancelled = 15,
    /// Batch request size exceeds limits
    BatchTooLarge = 16,
    /// No funds available to withdraw
    NothingToWithdraw = 17,
    /// Sender is not authorized to perform this action
    UnauthorizedSender = 18,
    /// Contract is not initialized
    ContractNotInitialized = 20,
    /// Current time is before the execution time
    NotExecutionTime = 22,
    /// Operation has not been scheduled
    OpNotScheduled = 23,
    /// No treasury address configured
    NoTreasury = 28,
    /// Asset is not whitelisted
    AssetNotWhitelisted = 29,
    /// Asset does not implement standard token interface
    AssetInterfaceNotSupported = 67,
    /// Invalid fee or penalty percentage value
    InvalidPenalty = 30,
    /// Migration is paused
    MigrationPaused = 31,
    /// Relayer fee is invalid or exceeds bounds
    InvalidRelayerFee = 32,
    /// Stream request not found
    StreamRequestNotFound = 33,
    /// Stream request already approved
    AlreadyApproved = 34,
    /// Stream request has already been executed
    StreamReqAlreadyExecuted = 35,
    /// Arithmetic overflow or underflow
    Overflow = 36,
    /// Invalid metadata format for bridge-in
    InvalidBridgeMetadata = 37,
    /// Contract is in emergency (withdraw-only) mode
    EmergencyMode = 41,
    /// Stream has already been migrated
    AlreadyMigrated = 42,
    /// No pending treasury split found
    PendingSplitNotFound = 46,
    /// Reentrant call detected
    Reentrant = 48,
    /// Stream not fully withdrawn
    StreamNotFullyWithdrawn = 49,
    /// Fee exceeds protocol maximum
    FeeTooHigh = 50,
    /// DEX address not configured
    DexNotConfigured = 51,
    /// Slippage tolerance exceeded
    SwapSlippageExceeded = 52,
    /// Invalid swap parameters
    InvalidSwapParams = 53,
    /// Source and destination assets are the same
    SameAsset = 55,
    /// No pending rate update exists
    NoPendingUpdate = 57,
    /// Pending rate update already exists
    PendingUpdateExists = 58,
    /// Invalid new rate value
    InvalidNewRate = 60,
    /// Stream is not active
    StreamNotActive = 63,
    /// Signer is not a member of the recovery council
    NotCouncilMember = 70,
    /// Recovery has already been initiated
    RecoveryAlreadyInitiated = 71,
    /// No active recovery has been initiated
    RecoveryNotInitiated = 73,
    /// Stream amount or flow rate exceeds maximum allowed limit
    AmountOverflow = 78,
}
