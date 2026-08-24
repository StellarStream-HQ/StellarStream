//! Shared data types, storage keys, and event payloads for the Contract-V1 token
//! streaming contract.

pub use crate::rbac::Role;
use soroban_sdk::{contracttype, Address, BytesN, Map, Vec};

// Interest distribution strategies
// Bits can be combined: e.g., 0b011 = 50% sender, 50% receiver
/// Interest strategy bit: route 100% of vault-earned interest to the sender.
#[allow(dead_code)]
pub const INTEREST_TO_SENDER: u32 = 0b001; // 1: All interest to sender
/// Interest strategy bit: route 100% of vault-earned interest to the receiver.
#[allow(dead_code)]
pub const INTEREST_TO_RECEIVER: u32 = 0b010; // 2: All interest to receiver
/// Interest strategy bit: route 100% of vault-earned interest to the protocol.
#[allow(dead_code)]
pub const INTEREST_TO_PROTOCOL: u32 = 0b100; // 4: All interest to protocol

// Common strategy combinations (exported for convenience)
/// Interest strategy: split evenly between sender and receiver (50/50).
#[allow(dead_code)]
pub const INTEREST_SPLIT_SENDER_RECEIVER: u32 = 0b011; // 3: 50/50 sender/receiver
/// Interest strategy: split evenly among sender, receiver, and protocol (33/33/33).
#[allow(dead_code)]
pub const INTEREST_SPLIT_ALL: u32 = 0b111; // 7: 33/33/33 split

/// Lifecycle state of a token stream.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamState {
    /// The stream is actively vesting and can be withdrawn from.
    Active = 0,
    /// The stream is temporarily paused; vesting does not progress while paused.
    Paused = 1,
    /// The stream has been cancelled or fully withdrawn and is no longer active.
    Closed = 2,
}

/// Vesting curve applied to a stream's unlock schedule.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CurveType {
    /// Tokens unlock proportionally to elapsed time (see
    /// [`calculate_unlocked_amount`](crate::math::calculate_unlocked_amount)).
    Linear = 0,
    /// Tokens unlock along a quadratic curve that accelerates near the end (see
    /// [`calculate_exponential_unlocked`](crate::math::calculate_exponential_unlocked)).
    Exponential = 1,
}

/// Reference to an external price oracle used for USD-pegged streams.
#[contracttype]
#[derive(Clone)]
pub struct PriceOracle {
    /// Address of the oracle contract to query.
    pub oracle_address: Address,
    /// Maximum age, in seconds, of a price reading before it is rejected as stale.
    pub max_staleness: u64,
}

/// Configuration for a stream whose payout amount is pegged to a USD value rather
/// than a fixed token amount.
#[contracttype]
#[derive(Clone)]
pub struct UsdPegConfig {
    /// Target USD value, with 7 decimals (e.g. `5_000_000_000` = $500).
    pub usd_amount: i128,
    /// Minimum acceptable oracle price; guards against unfavorable slippage.
    pub min_price: i128,
    /// Maximum acceptable oracle price; guards against unfavorable slippage.
    pub max_price: i128,
    /// Oracle used to resolve the current token price.
    pub oracle: PriceOracle,
}

/// A single milestone in a milestone-based vesting schedule.
#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    /// Unix timestamp at which this milestone's tokens become unlockable.
    pub timestamp: u64,
    /// Percentage (0-100) of the stream's total amount unlocked at this milestone.
    pub percentage: u32,
}

/// A token stream: the core on-chain record of a vesting payment from `sender` to
/// `receiver`.
#[contracttype]
#[derive(Clone)]
pub struct Stream {
    /// Address that created and funded the stream.
    pub sender: Address,
    /// Address entitled to withdraw vested tokens.
    pub receiver: Address,
    /// Address of the token contract being streamed.
    pub token: Address,
    /// Total amount the stream will pay out over its lifetime.
    pub total_amount: i128,
    /// Unix timestamp when vesting begins.
    pub start_time: u64,
    /// Unix timestamp before which nothing is unlocked, even if `start_time` has passed.
    pub cliff_time: u64,
    /// Unix timestamp when vesting completes.
    pub end_time: u64,
    /// Legacy withdrawn-amount field, retained for backward compatibility; prefer
    /// `withdrawn_amount`.
    pub withdrawn: i128,
    /// Amount already withdrawn by the receiver.
    pub withdrawn_amount: i128,
    /// Address currently holding the stream's ownership receipt (may differ from
    /// `receiver` after a receipt transfer, unless the stream `is_soulbound`).
    pub receipt_owner: Address,
    /// Unix timestamp at which the stream was most recently paused (`0` if not paused).
    pub paused_time: u64,
    /// Cumulative time, in seconds, the stream has spent paused; extends the effective
    /// vesting schedule so pauses don't cost the receiver vested time.
    pub total_paused_duration: u64,
    /// Milestone unlock schedule, used when the stream vests by milestones rather than
    /// (or in addition to) `curve_type`.
    pub milestones: Vec<Milestone>,
    /// Vesting curve controlling how `total_amount` unlocks over time.
    pub curve_type: CurveType,
    /// Bitmask selecting how vault-earned interest is distributed; see
    /// [`calculate_interest_distribution`](crate::interest::calculate_interest_distribution).
    pub interest_strategy: u32,
    /// Address of the lending vault holding this stream's principal, if any.
    pub vault_address: Option<Address>,
    /// Principal amount currently deposited in `vault_address`.
    pub deposited_principal: i128,
    /// Opaque, caller-supplied metadata hash associated with the stream.
    pub metadata: Option<BytesN<32>>,
    /// Whether this stream's payout amount is pegged to a USD value via an oracle.
    pub is_usd_pegged: bool,
    /// Target USD value (7 decimals) when `is_usd_pegged` is true.
    pub usd_amount: i128,
    /// Address of the price oracle used when `is_usd_pegged` is true.
    pub oracle_address: Address,
    /// Maximum allowed staleness, in seconds, of the oracle price.
    pub oracle_max_staleness: u64,
    /// Minimum acceptable oracle price (slippage protection) when `is_usd_pegged`.
    pub price_min: i128,
    /// Maximum acceptable oracle price (slippage protection) when `is_usd_pegged`.
    pub price_max: i128,
    /// If true, this stream is permanently locked to the original receiver.
    /// The receiver cannot be transferred for any reason. Used for identity-based
    /// rewards, grants, or compliance-locked distributions.
    /// Default: false (for backward compatibility with existing streams)
    /// Note: We use bool instead of `Option<bool>` to avoid storage overhead and
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

/// A multi-signature governance proposal for creating a stream, requiring approval
/// from a threshold of `approvers` before it can be executed.
///
/// Legacy structure (v1) that predates `cliff_time`; retained for migration purposes.
#[contracttype]
#[derive(Clone)]
pub struct StreamProposal {
    /// Address that will fund and become the sender of the resulting stream.
    pub sender: Address,
    /// Address that will receive the resulting stream.
    pub receiver: Address,
    /// Address of the token contract to be streamed.
    pub token: Address,
    /// Total amount the resulting stream would pay out.
    pub total_amount: i128,
    /// Unix timestamp when the resulting stream's vesting would begin.
    pub start_time: u64,
    /// Unix timestamp when the resulting stream's vesting would complete.
    pub end_time: u64,
    /// Addresses that have approved this proposal so far.
    pub approvers: Vec<Address>,
    /// Number of approvals required before the proposal can be executed.
    pub required_approvals: u32,
    /// Unix timestamp after which the proposal can no longer be approved or executed.
    pub deadline: u64,
    /// Whether the proposal has already been executed into a live stream.
    pub executed: bool,
}

/// Parameters for requesting a stream from a contributor-facing request queue.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamRequest {
    /// Address that would receive the resulting stream.
    pub receiver: Address,
    /// Total amount the resulting stream would pay out.
    pub amount: i128,
    /// Unix timestamp when the resulting stream's vesting would begin.
    pub start_time: u64,
    /// Unix timestamp before which nothing would unlock.
    pub cliff_time: u64,
    /// Unix timestamp when the resulting stream's vesting would complete.
    pub end_time: u64,
    /// Bitmask selecting how vault-earned interest would be distributed.
    pub interest_strategy: u32,
    /// Lending vault the resulting stream's principal would be deposited into, if any.
    pub vault_address: Option<Address>,
    /// Opaque metadata hash to attach to the resulting stream.
    pub metadata: Option<BytesN<32>>,
}

/// Optional stream configuration bundled together to keep the
/// `create_stream_with_milestones` entry point within Soroban's
/// maximum contract function parameter limit.
///
/// Bundling these three optional knobs into a single struct allows the
/// milestone-aware creation entry point to stay under the 10-parameter cap
/// while preserving the full set of configuration options.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamOptions {
    pub curve_type: CurveType,
    pub is_soulbound: bool,
    pub vault_address: Option<Address>,
}

/// Result of splitting vault-earned interest among a stream's sender, receiver, and
/// the protocol. See
/// [`calculate_interest_distribution`](crate::interest::calculate_interest_distribution).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterestDistribution {
    /// Share of interest routed to the stream's sender.
    pub to_sender: i128,
    /// Share of interest routed to the stream's receiver.
    pub to_receiver: i128,
    /// Share of interest routed to the protocol treasury.
    pub to_protocol: i128,
    /// Total interest that was distributed (`to_sender + to_receiver + to_protocol`).
    pub total_interest: i128,
}

/// Instance-storage key space for the Contract-V1 contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// A single stream, keyed by stream ID.
    Stream(u64),
    /// Counter for the next stream ID to assign.
    StreamId,
    /// Contract admin address. Kept for backward compatibility; prefer the RBAC
    /// `Role` system for new authorization checks.
    Admin,
    /// Protocol fee, in basis points.
    FeeBps,
    /// Address that receives protocol fees.
    Treasury,
    /// Whether the contract is currently paused.
    IsPaused,
    /// Reentrancy guard flag.
    ReentrancyLock,
    /// Current contract version, used by the upgrade/migration system.
    ContractVersion,
    /// Whether a given migration version has already been executed.
    MigrationExecuted(u32),
    /// RBAC role assignment for a given address.
    Role(Address, Role),
    /// `Vec<u64>` of all stream IDs flagged as soulbound.
    SoulboundStreams,
    /// `Vec<Address>` of lending vaults approved for use with streams.
    ApprovedVaults,
    /// Vault shares held on behalf of a given stream ID.
    VaultShares(u64),
    /// Voting-power delegate assigned for a given stream ID.
    VotingDelegate(u64),
    /// Counter for the next upgrade proposal ID.
    UpgradeProposalCount,
    /// An upgrade proposal, keyed by proposal ID.
    UpgradeProposal(u64),
    /// `Vec<UpgradeRecord>` log of previously executed upgrades.
    UpgradeHistory,
    /// Recurrence configuration for a recurring stream, keyed by root stream ID.
    Recurrence(u64),
}

/// NFT-style ownership receipt for a stream, tracking who is entitled to manage or
/// transfer control of it.
#[contracttype]
#[derive(Clone)]
pub struct StreamReceipt {
    /// ID of the stream this receipt represents.
    pub stream_id: u64,
    /// Current owner of the receipt.
    pub owner: Address,
    /// Unix timestamp when the receipt was minted.
    pub minted_at: u64,
}

/// Event emitted when a new stream is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCreatedEvent {
    /// ID of the newly created stream.
    pub stream_id: u64,
    /// Address funding the stream.
    pub sender: Address,
    /// Address entitled to withdraw from the stream.
    pub receiver: Address,
    /// Token contract being streamed.
    pub token: Address,
    /// Total amount the stream will pay out.
    pub total_amount: i128,
    /// Unix timestamp when vesting begins.
    pub start_time: u64,
    /// Unix timestamp when vesting completes.
    pub end_time: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a receiver withdraws vested tokens from a stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamClaimEvent {
    /// ID of the stream withdrawn from.
    pub stream_id: u64,
    /// Address that performed the withdrawal.
    pub claimer: Address,
    /// Amount withdrawn in this claim.
    pub amount: i128,
    /// Cumulative amount withdrawn from the stream to date.
    pub total_claimed: i128,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream is cancelled and remaining funds are split between
/// sender and receiver.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCancelledEvent {
    /// ID of the cancelled stream.
    pub stream_id: u64,
    /// Address that cancelled the stream.
    pub canceller: Address,
    /// Amount of remaining (vested but unwithdrawn) funds sent to the receiver.
    pub to_receiver: i128,
    /// Amount of remaining (unvested) funds returned to the sender.
    pub to_sender: i128,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a compliance officer claws back tokens from a stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackEvent {
    /// ID of the stream clawed back from.
    pub stream_id: u64,
    /// Address of the compliance officer who initiated the clawback.
    pub officer: Address,
    /// Amount of tokens clawed back.
    pub amount_clawed: i128,
    /// Address of the asset issuer that authorized the clawback.
    pub issuer: Address,
    /// Optional metadata hash explaining the reason for the clawback.
    pub reason: Option<BytesN<32>>,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream is frozen pending dispute resolution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamFrozenEvent {
    /// ID of the frozen stream.
    pub stream_id: u64,
    /// Address of the arbiter who froze the stream.
    pub arbiter: Address,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when additional funds are added to an existing stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamToppedUpEvent {
    /// ID of the topped-up stream.
    pub stream_id: u64,
    /// Address that supplied the additional funds.
    pub sender: Address,
    /// Amount added to the stream.
    pub amount: i128,
    /// Stream's total amount after the top-up.
    pub new_total: i128,
    /// Stream's end time after the top-up (extended to accommodate the added funds).
    pub new_end_time: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream's ownership receipt is transferred to a new owner.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptTransferredEvent {
    /// ID of the stream whose receipt was transferred.
    pub stream_id: u64,
    /// Previous receipt owner.
    pub from: Address,
    /// New receipt owner.
    pub to: Address,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream is paused.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamPausedEvent {
    /// ID of the paused stream.
    pub stream_id: u64,
    /// Address that paused the stream.
    pub pauser: Address,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream is unpaused (alias of resume; see
/// [`StreamResumedEvent`]).
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamUnpausedEvent {
    /// ID of the unpaused stream.
    pub stream_id: u64,
    /// Address that unpaused the stream.
    pub unpauser: Address,
    /// Total duration, in seconds, the stream spent paused.
    pub paused_duration: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a stream is resumed from a paused state.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamResumedEvent {
    /// ID of the resumed stream.
    pub stream_id: u64,
    /// Address that resumed the stream.
    pub resumer: Address,
    /// Total duration, in seconds, the stream spent paused.
    pub paused_duration: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an address approves a governance proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalApprovedEvent {
    /// ID of the proposal approved.
    pub proposal_id: u64,
    /// Address that approved the proposal.
    pub approver: Address,
    /// Number of approvals the proposal has received so far, including this one.
    pub approval_count: u32,
    /// Number of approvals required before the proposal can be executed.
    pub required_approvals: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a new governance proposal for a stream is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalCreatedEvent {
    /// ID of the newly created proposal.
    pub proposal_id: u64,
    /// Address that would fund the resulting stream.
    pub sender: Address,
    /// Address that would receive the resulting stream.
    pub receiver: Address,
    /// Token contract the resulting stream would use.
    pub token: Address,
    /// Total amount the resulting stream would pay out.
    pub total_amount: i128,
    /// Unix timestamp when the resulting stream's vesting would begin.
    pub start_time: u64,
    /// Unix timestamp when the resulting stream's vesting would complete.
    pub end_time: u64,
    /// Number of approvals required before the proposal can be executed.
    pub required_approvals: u32,
    /// Unix timestamp after which the proposal can no longer be approved or executed.
    pub deadline: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Snapshot of a stream receipt's balances, suitable for off-chain display (e.g. as
/// NFT metadata).
#[contracttype]
#[derive(Clone)]
pub struct ReceiptMetadata {
    /// ID of the stream this receipt represents.
    pub stream_id: u64,
    /// Portion of the stream's total amount not yet vested.
    pub locked_balance: i128,
    /// Portion of the stream's total amount vested but not yet withdrawn.
    pub unlocked_balance: i128,
    /// Stream's total amount.
    pub total_amount: i128,
    /// Token contract being streamed.
    pub token: Address,
}

/// Approval status of a [`ContributorRequest`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    /// Awaiting a decision.
    Pending,
    /// Approved and available for execution into a stream.
    Approved,
    /// Rejected; cannot be executed.
    Rejected,
}

/// A contributor-initiated request for a stream, awaiting approval before a stream is
/// created.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorRequest {
    /// Unique request ID.
    pub id: u64,
    /// Address requesting to receive a stream.
    pub receiver: Address,
    /// Token contract requested.
    pub token: Address,
    /// Total amount requested.
    pub total_amount: i128,
    /// Requested stream duration, in seconds.
    pub duration: u64,
    /// Requested Unix timestamp for the stream to begin.
    pub start_time: u64,
    /// Current approval status.
    pub status: RequestStatus,
    /// Optional metadata hash to attach to the request.
    pub metadata: Option<BytesN<32>>,
}

/// Storage key space for [`ContributorRequest`] records.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestKey {
    /// A single request, keyed by request ID.
    Request(u64),
    /// Counter for the next request ID to assign.
    RequestCount,
}

/// Event emitted when a contributor request is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestCreatedEvent {
    /// ID of the newly created request.
    pub request_id: u64,
    /// Address requesting to receive a stream.
    pub receiver: Address,
    /// Token contract requested.
    pub token: Address,
    /// Total amount requested.
    pub total_amount: i128,
    /// Requested stream duration, in seconds.
    pub duration: u64,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an approved contributor request is executed into a live stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestExecutedEvent {
    /// ID of the request that was executed.
    pub request_id: u64,
    /// ID of the stream created from the request.
    pub stream_id: u64,
    /// Address that executed the request.
    pub executor: Address,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

// ========== Upgrade Proposal Types ==========

/// Lifecycle status of an [`UpgradeProposal`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpgradeProposalStatus {
    /// Awaiting the required number of approvals.
    Pending,
    /// Has enough approvals and is past its timelock; ready to execute.
    Approved,
    /// Has been executed; the contract has been upgraded.
    Executed,
    /// Passed its deadline without being executed; can no longer be executed.
    Expired,
    /// Rejected or cancelled before execution.
    Rejected,
}

/// An upgrade proposal that requires multi-sig approval + timelock
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposal {
    /// Unique proposal ID
    pub proposal_id: u64,
    /// The new WASM hash to upgrade to
    pub new_wasm_hash: BytesN<32>,
    /// Addresses that have approved this proposal
    pub approvers: Vec<Address>,
    /// Number of approvals required to pass
    pub required_approvals: u32,
    /// When the proposal was created
    pub created_at: u64,
    /// When the timelock expires and upgrade can be executed
    pub timelock_expiry: u64,
    /// When the proposal expires (default 7 days after creation)
    pub deadline: u64,
    /// Current status
    pub status: UpgradeProposalStatus,
    /// Description/reason for the upgrade
    pub description: soroban_sdk::String,
}

/// A record of a completed upgrade (for history tracking)
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeRecord {
    /// The WASM hash that was upgraded to
    pub wasm_hash: BytesN<32>,
    /// The version string of the new contract
    pub version: u32,
    /// Admin address that executed the upgrade
    pub executed_by: Address,
    /// Timestamp when upgrade was executed
    pub executed_at: u64,
}

// ========== Upgrade Events ==========

/// Event emitted when a new upgrade proposal is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeProposedEvent {
    /// ID of the newly created proposal.
    pub proposal_id: u64,
    /// Address that proposed the upgrade.
    pub proposer: Address,
    /// WASM hash the contract would be upgraded to.
    pub new_wasm_hash: BytesN<32>,
    /// Number of approvals required before the upgrade can be executed.
    pub required_approvals: u32,
    /// Unix timestamp before which the upgrade cannot be executed, even if approved.
    pub timelock_expiry: u64,
    /// Unix timestamp after which the proposal can no longer be approved or executed.
    pub deadline: u64,
    /// Human-readable description of the upgrade.
    pub description: soroban_sdk::String,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an address approves an upgrade proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeApprovedEvent {
    /// ID of the proposal approved.
    pub proposal_id: u64,
    /// Address that approved the proposal.
    pub approver: Address,
    /// Number of approvals the proposal has received so far, including this one.
    pub approval_count: u32,
    /// Number of approvals required before the upgrade can be executed.
    pub required_approvals: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an upgrade proposal is executed, upgrading the contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeExecutedEvent {
    /// ID of the proposal that was executed.
    pub proposal_id: u64,
    /// WASM hash the contract was upgraded to.
    pub new_wasm_hash: BytesN<32>,
    /// Address that executed the upgrade.
    pub executed_by: Address,
    /// Contract version after the upgrade.
    pub new_version: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an upgrade proposal is cancelled before execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UpgradeCancelledEvent {
    /// ID of the proposal that was cancelled.
    pub proposal_id: u64,
    /// Address that cancelled the proposal.
    pub cancelled_by: Address,
    /// Human-readable reason for the cancellation.
    pub reason: soroban_sdk::String,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

// ========== Dispute Resolution Types ==========

/// Possible resolutions for a stream dispute.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeResolution {
    /// Refund `i128` amount to the sender.
    RefundSender(i128),
    /// Pay `i128` amount to the receiver.
    PayReceiver(i128),
    /// Freeze the stream pending further review.
    FreezeStream,
    /// Cancel the stream entirely.
    CancelStream,
}

/// A dispute raised by either party of a stream, to be resolved by arbitrators.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Dispute {
    /// Unique dispute ID.
    pub dispute_id: u64,
    /// ID of the stream under dispute.
    pub stream_id: u64,
    /// Address that raised the dispute (sender or receiver).
    pub raised_by: Address,
    /// Human-readable reason for the dispute.
    pub reason: soroban_sdk::String,
    /// Proposed resolution by the raiser.
    pub proposed_resolution: DisputeResolution,
    /// Arbitrator votes: address -> approve (true) / reject (false).
    pub arbitrator_votes: Map<Address, bool>,
    /// Whether the dispute has been resolved.
    pub resolved: bool,
    /// Unix timestamp when the dispute was raised.
    pub raised_at: u64,
    /// Unix timestamp after which the dispute can no longer be voted on.
    pub deadline: u64,
    /// Number of arbitrator approvals required to auto-execute the resolution.
    pub required_votes: u32,
}

/// Event emitted when a dispute is raised.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeRaisedEvent {
    /// ID of the newly raised dispute.
    pub dispute_id: u64,
    /// ID of the stream under dispute.
    pub stream_id: u64,
    /// Address that raised the dispute.
    pub raised_by: Address,
    /// Human-readable reason for the dispute.
    pub reason: soroban_sdk::String,
    /// Proposed resolution.
    pub proposed_resolution: DisputeResolution,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when an arbitrator votes on a dispute.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeVotedEvent {
    /// ID of the dispute voted on.
    pub dispute_id: u64,
    /// Address of the arbitrator who voted.
    pub arbitrator: Address,
    /// Whether the arbitrator approved the proposed resolution.
    pub approve: bool,
    /// Number of approvals the dispute has received so far.
    pub approval_count: u32,
    /// Number of approvals required to auto-execute.
    pub required_votes: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a dispute is resolved and its resolution auto-executes.
#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeResolvedEvent {
    /// ID of the resolved dispute.
    pub dispute_id: u64,
    /// ID of the stream the dispute was resolved for.
    pub stream_id: u64,
    /// The resolution that was executed.
    pub resolution: DisputeResolution,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

// ========== Recurring Stream Types ==========

/// Configuration that controls whether and how a stream auto-renews after its
/// period completes.
///
/// Stored under [`DataKey::Recurrence(root_stream_id)`] alongside the first
/// period's stream. Updated by [`renew_stream`] and [`stop_recurring_stream`].
///
/// # Recurrence mechanics
/// - `max_occurrences == 0` → unlimited (renews until manually stopped).
/// - `max_occurrences > 0` → stops after that many **renewal** periods.
/// - The first period is always created by [`create_recurring_stream`] and is
///   not counted in `occurrences_completed`; each subsequent period increments
///   the counter by one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecurrenceConfig {
    /// Whether auto-renewal is still active. `false` after manual stop or when
    /// `max_occurrences` is reached.
    pub enabled: bool,
    /// Maximum renewal periods. `0` means unlimited.
    pub max_occurrences: u32,
    /// Number of renewal periods completed so far (not counting the first period).
    pub occurrences_completed: u32,
    /// Token amount streamed per period.
    pub amount_per_period: i128,
    /// Duration of each period in seconds.
    pub period_duration: u64,
    /// Token contract used for all periods.
    pub token: Address,
    /// Address funding every period.
    pub sender: Address,
    /// Address receiving tokens every period.
    pub receiver: Address,
    /// Stream ID of the most recently created period in this chain.
    pub current_stream_id: u64,
}

/// Event emitted when a new recurring stream chain is started.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecurringStreamCreatedEvent {
    /// Root stream ID (first period).
    pub root_stream_id: u64,
    /// Token contract being streamed.
    pub token: Address,
    /// Funding address.
    pub sender: Address,
    /// Receiving address.
    pub receiver: Address,
    /// Amount per period.
    pub amount_per_period: i128,
    /// Duration of each period in seconds.
    pub period_duration: u64,
    /// Maximum renewals (`0` = unlimited).
    pub max_occurrences: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a recurring stream renews for a new period.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecurringStreamRenewedEvent {
    /// Root stream ID (the chain anchor).
    pub root_stream_id: u64,
    /// Stream ID of the newly created renewal period.
    pub new_stream_id: u64,
    /// Total renewals completed including this one.
    pub occurrences_completed: u32,
    /// Maximum renewals (`0` = unlimited).
    pub max_occurrences: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}

/// Event emitted when a recurring stream is manually stopped.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecurringStreamStoppedEvent {
    /// Root stream ID.
    pub root_stream_id: u64,
    /// Address that stopped the stream.
    pub stopped_by: Address,
    /// Renewals completed before stopping.
    pub occurrences_completed: u32,
    /// Unix timestamp when the event was emitted.
    pub timestamp: u64,
}
