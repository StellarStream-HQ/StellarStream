use soroban_sdk::{contracttype, Address, BytesN, String, Symbol, Val, Vec};

pub const MAX_MEMO_LENGTH: u32 = 32;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StreamV2 {
    pub sender: Address,
    pub receiver: Address,
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub cliff_time: u64,
    pub withdrawn_amount: i128,
    pub cancelled: bool,
    pub migrated_from_v1: bool,
    pub v1_stream_id: u64,
    pub step_duration: i128,
    pub multiplier_bps: i128,
    /// Penalty in basis points (0–10000) charged to the sender on early
    /// cancellation. The penalty is taken from the sender's remaining
    /// (unearned) balance and awarded to the receiver as a "breakup fee".
    pub penalty_bps: u32,
    pub vault_address: Option<Address>,
    pub yield_enabled: bool,
    pub is_pending: bool,
    /// Whether this stream auto-renews each cycle (Issue: Recurrent Streams)
    pub is_recurrent: bool,
    /// Duration of each recurrence cycle in seconds (Issue: Recurrent Streams)
    pub cycle_duration: u64,
    /// 0 = Unilateral cancellation, 1 = Mutual (both parties required) (Issue: Joint Signature)
    pub cancellation_type: u32,
    /// Who receives accrued vault yield: 0 = Sender, 1 = Receiver, 2 = Treasury (Issue #410)
    pub yield_recipient: u32,
    /// Address that receives a split of every withdrawal (Issue #411)
    pub split_address: Option<Address>,
    /// Fraction of each withdrawal routed to split_address, in basis points 0–9999 (Issue #411)
    pub split_bps: u32,
    /// Curve type: 0 = Linear, 1 = Exponential (back-loaded, unlocked = total * (elapsed/duration)^2)
    pub curve_type: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StreamArgs {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub step_duration: i128,
    pub multiplier_bps: i128,
    pub penalty_bps: u32,
    pub vault_address: Option<Address>,
    pub yield_enabled: bool,
    /// Enable monthly auto-renewal via transfer_from allowance
    pub is_recurrent: bool,
    /// Cycle length in seconds (e.g. 2_592_000 for ~30 days)
    pub cycle_duration: u64,
    /// 0 = Unilateral, 1 = Mutual cancellation
    pub cancellation_type: u32,
    /// Reserved for future routing extensions; protocol fees currently go to treasury only.
    pub affiliate: Option<Address>,
    /// Optional memo for external integrations (max 32 characters)
    pub memo: Option<Symbol>,
    /// Who receives accrued vault yield: 0 = Sender, 1 = Receiver, 2 = Treasury (Issue #410)
    pub yield_recipient: u32,
    /// Address that receives a split of every withdrawal (Issue #411)
    pub split_address: Option<Address>,
    /// Fraction of each withdrawal routed to split_address, in basis points 0–9999 (Issue #411)
    pub split_bps: u32,
    /// Curve type: 0 = Linear, 1 = Exponential (back-loaded, unlocked = total * (elapsed/duration)^2)
    pub curve_type: u32,
}

#[cfg(any(test, feature = "testutils"))]
impl Default for StreamArgs {
    fn default() -> Self {
        use soroban_sdk::testutils::Address as _;
        let env = soroban_sdk::Env::default();
        let dummy = soroban_sdk::Address::generate(&env);
        Self {
            sender: dummy.clone(),
            receiver: dummy.clone(),
            token: dummy.clone(),
            total_amount: 0,
            start_time: 0,
            cliff_time: 0,
            end_time: 0,
            step_duration: 0,
            multiplier_bps: 0,
            penalty_bps: 0,
            vault_address: None,
            yield_enabled: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            affiliate: None,
            memo: None,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PermitArgs {
    pub sender_pubkey: BytesN<32>,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub nonce: u64,
    pub deadline: u64,
    pub step_duration: i128,
    pub multiplier_bps: i128,
    pub vault_address: Option<Address>,
    pub yield_enabled: bool,
}

// ----------------------------------------------------------------
// Issue #402 — Permit2-Style Signature Streaming
// ----------------------------------------------------------------

/// The stream parameters that the sender signs off-chain.
/// The receiver submits this along with the sender's signature to claim
/// and start the stream without requiring the sender to be online.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StreamParams {
    /// The sender's Ed25519 public key (32 bytes).
    pub sender_pubkey: BytesN<32>,
    /// The intended receiver of the stream.
    pub receiver: Address,
    /// The token to stream.
    pub token: Address,
    /// Total amount to stream (before protocol fee).
    pub total_amount: i128,
    /// Stream start time (Unix timestamp).
    pub start_time: u64,
    /// Cliff time — no withdrawals before this (Unix timestamp, 0 = no cliff).
    pub cliff_time: u64,
    /// Stream end time (Unix timestamp).
    pub end_time: u64,
    /// Replay-protection nonce (must match the stored nonce for sender_pubkey).
    pub nonce: u64,
    /// Ledger number after which this signed intent is no longer valid.
    pub expiration_ledger: u32,
    /// Step duration for stepped streams (0 = linear).
    pub step_duration: i128,
    /// Multiplier in basis points for exponential streams (0 = linear).
    pub multiplier_bps: i128,
    /// Optional vault address for yield-bearing streams.
    pub vault_address: Option<Address>,
    /// Whether to enable yield on the stream.
    pub yield_enabled: bool,
}

/// Event emitted when a stream is created via an off-chain signed intent.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SignatureStreamCreatedEvent {
    pub stream_id: u64,
    pub sender_pubkey: BytesN<32>,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub expiration_ledger: u32,
    pub nonce: u64,
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Batch Read Helper Types
// ----------------------------------------------------------------

/// The lifecycle status of a stream at a given point in time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum StreamStatus {
    /// Not found — the stream ID does not exist.
    NotFound,
    /// Active — funds are still streaming.
    Active,
    /// Completed — the stream end_time has passed and all funds can be claimed.
    Completed,
    /// Cancelled — the stream was manually cancelled.
    Cancelled,
}

/// A compact summary of a stream returned by `get_streams_batch`.
/// Includes the stream's full data, the currently unlocked amount, and its status.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamBatchEntry {
    pub stream_id: u64,
    pub unlocked_amount: i128,
    pub status: StreamStatus,
}

// ----------------------------------------------------------------
// Events
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamMigratedEvent {
    pub v2_stream_id: u64,
    pub v1_stream_id: u64,
    pub caller: Address,
    pub migrated_amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationEvent {
    pub v1_id: u64,
    pub v2_id: u64,
    pub sender: Address,
    pub remaining_balance: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCreatedV2Event {
    pub stream_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchStreamsCreatedEvent {
    pub stream_ids: Vec<u64>,
    pub sender: Address,
    pub total_streams: u32,
    pub total_amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PermitPayload {
    pub contract: Address,
    pub sender_pubkey: soroban_sdk::BytesN<32>,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub nonce: u64,
    pub deadline: u64,
    pub step_duration: i128,
    pub multiplier_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PermitStreamCreatedEvent {
    pub stream_id: u64,
    pub sender_pubkey: soroban_sdk::BytesN<32>,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub cliff_time: u64,
    pub nonce: u64,
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Contract lifecycle state (#934)
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ContractState {
    Active,
    Terminated,
}

/// Emitted when decommission_contract() is called.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractTerminatedEvent {
    pub admin: Address,
    pub claim_deadline: u64,
    pub timestamp: u64,
}

// Issue #597 - Atomic Multi-Transfer Implementation
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct Recipient {
    pub address: Address,
    pub amount: i128,
}

/// A recipient entry for `split_by_bps`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BpsRecipient {
    pub address: Address,
    pub bps: u32,
}

// ----------------------------------------------------------------
// Issue #601 - Multi-Asset Batch Disbursement
// ----------------------------------------------------------------

/// A single recipient entry for `split_multi_asset`.
/// Each row specifies its own asset, so different recipients can receive
/// different tokens in a single atomic call.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiAssetRecipient {
    pub address: Address,
    pub asset: Address,
    pub amount: i128,
}

/// Emitted when the admin is transferred to a new address.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransferredEvent {
    pub previous_admin: Address,
    pub new_admin: Address,
    pub timestamp: u64,
}

/// Emitted when the contract is paused by the admin.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractPausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractUnpausedEvent {
    pub admin: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamClaimV2Event {
    pub stream_id: u64,
    pub receiver: Address,
    pub amount: i128,
    pub total_claimed: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DustAccumulatedEvent {
    pub stream_id: u64,
    pub token: Address,
    pub split_address: Address,
    pub split_bps: u32,
    pub to_withdraw: i128,
    pub split_amount: i128,
    pub dust_amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCancelledV2Event {
    pub stream_id: u64,
    pub canceller: Address,
    pub to_receiver: i128,
    pub penalty: i128,
    pub to_sender: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolHealthV2 {
    pub total_v2_tvl: i128,
    pub active_v2_users: u32,
    pub total_v2_streams: u64,
}

// ----------------------------------------------------------------
// Time-locked operations
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    SetAdmins(Vec<Address>, u32),
    TransferAdmin(Address),
    SetMinValue(Address, i128),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OperationScheduledEvent {
    pub op: Operation,
    pub execution_time: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OperationExecutedEvent {
    pub op: Operation,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BeneficiaryTransferredV2Event {
    pub stream_id: u64,
    pub previous_beneficiary: Address,
    pub new_beneficiary: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackRebalanceEvent {
    pub token: Address,
    pub total_remaining: i128,
    pub contract_balance: i128,
    pub reduction_factor_bps: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamToppedUpEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub extra_amount: i128,
    pub new_total_amount: i128,
    pub new_end_time: u64,
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Issue: Standardized V2 Events (NebulaEvent)
// ----------------------------------------------------------------

/// Standardized event wrapper for all V2 contract actions.
/// The Indexer uses `version` to distinguish V1 vs V2 data.
/// For stream-related events, `stream_id` is always the first topic.
#[contracttype]
#[derive(Clone, Debug)]
pub struct NebulaEvent {
    pub version: u32,
    pub timestamp: u64,
    pub action: Symbol,
    pub data: Vec<Val>,
}

// ----------------------------------------------------------------
// Issue: Recurrent Streams Events
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRefilledEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub amount: i128,
    pub new_start_time: u64,
    pub new_end_time: u64,
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Issue: Protocol Fee Events
// ----------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct FeesWithdrawnEvent {
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SplitExecutedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub amount: i128,
    pub memo: Option<Symbol>,
    pub timestamp: u64,
}
// ----------------------------------------------------------------
// Issue #408 — Multi-sig Transaction Buffer (Stream Request Approval)
// ----------------------------------------------------------------

/// Event emitted when a stream creation request is initiated
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRequestInitiatedEvent {
    pub request_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub threshold: u32,
    pub timestamp: u64,
}

/// Event emitted when an admin approves a stream request
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRequestApprovedEvent {
    pub request_id: u64,
    pub approver: Address,
    pub approvals: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

/// Event emitted when a stream request is executed (after threshold met)
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamRequestExecutedEvent {
    pub request_id: u64,
    pub stream_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamSplitUpdatedEvent {
    pub stream_id: u64,
    pub beneficiary: Address,
    pub split_address: Option<Address>,
    pub split_bps: u32,
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Issue #378 — Streaming Swap (DEX Integration)
// ----------------------------------------------------------------

/// Arguments for creating a stream with an automatic DEX swap.
/// The sender provides `amount_in` of `asset_in`, which is swapped to
/// `asset_out` via a Soroban AMM before initializing the stream.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SwapStreamArgs {
    /// The sender address (must authorize this call)
    pub sender: Address,
    /// The receiver address (receives the streamed asset_out)
    pub receiver: Address,
    /// Amount of asset_in to deposit and swap
    pub amount_in: i128,
    /// Asset being deposited (e.g., XLM)
    pub asset_in: Address,
    /// Asset to receive after swap (e.g., USDC) - this is the streamed asset
    pub asset_out: Address,
    /// Minimum amount of asset_out to receive after swap (slippage protection)
    pub min_amount_out: i128,
    /// Slippage tolerance in basis points (0-10000, e.g., 50 = 0.5%)
    /// This is an additional safety check beyond min_amount_out
    pub slippage_tolerance_bps: u32,
    /// When the swap must be executed by (Unix timestamp)
    pub swap_deadline: u64,
    /// Stream start time (Unix timestamp)
    pub start_time: u64,
    /// Stream end time (Unix timestamp)
    pub end_time: u64,
    /// Optional cliff time for the stream
    pub cliff_time: u64,
    /// Optional vault address for yield-bearing streams
    pub vault_address: Option<Address>,
    /// Whether to enable yield on the stream
    pub yield_enabled: bool,
    /// Who receives accrued vault yield: 0 = Sender, 1 = Receiver, 2 = Treasury
    pub yield_recipient: u32,
    /// Address that receives a split of every withdrawal
    pub split_address: Option<Address>,
    /// Fraction of each withdrawal routed to split_address (0-9999 bps)
    pub split_bps: u32,
    /// 0 = Unilateral, 1 = Mutual cancellation
    pub cancellation_type: u32,
}

/// Result of a swap operation returned to the caller
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SwapResult {
    /// Amount of asset_in that was swapped
    pub amount_in: i128,
    /// Amount of asset_out received from the swap
    pub amount_out: i128,
    /// Price impact in basis points (e.g., 100 = 1% price impact)
    pub price_impact_bps: i128,
}

/// Event emitted when a swap stream is created
#[contracttype]
#[derive(Clone, Debug)]
pub struct SwapStreamCreatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub asset_in: Address,
    pub asset_out: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub min_amount_out: i128,
    pub timestamp: u64,
}

/// DEX pool information for swap operations
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DexPoolInfo {
    /// The DEX contract address
    pub dex_address: Address,
    /// The first asset in the pool (token address or None for native XLM)
    pub token_a: Option<Address>,
    /// The second asset in the pool
    pub token_b: Address,
    /// Pool fee in basis points (e.g., 30 = 0.3% fee)
    pub fee_bps: u32,
}

// ----------------------------------------------------------------
// Issue #377 — Push-Pull Rate Re-balancing
// ----------------------------------------------------------------

/// Represents a pending rate update proposal for a stream.
/// This is stored temporarily with a 7-day TTL.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingRateUpdate {
    /// The new proposed rate (amount per second)
    pub new_rate: i128,
    /// Unix timestamp when the proposal was created
    pub proposed_at: u64,
    /// Address that proposed the change (always the sender)
    pub proposed_by: Address,
    /// Original end time before the change
    pub original_end_time: u64,
    /// Original total amount before the change
    pub original_total_amount: i128,
}

/// Event emitted when a rate update is proposed
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateUpdateProposedEvent {
    pub stream_id: u64,
    pub proposed_by: Address,
    pub current_rate: i128,
    pub new_rate: i128,
    pub new_end_time: u64,
    pub expires_at: u64,
    pub timestamp: u64,
}

/// Event emitted when a rate update is accepted
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateUpdateAcceptedEvent {
    pub stream_id: u64,
    pub accepted_by: Address,
    pub new_rate: i128,
    pub new_end_time: u64,
    pub remaining_balance: i128,
    pub timestamp: u64,
}

/// Event emitted when a rate update proposal is cancelled
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateUpdateCancelledEvent {
    pub stream_id: u64,
    pub cancelled_by: Address,
    pub reason: u32, // 0 = expired, 1 = manually cancelled
    pub timestamp: u64,
}

// ----------------------------------------------------------------
// Issue #409 — Pre-Flight Simulation Helper
// ----------------------------------------------------------------

/// Result of a stream creation simulation.
/// This is a read-only dry-run that checks if stream creation would succeed.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SimulationResult {
    /// Whether the stream creation would succeed
    pub success: bool,
    /// Estimated storage footprint in bytes
    pub estimated_footprint_bytes: u32,
    /// Estimated RAM usage in bytes
    pub estimated_ram_bytes: u32,
    /// Error code if simulation failed (0 = success)
    pub error_code: u32,
    /// Human-readable error message if simulation failed
    pub error_message: String,
    /// Current sender balance
    pub sender_balance: i128,
    /// Required balance (including protocol fee)
    pub required_balance: i128,
    /// Whether the sender has sufficient balance
    pub has_sufficient_balance: bool,
    /// Estimated protocol fee
    pub estimated_protocol_fee: i128,
}

/// Detailed simulation report with all checks
#[contracttype]
#[derive(Clone, Debug)]
pub struct SimulationReport {
    /// Overall success status
    pub would_succeed: bool,
    /// Balance check result
    pub balance_check: SimulationCheck,
    /// Storage check result
    pub storage_check: SimulationCheck,
    /// Parameter validation result
    pub params_check: SimulationCheck,
    /// Ledger footprint estimate
    pub footprint: LedgerFootprint,
}

/// Individual simulation check result
#[contracttype]
#[derive(Clone, Debug)]
pub struct SimulationCheck {
    /// Whether this check passed
    pub passed: bool,
    /// Error code if failed
    pub error_code: u32,
    /// Error message if failed
    pub error_message: String,
}

/// Estimated ledger footprint for a stream
#[contracttype]
#[derive(Clone, Debug)]
pub struct LedgerFootprint {
    /// Instance storage bytes
    pub instance_bytes: u32,
    /// Persistent storage bytes
    pub persistent_bytes: u32,
    /// Estimated read operations
    pub estimated_reads: u32,
    /// Estimated write operations
    pub estimated_writes: u32,
    /// Estimated emit events size
    pub event_bytes: u32,
}
