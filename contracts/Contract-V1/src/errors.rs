use soroban_sdk::contracterror;

/// Error conditions returned by Contract-V1 contract entry points.
///
/// Each variant maps to a distinct `u32` error code surfaced to callers when a
/// contract invocation fails (e.g. as a `ContractError` in the Soroban host).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
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
    /// The price oracle's last update is older than the allowed staleness window.
    OracleStalePrice = 15,
    /// The call to the price oracle contract failed.
    OracleFailed = 16,
    /// The oracle-reported price falls outside the configured acceptable bounds.
    PriceOutOfBounds = 17,
    /// A flash loan was not fully repaid (principal + fee) by the end of the transaction.
    FlashLoanNotRepaid = 18,
    /// A new flash loan was requested while one is already in progress (reentrancy guard).
    FlashLoanInProgress = 19,
    /// The intended receiver is on the restricted-address list.
    ReceiverRestricted = 20,
    /// The upgrade proposal has already been executed and cannot be executed again.
    AlreadyExecuted = 21,
    /// Stream is soulbound: receiver cannot be transferred
    StreamIsSoulbound = 22,
    /// Address is restricted by OFAC compliance
    AddressRestricted = 23,
    /// Stream has already ended (past end_time)
    StreamEnded = 24,
    /// Batch request exceeds the maximum allowed recipients per call
    BatchSizeExceeded = 25,
    /// Stream is not paused (cannot resume)
    StreamNotPaused = 26,
    /// The caller is not the stream's receiver.
    NotReceiver = 27,
    /// The withdrawable amount is zero or negative.
    InsufficientWithdrawable = 28,
    /// No dispute exists for the given dispute ID.
    DisputeNotFound = 29,
    /// The caller is not a party to the dispute (neither sender nor receiver).
    NotDisputeParty = 30,
    /// The caller is not an authorized arbitrator.
    NotArbitrator = 31,
    /// The dispute has already been resolved.
    DisputeAlreadyResolved = 32,
    /// The stream has an active dispute and operations are blocked.
    DisputeInProgress = 33,
    /// The arbitrator has already voted on this dispute.
    AlreadyVoted = 34,
    /// The dispute has not received enough votes to be resolved.
    InsufficientVotes = 35,
    /// The dispute has expired and can no longer be voted on.
    DisputeExpired = 36,
    /// The proposed resolution is invalid for the given dispute.
    InvalidResolution = 37,
    /// The recurring stream has been manually stopped and will not auto-renew.
    RecurringStopped = 38,
    /// The recurring stream has reached its maximum number of occurrences.
    MaxOccurrencesReached = 39,
    /// The sender lacks sufficient balance to fund the next recurring period.
    InsufficientRenewalBalance = 40,
    /// The current stream period has not yet ended; renewal not allowed yet.
    StreamNotActive = 41,
}