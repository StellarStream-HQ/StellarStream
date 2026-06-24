// Error descriptions have been moved to ERROR_CODES.md (Issue #840).
// Numeric codes are the on-chain surface; human-readable text lives off-chain.

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAdmin = 2,
    RecipientNotVerified = 3,
    NoVerifiedRecipients = 4,
    InvalidSplit = 5,
    Overflow = 6,
    NotAuthorizedAdmin = 7,
    AlreadyApproved = 8,
    ProposalNotFound = 9,
    AlreadyExecuted = 10,
    QuorumNotReached = 11,
    SplitNotFound = 12,
    NotSplitSender = 13,
    SplitAlreadyCancelled = 14,
    SplitAlreadyExecuted = 15,
    SplitNotYetDue = 16,
    NothingToClaim = 17,
    CouncilNotSet = 18,
    InsufficientCouncilSignatures = 19,
    DuplicateCouncilSigner = 20,
    InvalidCouncilSigner = 21,
    EmptyRecipients = 23,
    NotYetReleased = 22,
    InvalidBpsSum = 24,
    // #924: upgrade / migration
    MigrationAlreadyApplied = 25,
    // #926: atomic transfer failure
    TransferFailed = 26,
    // #927: whitelist
    RecipientNotWhitelisted = 27,
    // #939: minimum payment enforcement
    ShareBelowMinimum = 28,
    // Previously missing variants needed for existing code
    AlreadyProcessed = 29,
    ContractPaused = 30,
    InsufficientBalance = 31,
    // #930: invalid SAC asset
    InvalidAsset = 32,
    // #911: authorization errors
    NotAuthorized = 33,
    InsufficientFunds = 34,
    // #913: reentrancy detected
    Reentrant = 35,
    // #1161: recipient count limit
    TooManyRecipients = 36,
}

#[allow(dead_code)]
pub enum ContractError {
    /// Access control credentials validation failure
    Unauthorized = 101,

    /// The split percentages or recipient vector geometries are malformed
    InvalidShareConfiguration = 102,

    /// Operational actions rejected due to an active safety state freeze
    ContractPaused = 103,

    /// Requested distribution allocation exceeds available liquidity balances
    InsufficientBalance = 104,

    /// Operation halted because the computed payout amount rounds down to zero
    ZeroTransferAmount = 105,
}
