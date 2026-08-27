//! Error types for the StellarStream contract.
//!
//! Every public entry point returns `Result<T, Error>`. The numeric codes are
//! chosen once and are **permanent** after deployment: clients and SDKs may
//! rely on them, so they must never be reordered or reused.
//!
//! Error variants are organized by category with rustdoc comments explaining
//! when each error occurs. New variants are appended at the end to preserve
//! backward compatibility.

use soroban_sdk::contracterror;

/// Comprehensive error enumeration covering all possible failure modes.
///
/// Variants are grouped by category. The enum derives `Copy`, `Clone`, `Debug`,
/// `Eq`, `PartialEq`, `PartialOrd`, and `Ord` to allow flexible comparison
/// and sorting.
///
/// # Error code ranges
///
/// | Range | Category |
/// |-------|----------|
/// | 1–17 | Initialization, validation, stream ops, authorization, balance |
/// | 21–22 | Security (soulbound, restricted addresses) |
/// | 26–41 | Pausing, overflow, governance, metadata, fees, milestones |
/// | 42–49 | Clawback errors |
/// | 101–110 | Flash loan errors |
/// | 120–121 | Upgrade errors |
/// | 130–132 | Recurrence errors |
/// | 140 | Vault error |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // =========================================================================
    // Initialization errors
    // =========================================================================

    /// The contract has already been initialized.
    /// Calling `initialize` a second time triggers this.
    AlreadyInitialized = 1,

    // =========================================================================
    // Validation errors
    // =========================================================================

    /// The provided time range is invalid (e.g. `start_time >= end_time`).
    InvalidTimeRange = 2,

    /// The provided amount is invalid (zero or negative).
    InvalidAmount = 3,

    // =========================================================================
    // Stream operation errors
    // =========================================================================

    /// No stream exists with the given ID.
    StreamNotFound = 4,

    /// The caller is not authorized for this operation.
    Unauthorized = 5,

    /// The stream has already been cancelled.
    AlreadyCancelled = 6,

    /// The token balance is insufficient for the requested operation.
    InsufficientBalance = 7,

    /// The stream is already paused (pause attempted on paused stream).
    AlreadyPaused = 8,

    /// The stream is not paused (resume attempted on active stream).
    NotPaused = 9,

    /// The contract is globally paused.
    ContractPaused = 10,

    /// A re-entrancy attack was detected.
    Reentrancy = 11,

    /// The caller is not the contract admin.
    NotAdmin = 12,

    /// The caller is not the designated pauser.
    NotPauser = 13,

    /// The stream is currently paused (withdrawal or operation not allowed).
    StreamPaused = 14,

    /// The withdrawal amount exceeds the available balance.
    WithdrawTooLarge = 15,

    /// The vesting curve type is invalid.
    InvalidCurve = 16,

    /// The role ID is invalid (out of range).
    InvalidRole = 17,

    // =========================================================================
    // Security errors
    // =========================================================================

    /// The stream is soulbound and cannot be transferred or reassigned.
    StreamIsSoulbound = 21,

    /// The address is restricted (OFAC compliance).
    AddressRestricted = 22,

    // =========================================================================
    // Pausing and state errors
    // =========================================================================

    /// The stream is not paused (alternative error for clarity).
    StreamNotPaused = 26,

    /// An arithmetic operation overflowed.
    Overflow = 27,

    // =========================================================================
    // Governance & proposal errors
    // =========================================================================

    /// The proposal was not found.
    ProposalNotFound = 28,

    /// The proposal has expired.
    ProposalExpired = 29,

    /// The caller has already approved this proposal.
    AlreadyApproved = 30,

    /// The proposal has already been executed.
    ProposalAlreadyExecuted = 31,

    /// The approval threshold is invalid (e.g. zero).
    InvalidApprovalThreshold = 32,

    /// The batch size exceeds the maximum allowed.
    BatchSizeExceeded = 33,

    /// The stream has ended and cannot accept further operations.
    StreamEnded = 34,

    // =========================================================================
    // Metadata errors
    // =========================================================================

    /// The metadata label exceeds the maximum length (64 bytes).
    MetadataLabelTooLong = 35,

    /// Too many tags (maximum 5).
    TooManyTags = 36,

    /// A tag exceeds the maximum length (32 bytes).
    TagTooLong = 37,

    // =========================================================================
    // Protocol fee errors
    // =========================================================================

    /// The fee rate exceeds the maximum allowed (1000 bps = 10%).
    FeeTooHigh = 38,

    /// No treasury address has been configured for fee collection.
    TreasuryNotSet = 39,

    // =========================================================================
    // Milestone errors
    // =========================================================================

    /// The milestone schedule is invalid.
    InvalidMilestones = 40,

    /// The milestone percentages are invalid (must sum to 10000 bps).
    InvalidMilestonePercentages = 41,

    // =========================================================================
    // Clawback errors (42–49)
    // =========================================================================

    /// No clawback request exists for the given ID.
    ClawbackNotFound = 42,

    /// The stream was not created with clawback enabled.
    ClawbackNotEnabled = 43,

    /// The requested clawback amount exceeds the amount already withdrawn.
    ClawbackExceedsWithdrawn = 44,

    /// The clawback request has already been executed.
    ClawbackAlreadyExecuted = 45,

    /// The clawback request has not yet received sufficient approvals.
    ClawbackInsufficientApprovals = 46,

    /// The approver has already approved this clawback request.
    ClawbackAlreadyApproved = 47,

    /// The clawback request has expired and can no longer be approved or executed.
    ClawbackExpired = 48,

    /// The clawback request was rejected.
    ClawbackRejected = 49,

    // =========================================================================
    // Flash loan errors (101–110)
    // =========================================================================

    /// Not enough idle liquidity available for the flash loan.
    InsufficientFlashLiquidity = 101,

    /// The flash loan borrow amount is invalid (zero or negative).
    InvalidFlashBorrowAmount = 102,

    /// A flash loan is already in progress (re-entrancy).
    FlashLoanInProgress = 103,

    /// The flash loan repayment is insufficient (principal + fee).
    InsufficientFlashRepayment = 104,

    /// The flash loan callback contract execution failed.
    FlashLoanCallbackFailed = 105,

    /// The flash loan fee calculation overflowed.
    FlashLoanFeeOverflow = 106,

    // =========================================================================
    // Upgrade errors (120–121)
    // =========================================================================

    /// The provided WASM hash is invalid or cannot be used for upgrade.
    InvalidWasmHash = 120,

    /// The upgrade failed at the deployer level.
    UpgradeFailed = 121,

    // =========================================================================
    // Recurrence errors (130–132)
    // =========================================================================

    /// The maximum number of recurring stream occurrences has been reached.
    MaxOccurrencesReached = 130,

    /// The stream is not configured for recurrence.
    RecurrenceNotEnabled = 131,

    /// Insufficient contract balance to auto-renew the recurring stream.
    InsufficientRenewalBalance = 132,

    // =========================================================================
    // Vault error (140)
    // =========================================================================

    /// An internal vault or escrow operation failed.
    VaultError = 140,
}
