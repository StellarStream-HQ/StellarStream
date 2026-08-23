pub use crate::rbac::Role;
use soroban_sdk::{contracttype, Address, BytesN, Vec};

// Interest distribution strategies
// Bits can be combined: e.g., 0b011 = 50% sender, 50% receiver
#[allow(dead_code)]
pub const INTEREST_TO_SENDER: u32 = 0b001; // 1: All interest to sender
#[allow(dead_code)]
pub const INTEREST_TO_RECEIVER: u32 = 0b010; // 2: All interest to receiver
#[allow(dead_code)]
pub const INTEREST_TO_PROTOCOL: u32 = 0b100; // 4: All interest to protocol

// Common strategy combinations (exported for convenience)
#[allow(dead_code)]
pub const INTEREST_SPLIT_SENDER_RECEIVER: u32 = 0b011; // 3: 50/50 sender/receiver
#[allow(dead_code)]
pub const INTEREST_SPLIT_ALL: u32 = 0b111; // 7: 33/33/33 split

// Stream states
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamState {
    Active = 0,
    Paused = 1,
    Closed = 2,
}

// Curve types for vesting schedules
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CurveType {
    Linear = 0,
    Exponential = 1,
}

#[contracttype]
#[derive(Clone)]
pub struct PriceOracle {
    pub oracle_address: Address,
    pub max_staleness: u64, // Maximum age of price data in seconds
}

#[contracttype]
#[derive(Clone)]
pub struct UsdPegConfig {
    pub usd_amount: i128, // USD amount in 7 decimals (e.g., 5000000000 = $500)
    pub min_price: i128,  // Minimum acceptable price (slippage protection)
    pub max_price: i128,  // Maximum acceptable price (slippage protection)
    pub oracle: PriceOracle,
}

#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub timestamp: u64,
    pub percentage: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Stream {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub withdrawn: i128,
    pub withdrawn_amount: i128,
    pub receipt_owner: Address,
    pub paused_time: u64,
    pub total_paused_duration: u64,
    pub milestones: Vec<Milestone>,
    pub curve_type: CurveType,
    pub interest_strategy: u32,
    pub vault_address: Option<Address>,
    pub deposited_principal: i128,
    pub metadata: Option<BytesN<32>>,
    pub is_usd_pegged: bool,
    pub usd_amount: i128,
    pub oracle_address: Address,
    pub oracle_max_staleness: u64,
    pub price_min: i128,
    pub price_max: i128,
    /// If true, this stream is permanently locked to the original receiver.
    /// The receiver cannot be transferred for any reason. Used for identity-based
    /// rewards, grants, or compliance-locked distributions.
    /// Default: false (for backward compatibility with existing streams)
    /// Note: We use bool instead of Option<bool> to avoid storage overhead and
    /// ensure explicit default behavior. All existing streams default to false.
    pub is_soulbound: bool,
    /// If true, asset has clawback enabled and can be revoked by issuer
    pub clawback_enabled: bool,
    /// Optional arbiter for dispute resolution
    pub arbiter: Option<Address>,
    /// If true, stream is frozen pending dispute resolution
    pub is_frozen: bool,
    /// Stream state: Active, Paused, or Closed
    pub state: StreamState,
}

// Legacy Stream struct (v1) - for migration example
// This represents an older version without cliff_time
#[contracttype]
#[derive(Clone)]
pub struct StreamProposal {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub approvers: Vec<Address>,
    pub required_approvals: u32,
    pub deadline: u64,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamRequest {
    pub receiver: Address,
    pub amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub interest_strategy: u32,
    pub vault_address: Option<Address>,
    pub metadata: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterestDistribution {
    pub to_sender: i128,
    pub to_receiver: i128,
    pub to_protocol: i128,
    pub total_interest: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Stream(u64),
    StreamId,
    Admin, // Kept for backward compatibility
    FeeBps,
    Treasury,
    IsPaused,
    ReentrancyLock,
    ContractVersion,        // Tracks current contract version
    MigrationExecuted(u32), // Tracks which migrations have been executed
    Role(Address, Role),    // RBAC: stores role assignments
    SoulboundStreams,       // Vec<u64> of all soulbound stream IDs
    ApprovedVaults,         // Vec<Address> of approved lending vaults
    VaultShares(u64),       // Vault shares for stream_id
    VotingDelegate(u64),    // Voting delegate for stream_id
}

#[contracttype]
#[derive(Clone)]
pub struct StreamReceipt {
    pub stream_id: u64,
    pub owner: Address,
    pub minted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCreatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamClaimEvent {
    pub stream_id: u64,
    pub claimer: Address,
    pub amount: i128,
    pub total_claimed: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCancelledEvent {
    pub stream_id: u64,
    pub canceller: Address,
    pub to_receiver: i128,
    pub to_sender: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackEvent {
    pub stream_id: u64,
    pub officer: Address,
    pub amount_clawed: i128,
    pub issuer: Address,
    pub reason: Option<BytesN<32>>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamFrozenEvent {
    pub stream_id: u64,
    pub arbiter: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeResolvedEvent {
    pub stream_id: u64,
    pub arbiter: Address,
    pub to_sender: i128,
    pub to_receiver: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamToppedUpEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub amount: i128,
    pub new_total: i128,
    pub new_end_time: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptTransferredEvent {
    pub stream_id: u64,
    pub from: Address,
    pub to: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamPausedEvent {
    pub stream_id: u64,
    pub pauser: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamUnpausedEvent {
    pub stream_id: u64,
    pub unpauser: Address,
    pub paused_duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamResumedEvent {
    pub stream_id: u64,
    pub resumer: Address,
    pub paused_duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalApprovedEvent {
    pub proposal_id: u64,
    pub approver: Address,
    pub approval_count: u32,
    pub required_approvals: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub required_approvals: u32,
    pub deadline: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ReceiptMetadata {
    pub stream_id: u64,
    pub locked_balance: i128,
    pub unlocked_balance: i128,
    pub total_amount: i128,
    pub token: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorRequest {
    pub id: u64,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub duration: u64,
    pub start_time: u64,
    pub status: RequestStatus,
    pub metadata: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestKey {
    Request(u64),
    RequestCount,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestExecutedEvent {
    pub request_id: u64,
    pub stream_id: u64,
    pub executor: Address,
    pub timestamp: u64,
}

/// Advanced filter for querying streams with multiple criteria.
///
/// This struct provides flexible filtering capabilities for searching streams across the contract.
/// All fields are optional, allowing for powerful combination queries:
///
/// - **token**: Filter streams by specific token address. Useful for querying all streams for a particular token.
/// - **state**: Filter by stream state (Active, Paused, or Closed). Enables finding only active streams or historical data.
/// - **min_amount**: Filter streams with total_amount >= this value. Use for finding significant streams.
/// - **max_amount**: Filter streams with total_amount <= this value. Use for finding smaller streams or within budget ranges.
/// - **start_time_after**: Filter streams that started after this timestamp. Useful for finding recent streams.
/// - **end_time_before**: Filter streams that end before this timestamp. Useful for finding expiring streams.
///
/// When multiple filters are provided, they are combined with AND logic (all must match).
/// When all filters are None, all streams are returned (limited by pagination).
///
/// # Gas Efficiency
/// Pagination with offset/limit is required to prevent exceeding gas limits when retrieving large datasets.
/// The contract limits results to 50 per query to ensure predictable gas costs.
///
/// # Examples
///
/// ```ignore
/// // Get all USDC streams that are currently active
/// let filter = StreamFilter {
///     token: Some(usdc_address),
///     state: Some(StreamState::Active),
///     min_amount: None,
///     max_amount: None,
///     start_time_after: None,
///     end_time_before: None,
/// };
///
/// // Get expired streams within a value range
/// let filter = StreamFilter {
///     token: None,
///     state: None,
///     min_amount: Some(1000),
///     max_amount: Some(10000),
///     start_time_after: None,
///     end_time_before: Some(current_time),
/// };
/// ```
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamFilter {
    /// Filter by token address. If None, no token filtering is applied.
    pub token: Option<Address>,
    
    /// Filter by stream state (Active, Paused, Closed). If None, all states are included.
    pub state: Option<StreamState>,
    
    /// Minimum stream amount (inclusive). If None, no minimum bound is applied.
    pub min_amount: Option<i128>,
    
    /// Maximum stream amount (inclusive). If None, no maximum bound is applied.
    pub max_amount: Option<i128>,
    
    /// Filter streams started after this timestamp (exclusive). If None, no lower time bound.
    pub start_time_after: Option<u64>,
    
    /// Filter streams ending before this timestamp (inclusive). If None, no upper time bound.
    pub end_time_before: Option<u64>,
}

impl StreamFilter {
    /// Creates an empty filter that matches all streams.
    /// Useful for paginating through all streams in the contract.
    pub fn all() -> Self {
        StreamFilter {
            token: None,
            state: None,
            min_amount: None,
            max_amount: None,
            start_time_after: None,
            end_time_before: None,
        }
    }

    /// Check if a stream matches all applied filter criteria.
    /// Returns true if the stream passes all filters, false otherwise.
    pub fn matches(&self, stream: &Stream) -> bool {
        // Check token filter
        if let Some(ref token_filter) = self.token {
            if stream.token != *token_filter {
                return false;
            }
        }

        // Check state filter
        if let Some(ref state_filter) = self.state {
            if stream.state != *state_filter {
                return false;
            }
        }

        // Check min_amount filter
        if let Some(min) = self.min_amount {
            if stream.total_amount < min {
                return false;
            }
        }

        // Check max_amount filter
        if let Some(max) = self.max_amount {
            if stream.total_amount > max {
                return false;
            }
        }

        // Check start_time_after filter
        if let Some(after_time) = self.start_time_after {
            if stream.start_time <= after_time {
                return false;
            }
        }

        // Check end_time_before filter
        if let Some(before_time) = self.end_time_before {
            if stream.end_time > before_time {
                return false;
            }
        }

        true
    }
}
