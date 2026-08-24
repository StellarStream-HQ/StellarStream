use soroban_sdk::contracterror;

/// Comprehensive error enumeration covering all failure modes in the
/// StellarStream Contract-V1.
///
/// Error codes are **permanent** once deployed — they must never be
/// renumbered because callers and off-chain indexers may hard-code the
/// numeric value. New variants are appended at the end of each group.
///
/// # Grouping
/// | Range | Group |
/// |-------|-------|
/// | 1–7   | Initialization & validation |
/// | 8–15  | Stream operation & authorization |
/// | 16–20 | Balance & security |
/// | 21–25 | Role-based access control |
/// | 26–30 | Advanced features (proposals, vaults) |
/// | 31–37 | Dispute resolution |
/// | 38–42 | Recurring streams |
/// | 43–50 | Oracle, flash-loan, batch & misc |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // ── Initialization errors ─────────────────────────────────────────────

    /// The contract has already been initialized and cannot be initialized again.
    AlreadyInitialized = 1,

    /// `start_time` is not strictly before `end_time`.
    InvalidTimeRange = 2,

    /// The requested amount is zero or negative where a positive amount is required.
    InvalidAmount = 3,

    /// No stream exists for the given stream ID.
    StreamNotFound = 4,

    /// The caller is not authorized to perform this action on the given resource.
    Unauthorized = 5,

    /// The stream has already been cancelled.
    AlreadyCancelled = 6,

    /// The contract or stream does not hold enough balance to cover the request.
    InsufficientBalance = 7,

    // ── Stream operation errors ────────────────────────────────────────────

    /// No governance proposal exists for the given proposal ID.
    ProposalNotFound = 8,

    /// The governance proposal's approval window has elapsed.
    ProposalExpired = 9,

    /// The caller has already approved this proposal.
    AlreadyApproved = 10,

    /// The governance proposal has already been executed and cannot be executed again.
    ProposalAlreadyExecuted = 11,

    /// The configured approval threshold is invalid (e.g. zero or exceeds signer count).
    InvalidApprovalThreshold = 12,

    /// The caller does not hold the stream's ownership receipt.
    NotReceiptOwner = 13,

    /// The stream is currently paused and the operation requires an active stream.
    StreamPaused = 14,

    /// The stream is not in the Active state required by the called operation.
    /// Also used by recurring streams: the current period has not yet ended.
    StreamNotActive = 15,

    // ── Balance & security errors ──────────────────────────────────────────

    /// The price oracle's last update is older than the allowed staleness window.
    OracleStalePrice = 16,

    /// The call to the price oracle contract failed.
    OracleFailed = 17,

    /// The oracle-reported price falls outside the configured acceptable bounds.
    PriceOutOfBounds = 18,

    /// A flash loan was not fully repaid (principal + fee) by the end of the transaction.
    FlashLoanNotRepaid = 19,

    /// A new flash loan was requested while one is already in progress (reentrancy guard).
    FlashLoanInProgress = 20,

    // ── Authorization & compliance errors ─────────────────────────────────

    /// The intended receiver is on the restricted-address list.
    ReceiverRestricted = 21,

    /// The upgrade proposal has already been executed and cannot be executed again.
    AlreadyExecuted = 22,

    /// Stream is soulbound: the receipt is permanently locked to the original receiver.
    StreamIsSoulbound = 23,

    /// Address is restricted by OFAC / compliance rules.
    AddressRestricted = 24,

    /// The stream has already ended (past end_time).
    StreamEnded = 25,

    // ── Role-based access control errors ──────────────────────────────────

    /// Batch request exceeds the maximum allowed recipients per call.
    BatchSizeExceeded = 26,

    /// The stream is not paused — cannot resume a stream that is already active.
    StreamNotPaused = 27,

    /// The caller is not the stream's receiver.
    NotReceiver = 28,

    /// The withdrawable amount is zero or negative; nothing can be withdrawn now.
    InsufficientWithdrawable = 29,

    /// The caller is not the stream's sender.
    NotSender = 30,

    // ── Dispute resolution errors ──────────────────────────────────────────

    /// No dispute exists for the given dispute ID.
    DisputeNotFound = 31,

    /// The caller is not a party to the dispute (neither sender nor receiver).
    NotDisputeParty = 32,

    /// The caller is not an authorized arbitrator.
    NotArbitrator = 33,

    /// The dispute has already been resolved.
    DisputeAlreadyResolved = 34,

    /// The stream has an active dispute and operations are blocked.
    DisputeInProgress = 35,

    /// The arbitrator has already voted on this dispute.
    AlreadyVoted = 36,

    /// The dispute has not received enough votes to be resolved.
    InsufficientVotes = 37,

    // ── Recurring stream errors ────────────────────────────────────────────

    /// The dispute has expired and can no longer be voted on.
    DisputeExpired = 38,

    /// The proposed resolution is invalid for the given dispute.
    InvalidResolution = 39,

    /// The recurring stream has been manually stopped and will not auto-renew.
    RecurringStopped = 40,

    /// The recurring stream has reached its maximum number of occurrences.
    MaxOccurrencesReached = 41,

    /// The sender does not hold sufficient balance to fund the next recurring period.
    InsufficientRenewalBalance = 42,

    // ── Misc / RBAC / upgrade ──────────────────────────────────────────────

    /// The contract has not been initialized yet.
    NotInitialized = 43,

    /// An invalid receiver address was provided (e.g. zero address).
    InvalidReceiverAddress = 44,

    /// An invalid cliff time was provided (outside start–end range).
    InvalidCliffTime = 45,

    /// The caller does not hold the SuperAdmin role required for this operation.
    NotAdmin = 46,

    /// The caller does not hold the Guardian role required for this operation.
    NotPauser = 47,

    /// The caller does not hold the FinancialOperator role required for this operation.
    NotTreasuryManager = 48,

    /// An operation on a lending vault failed (deposit returned zero shares, etc.).
    VaultError = 49,

    /// The WASM hash provided for an upgrade is identical to the current WASM hash.
    SameVersionRejected = 50,
}
