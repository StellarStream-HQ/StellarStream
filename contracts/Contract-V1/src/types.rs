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
