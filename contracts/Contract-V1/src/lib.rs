#![no_std]
// Contract entry points are constrained by the on-chain spec (and the public
// SDK API), so the arity of functions like `create_stream` is intentional.
#![allow(clippy::too_many_arguments)]

//! StellarStream - Real-time asset streaming on Stellar
//!
//! Genesis contract (V1) for the StellarStream protocol.
//!
//! Core concepts:
//! - Continuous token streaming from sender to receiver
//! - Linear / exponential vesting based on elapsed time
//! - Real-time withdrawals of unlocked amounts
//! - Cancellation support with automatic refunds
//! - Role-based access control, pause/resume, and OFAC-style address restriction
//! - Re-entrancy safe withdrawals (checks-effects-interactions + temporary lock)
//! - Health and usage metrics for production monitoring
//!
//! # Monitoring
//!
//! [`StellarStreamContract::health_check`] reports point-in-time state (paused
//! flag, active stream count, per-token TVL, last activity, version) and
//! [`StellarStreamContract::get_metrics`] reports rolling 24-hour usage
//! (streams created, withdrawals, average duration and size, unique users).
//!
//! Both are read-only and cheap enough to poll frequently, which is the whole
//! point of a health endpoint. That is achieved by maintaining counters as
//! operations happen rather than deriving them on read: a read that scanned
//! stream state would get more expensive exactly as the contract got busier.
//! Usage statistics live in hourly buckets, so a read sums at most
//! [`METRICS_WINDOW_HOURS`] entries no matter how much traffic there was, and
//! buckets outside the window are pruned at most once per hour.
//!
//! `unique_users_24h` is the one deliberately approximate figure: it is capped
//! at [`MAX_TRACKED_USERS`] so the address set cannot grow without bound. Above
//! that it saturates, and should be read as "at least this many".
//!
//! See `METRICS.md` for the Prometheus exporter and Grafana setup that consume
//! these two functions.
//! - Configurable protocol fee collected to a treasury on stream creation
//!
//! # Protocol fee
//!
//! Creating a stream charges a protocol fee **on top of** the streamed amount.
//! A stream of 1_000 tokens at 100 bps costs the sender 1_010 tokens: 1_000
//! remain streamable to the receiver and 10 go to the treasury. The stream's
//! `total_amount` is never reduced by the fee, so a receiver is always owed
//! exactly what the stream says.
//!
//! - The rate is stored in basis points, where 10_000 bps is 100%
//!   ([`BPS_DENOMINATOR`]), and is capped at [`MAX_FEE_BPS`] (1_000 bps = 10%).
//!   The cap is enforced on write, so an out-of-range rate can never be
//!   observed by `create_stream`.
//! - The fee is `amount * fee_bps / 10_000`, rounded down, computed with
//!   checked multiplication so a large amount reports [`Error::Overflow`]
//!   instead of wrapping.
//! - A rate of `0` disables collection: no token transfer is attempted and no
//!   treasury is required.
//! - With a non-zero rate and no treasury configured, `create_stream` fails
//!   with [`Error::TreasuryNotSet`] rather than quietly skipping the fee.
//! - Collection and stream creation share one invocation, so they succeed or
//!   fail together. A sender who cannot cover `amount + fee` creates no stream.
//! - [`StellarStreamContract::set_protocol_fee`] and
//!   [`StellarStreamContract::set_treasury_address`] require [`ROLE_TREASURY`]
//!   or [`ROLE_ADMIN`].
//!
//! Streams created by multi-signature proposal execution are not charged: the
//! fee transfer debits the sender, and proposal execution runs under the
//! approvers' authorization rather than the sender's.
//! - Configurable protocol fee collected to a treasury on stream creation
//!
//! # Protocol fees
//!
//! The protocol charges a fee, expressed in basis points, every time a stream
//! is created through [`StellarStreamContract::create_stream`].
//!
//! The fee is charged **on top of** the stream amount, never taken out of it.
//! A 1_000_000-unit stream at 100 bps (1%) leaves the receiver entitled to the
//! full 1_000_000 and moves a further 10_000 to the treasury, so the sender
//! parts with 1_010_000 in total. This keeps `total_amount` a promise to the
//! receiver rather than a number the protocol quietly shaves.
//!
//! Both transfers happen inside one invocation. If the sender cannot cover
//! `amount + fee`, the token transfer traps and the stream creation is rolled
//! back with it — there is no state in which a stream exists but its fee went
//! uncollected.
//!
//! The rate is capped at [`MAX_FEE_BPS`] (10%) at the point it is written, so
//! an out-of-range rate can never reach stream creation. A rate of `0` is
//! valid and short-circuits before any token call. Fee settings are managed by
//! accounts holding [`ROLE_TREASURY`] or [`ROLE_ADMIN`] via
//! [`StellarStreamContract::set_protocol_fee`] and
//! [`StellarStreamContract::set_treasury_address`]; callers can preview the
//! charge with [`StellarStreamContract::calculate_protocol_fee`].
//!
//! Streams created by multi-signature proposal execution are not charged,
//! because that path creates the stream under the approvers' authorization
//! rather than the sender's and so cannot move the sender's tokens.
//!
//! See `contracts/Contract-V1/README.md` for the full specification.
//!
//! # Disputes and arbitration (issue #1471)
//!
//! Either party of a stream may escalate a disagreement by raising a
//! **dispute** with a proposed resolution. While a dispute is open the stream
//! is locked: withdrawals (single and batched), cancellation, pausing,
//! resuming and clawbacks all fail until arbitration concludes, so the
//! balance a resolution acts upon cannot change under the arbitrators' feet.
//!
//! The process:
//!
//! 1. **Raise** — the stream's sender or receiver calls
//!    [`StellarStreamContract::raise_dispute`] with a reason and one of four
//!    [`DisputeResolution`] proposals (`RefundSender`, `PayReceiver`,
//!    `FreezeStream`, `CancelStream`). Only one dispute may be open per
//!    stream; the voting window is [`DISPUTE_VOTING_PERIOD_SECS`].
//! 2. **Vote** — addresses holding [`ROLE_ARBITRATOR`] call
//!    [`StellarStreamContract::vote_on_dispute`], one vote each. Arbitration
//!    authority is deliberately separate from [`ROLE_ADMIN`]: an admin must
//!    grant the role explicitly, and admins gain no implicit vote.
//! 3. **Auto-execute** — as soon as approvals reach the configured threshold
//!    ([`StellarStreamContract::set_arbitration_threshold`], default
//!    [`DEFAULT_ARBITRATION_THRESHOLD`]) the proposed resolution executes
//!    automatically: monetary resolutions settle against the stream's
//!    remaining balance and close it; `FreezeStream` permanently locks the
//!    stream (`Error::StreamFrozen` thereafter); `CancelStream` closes it
//!    like a sender cancellation. A rejection majority instead finalizes the
//!    dispute without executing anything.
//! 4. **Expiry** — if neither side reaches the threshold before the deadline,
//!    votes are refused (`Error::DisputeExpired`) and anyone may call
//!    [`StellarStreamContract::close_expired_dispute`] to lift the lock
//!    without executing anything.
//!
//! Every step emits an event (`dispute/raised`, `dispute/voted`,
//! `dispute/resolved`) so indexers can follow the full lifecycle.

pub mod errors;
pub mod flash_loan;
pub mod math;
pub mod storage;
pub mod clawback;
pub mod compliance;
pub mod oracle;
pub mod math;
pub mod storage;

#[cfg(test)]
mod bench_test;
#[cfg(test)]
mod clawback_test;
#[cfg(test)]
mod compliance_test;
#[cfg(test)]
mod fee_test;
#[cfg(test)]
mod metrics_test;
#[cfg(test)]
mod proposal_test;
#[cfg(test)]
mod security_test;
#[cfg(test)]
mod stress_test;
#[cfg(test)]
mod advanced_test;

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Env, Map,
    String, Symbol, Vec, symbol_short,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const NEXTID: Symbol = symbol_short!("NEXTID");
const ROLES: Symbol = symbol_short!("ROLES");
const RESTRICT: Symbol = symbol_short!("RESTRICT");
const LOCK: Symbol = symbol_short!("LOCK");
const STREAMS: Symbol = symbol_short!("STREAMS");
const USTREAMS: Symbol = symbol_short!("USTREAMS");
const PROPOSALS: Symbol = symbol_short!("PROPOSALS");
const NEXTPROPOSAL: Symbol = symbol_short!("NEXTPROP");
const METADATA: Symbol = symbol_short!("METADATA");

// Stream state
pub const STATE_ACTIVE: u32 = 0;
pub const STATE_PAUSED: u32 = 1;
pub const STATE_CLOSED: u32 = 2;
/// Set only by a `FreezeStream` dispute resolution. A frozen stream rejects
/// every state-changing operation until governance intervenes.
pub const STATE_FROZEN: u32 = 3;

// Vesting curve
pub const CURVE_LINEAR: u32 = 0;
pub const CURVE_EXP: u32 = 1;
pub const CURVE_MILESTONE: u32 = 2;

// Maximum number of streams allowed in a single batch creation call.
pub const MAX_BATCH_SIZE: u32 = 20;

// Roles
pub const ROLE_ADMIN: u32 = 0;
pub const ROLE_PAUSER: u32 = 1;
pub const ROLE_TREASURY: u32 = 2;
/// Arbitrators review disputes and vote on their resolution. Deliberately a
/// separate role from [`ROLE_ADMIN`]: holding the admin key does not confer
/// any arbitration power, and vice versa.
pub const ROLE_ARBITRATOR: u32 = 3;

// Disputes (issue #1471)
/// Approvals needed to auto-execute a proposed resolution when none has been
/// configured explicitly via `set_arbitration_threshold`.
pub const DEFAULT_ARBITRATION_THRESHOLD: u32 = 1;
/// Hard ceiling for the configurable threshold, so a misconfiguration cannot
/// demand an unreachable number of signatures.
pub const MAX_ARBITRATION_THRESHOLD: u32 = 100;
/// Voting window for a dispute: 7 days. Votes after `created_at + period`
/// are rejected, and the dispute may then be closed permissionlessly.
pub const DISPUTE_VOTING_PERIOD_SECS: u64 = 7 * 24 * SECONDS_PER_HOUR;

// Re-export the error enum from the errors module.
pub use errors::Error;
// ---------------------------------------------------------------------------
// Error definitions
// ---------------------------------------------------------------------------
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    InvalidTimeRange = 2,
    InvalidAmount = 3,
    StreamNotFound = 4,
    Unauthorized = 5,
    AlreadyCancelled = 6,
    InsufficientBalance = 7,
    AlreadyPaused = 8,
    NotPaused = 9,
    ContractPaused = 10,
    Reentrancy = 11,
    NotAdmin = 12,
    NotPauser = 13,
    StreamPaused = 14,
    WithdrawTooLarge = 15,
    InvalidCurve = 16,
    InvalidRole = 17,
    StreamIsSoulbound = 21,
    AddressRestricted = 22,
    StreamNotPaused = 26,
    Overflow = 27,
    ProposalNotFound = 28,
    ProposalExpired = 29,
    AlreadyApproved = 30,
    ProposalAlreadyExecuted = 31,
    InvalidApprovalThreshold = 32,
    BatchSizeExceeded = 33,
    StreamEnded = 34,
    MetadataLabelTooLong = 35,
    TooManyTags = 36,
    TagTooLong = 37,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

// Stream metadata for categorization (issue #1466)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamMetadata {
    pub label: String,
    pub tags: Vec<String>,
    pub external_ref: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamMetadataUpdatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Stream {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub withdrawn_amount: i128,
    pub state: u32,
    pub curve_type: u32,
    pub is_soulbound: bool,
    pub paused_duration: u64,
    pub last_paused_at: u64,
}

/// Parameters for a single stream within a `batch_create_streams` call.
///
/// Mirrors the arguments of `create_stream` (minus the shared `sender`, which is
/// passed once for the whole batch). `curve_type` uses the `CURVE_*` constants.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamParams {
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub curve_type: u32,
    pub is_soulbound: bool,
}

/// Point-in-time health of the contract, for liveness checks and alerting.
///
/// Every field is an O(1) read of a counter maintained as streams change, so
/// this is cheap enough to poll frequently.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractHealth {
    /// Whether the contract is globally paused.
    pub is_paused: bool,
    /// Streams that have not been closed.
    pub active_streams: u64,
    /// Value still owed to receivers, per token address.
    pub total_tvl: Map<Address, i128>,
    /// Ledger timestamp of the last state-changing operation.
    pub last_activity_time: u64,
    /// Contract version, see [`CONTRACT_VERSION`].
    pub version: u32,
}

/// Emitted when the contract WASM is upgraded.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractUpgradedEvent {
    /// Version before the upgrade.
    pub old_version: u32,
    /// Version after the upgrade.
    pub new_version: u32,
    /// SHA-256 hash of the new WASM.
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
    /// Timestamp of the upgrade.
    pub timestamp: u64,
}

/// Rolling 24-hour usage statistics.
///
/// Derived from at most [`METRICS_WINDOW_HOURS`] hourly buckets that are
/// updated as operations happen, so reading them never scans stream state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetrics {
    /// Streams created in the last 24 hours.
    pub streams_created_24h: u64,
    /// Withdrawals executed in the last 24 hours.
    pub withdrawals_24h: u64,
    /// Mean duration of streams created in the window, in seconds.
    pub avg_stream_duration: u64,
    /// Mean size of streams created in the window, in token units.
    pub avg_stream_amount: i128,
    /// Distinct addresses seen in the window, capped at [`MAX_TRACKED_USERS`].
    pub unique_users_24h: u64,
}

/// One hour of activity. Buckets outside the window are pruned.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MetricBucket {
    /// Streams created during this hour.
    pub streams_created: u64,
    /// Withdrawals during this hour.
    pub withdrawals: u64,
    /// Sum of created stream durations, for the running average.
    pub duration_sum: u64,
    /// Sum of created stream amounts, for the running average.
    pub amount_sum: i128,
}

/// Emitted when a protocol fee is collected while creating a stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolFeeCollectedEvent {
    /// Stream the fee was charged for.
    pub stream_id: u64,
    /// Account that paid the fee (the stream's sender).
    pub payer: Address,
    /// Treasury the fee was credited to.
    pub treasury: Address,
    /// Token the fee was denominated in (same token as the stream).
    pub token: Address,
    /// Fee actually transferred, in token units.
    pub fee_amount: i128,
    /// Fee rate applied, in basis points.
    pub fee_bps: u32,
}

/// A pending multi-signature stream proposal.
///
/// A proposal holds the parameters of a stream that should be created once a
/// threshold of distinct addresses has approved it. The stream is created
/// automatically (without a separate execute call) the moment the number of
/// approvers reaches `required_approvals`.
#[contracttype]
#[derive(Clone)]
pub struct StreamProposal {
    /// Treasury / source account that will fund the stream.
    pub sender: Address,
    /// Recipient of the stream.
    pub receiver: Address,
    /// Token contract address.
    pub token: Address,
    /// Total stream amount.
    pub total_amount: i128,
    /// Stream start timestamp.
    pub start_time: u64,
    /// Stream end timestamp.
    pub end_time: u64,
    /// Addresses that have approved so far (each may approve only once).
    pub approvers: Vec<Address>,
    /// M-of-N threshold: number of distinct approvals required to execute.
    pub required_approvals: u32,
    /// Timestamp after which the proposal can no longer be approved.
    pub deadline: u64,
    /// Whether the proposal has been executed (stream already created).
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamAction {
    Created,
    Withdrawn(i128),
    Paused,
    Resumed,
    ToppedUp(i128),
    Cancelled,
    /// Stream locked by a `FreezeStream` dispute resolution (issue #1471).
    Frozen,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamEvent {
    pub stream_id: u64,
    pub action: StreamAction,
    pub timestamp: u64,
}

// Minimal token interface used by `withdraw`.
#[contractclient(name = "TokenClient")]
pub trait Token {
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}

// ---------------------------------------------------------------------------
// Dispute resolution types (issue #1471)
//
// A "dispute" lets one party of a stream escalate a disagreement to the
// contract's arbitrator set instead of relying on unilateral sender actions
// (cancel/pause/clawback). See the module-level docs under
// "# Disputes and arbitration" for the full lifecycle.
// ---------------------------------------------------------------------------

/// The outcome an arbitrator set is asked to approve for a disputed stream.
///
/// Monetary amounts are always expressed against the stream's *remaining*
/// balance (`total_amount - withdrawn_amount`) at the time the resolution
/// executes. Because every stream operation is blocked while a dispute is
/// open, that balance cannot change between `raise_dispute` and execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeResolution {
    /// Close the stream and return up to `i128` of the remaining balance to
    /// the sender. StellarStream holds no escrowed funds: unwithdrawn tokens
    /// stay with the sender until each withdrawal pulls them out, so "refund"
    /// is realised by closing the stream and writing off the remainder. The
    /// amount must be `> 0` and `<= remaining`; it is recorded on the event
    /// and validated against the balance.
    RefundSender(i128),
    /// Pay `i128` of the remaining balance to the receiver immediately
    /// (pulled from the sender like any withdrawal), then close the stream.
    /// The amount must be `> 0` and `<= remaining`.
    PayReceiver(i128),
    /// Freeze the stream indefinitely. Every state-changing operation fails
    /// with [`Error::StreamFrozen`] until governance intervenes via a
    /// contract upgrade. Freezing is deliberately irreversible from within
    /// the arbitration flow so a compromised arbitrator cannot thaw a stream.
    FreezeStream,
    /// Close the stream exactly like `cancel_stream`: the unwithdrawn
    /// remainder stays with the sender and can no longer be streamed.
    CancelStream,
}

/// A formal disagreement over a stream, raised by one of its parties and
/// decided by arbitrator vote.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    /// Immutable identifier allocated at raise time.
    pub id: u64,
    pub stream_id: u64,
    /// Party that escalated the dispute; always the stream's sender or
    /// receiver.
    pub raised_by: Address,
    /// Free-form explanation of the disagreement (validated at raise time).
    pub reason: String,
    /// Outcome the raiser proposes; executed automatically once enough
    /// arbitrators approve.
    pub proposed_resolution: DisputeResolution,
    /// One vote per arbitrator address (`true` = approve the proposal).
    pub arbitrator_votes: Map<Address, bool>,
    /// Whether the dispute has been finalized (executed, rejected by
    /// majority, or closed after expiry).
    pub resolved: bool,
    /// Ledger timestamp when the dispute was raised.
    pub created_at: u64,
    /// Ledger timestamp after which votes are refused and anyone may close
    /// the dispute without executing anything.
    pub deadline: u64,
}

/// Published when a party raises a dispute.
/// Topics: `("dispute", "raised")`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRaisedEvent {
    pub dispute_id: u64,
    pub stream_id: u64,
    pub raised_by: Address,
    pub timestamp: u64,
}

/// Published every time an arbitrator casts a vote.
/// Topics: `("dispute", "voted")`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeVotedEvent {
    pub dispute_id: u64,
    pub stream_id: u64,
    pub arbitrator: Address,
    pub approve: bool,
    /// Approvals counted after this vote.
    pub approvals: u32,
    /// Rejections counted after this vote.
    pub rejections: u32,
    /// Threshold required to auto-execute the proposal.
    pub threshold: u32,
    pub timestamp: u64,
}

/// Published when a dispute is finalized: a resolution auto-executed
/// (`executed = true`), the proposal was voted down (`approved = false`), or
/// the voting window lapsed (`expired = true`).
/// Topics: `("dispute", "resolved")`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeResolvedEvent {
    pub dispute_id: u64,
    pub stream_id: u64,
    pub executed: bool,
    pub approved: bool,
    pub expired: bool,
    pub timestamp: u64,
/// Advanced filter for querying streams by various criteria.
///
/// Filters use AND logic: a stream matches only if it passes all specified criteria.
/// Unspecified fields (None) are ignored, allowing partial filtering.
///
/// # Examples
/// - Filter by token: `StreamFilter { token: Some(token_addr), ..Default::default() }`
/// - Filter by status and time: `StreamFilter { state: Some(STATE_ACTIVE), start_time_after: Some(t1), ..Default::default() }`
/// - Filter by amount range: `StreamFilter { min_amount: Some(1000), max_amount: Some(5000), ..Default::default() }`
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamFilter {
    /// Filter by token address. If Some, only return streams using this token.
    pub token: Option<Address>,
    /// Filter by stream state (e.g., STATE_ACTIVE, STATE_PAUSED, STATE_CLOSED).
    pub state: Option<u32>,
    /// Filter by minimum total_amount (inclusive). If Some, only return streams with total_amount >= min_amount.
    pub min_amount: Option<i128>,
    /// Filter by maximum total_amount (inclusive). If Some, only return streams with total_amount <= max_amount.
    pub max_amount: Option<i128>,
    /// Filter by start_time: only return streams with start_time >= start_time_after.
    pub start_time_after: Option<u64>,
    /// Filter by end_time: only return streams with end_time <= end_time_before.
    pub end_time_before: Option<u64>,
}

impl Default for StreamFilter {
    fn default() -> Self {
        StreamFilter {
            token: None,
            state: None,
            min_amount: None,
            max_amount: None,
            start_time_after: None,
            end_time_before: None,
        }
    }
}

/// Configuration for USD-pegged stream creation.
///
/// This struct holds the oracle and slippage parameters needed to convert
/// a USD amount to token amount at stream creation time. The conversion
/// happens once at creation; the stream then vests the calculated token
/// amount normally.
#[contracttype]
#[derive(Clone, Debug)]
pub struct UsdStreamConfig {
    /// The USD amount to stream (in basis points; 10_000 = $1.00).
    pub usd_amount: i128,
    /// Address of the oracle contract providing price feeds.
    pub oracle: Address,
    /// Minimum acceptable token price in USD (basis points).
    /// Protects against unfavorable pricing.
    pub min_price: i128,
    /// Maximum acceptable token price in USD (basis points).
    /// Protects against price spikes.
    pub max_price: i128,
}

/// Event emitted when a USD-pegged stream is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCreatedUsdEvent {
    /// The created stream's ID.
    pub stream_id: u64,
    /// The sender who funded the stream.
    pub sender: Address,
    /// The receiver of the stream.
    pub receiver: Address,
    /// The token being streamed.
    pub token: Address,
    /// The USD amount requested (in basis points).
    pub usd_amount: i128,
    /// The token amount actually created (after oracle conversion).
    pub token_amount: i128,
    /// The oracle price used for conversion (in basis points).
    pub price_usd_bps: i128,
    /// Stream creation timestamp.
    pub timestamp: u64,
}

// Minimal token interface used by `withdraw`.
#[contractclient(name = "TokenClient")]
pub trait Token {
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}
// ---------------------------------------------------------------------------
// Clawback types
// ---------------------------------------------------------------------------

/// Lifecycle state of a clawback request.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClawbackStatus {
    /// Request created, awaiting approval.
    Pending,
    /// Sufficient approvals received; ready for execution.
    Approved,
    /// Tokens transferred back to sender.
    Executed,
    /// Expired or explicitly rejected; cannot progress further.
    Rejected,
}

/// A clawback request: sender asks to recover previously withdrawn tokens.
///
/// Clawback is opt-in — the stream must have been created with
/// `clawback_enabled = true`. The amount cannot exceed `withdrawn_amount`.
///
/// Approval path: either the receiver approves directly, or enough governance
/// addresses accumulate approvals (`approvals.len() >= required_approvals`).
#[contracttype]
#[derive(Clone)]
pub struct ClawbackRequest {
    /// Unique request ID.
    pub clawback_id: u64,
    /// ID of the stream this clawback targets.
    pub stream_id: u64,
    /// Tokens to recover; must be > 0 and ≤ `stream.withdrawn_amount`.
    pub amount: i128,
    /// Human-readable reason for the clawback.
    pub reason: String,
    /// Whether the stream's receiver has approved.
    pub approved_by_receiver: bool,
    /// Governance addresses that have approved (multi-sig path).
    pub approvals: Vec<Address>,
    /// Number of governance approvals required if receiver does not approve.
    pub required_approvals: u32,
    /// Current status.
    pub status: ClawbackStatus,
    /// Ledger timestamp when the request was created.
    pub created_at: u64,
    /// Optional expiry timestamp (`0` = no expiry).
    pub expires_at: u64,
}

/// Emitted when a clawback request is created.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackRequestedEvent {
    pub clawback_id: u64,
    pub stream_id: u64,
    pub sender: Address,
    pub amount: i128,
    pub reason: String,
    pub timestamp: u64,
}

/// Emitted when a clawback request receives an approval.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackApprovedEvent {
    pub clawback_id: u64,
    pub approver: Address,
    pub by_receiver: bool,
    pub approval_count: u32,
    pub timestamp: u64,
}

/// Emitted when an approved clawback is executed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackExecutedEvent {
    pub clawback_id: u64,
    pub stream_id: u64,
    pub amount: i128,
    pub sender: Address,
    pub timestamp: u64,
}
// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    /// Initialize the contract with an admin address. Idempotency guarded.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .is_some()
        {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ContractPaused, &false);
        env.storage().instance().set(&DataKey::StreamCounter, &1u64);
        env.storage().instance().set(&DataKey::ProposalCounter, &1u64);
        env.storage().instance().set(&DataKey::Version, &INITIAL_VERSION);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &1u64);
        grant_role_internal(env.clone(), &admin, ROLE_ADMIN);
        Ok(())
    }

    /// Create a new stream. Returns the newly allocated stream id.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        curve_type: u32,
        is_soulbound: bool,
        clawback_enabled: bool,
        milestones: Option<Vec<Milestone>>,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            total_amount,
            start_time,
            end_time,
            curve_type,
            is_soulbound,
            clawback_enabled,
            milestones,
        )?;
        collect_protocol_fee(&env, &sender, &token, stream_id, total_amount)?;
        Ok(stream_id)
    }

    /// Create a new USD-pegged stream, converting USD amount to tokens via oracle.
    ///
    /// This function queries an oracle for the current token price, validates it
    /// against slippage bounds, converts the USD amount to token amount, and then
    /// creates a regular stream with the calculated token amount.
    ///
    /// # Arguments
    /// - `sender`: The stream creator and funder.
    /// - `receiver`: The stream recipient.
    /// - `token`: The token to stream (price will be queried from oracle).
    /// - `usd_amount`: The USD amount to stream (basis points; 10_000 = $1.00).
    /// - `oracle`: The oracle contract address for price feeds.
    /// - `min_price`: Minimum acceptable token USD price (basis points).
    /// - `max_price`: Maximum acceptable token USD price (basis points).
    /// - `stream_params`: A tuple containing (start_time, end_time, curve_type, is_soulbound, clawback_enabled, milestones).
    ///
    /// # Returns
    /// The ID of the created stream.
    ///
    /// # Slippage Protection
    /// The oracle price is validated to be within [min_price, max_price] (inclusive).
    /// If the price is outside this range, creation fails with [`Error::OraclePriceOutOfBounds`].
    ///
    /// # Events
    /// Emits a [`StreamCreatedUsdEvent`] with details of the USD conversion.
    ///
    /// # Errors
    /// - [`Error::InvalidUsdAmount`]: If USD amount <= 0.
    /// - [`Error::OraclePriceOutOfBounds`]: If oracle price is outside bounds.
    /// - [`Error::OraclePriceInvalid`]: If oracle returns invalid price.
    /// - [`Error::Overflow`]: If token amount calculation overflows.
    /// - Other errors from [`create_stream`].
    pub fn create_stream_usd(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        usd_amount: i128,
        oracle: Address,
        min_price: i128,
        max_price: i128,
        start_time: u64,
        end_time: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);

        // Validate USD amount
        if usd_amount <= 0 {
            return Err(Error::InvalidUsdAmount);
        }

        // Fetch price from oracle with slippage protection
        let price_usd_bps = oracle::fetch_price_with_slippage(
            &env,
            &oracle,
            &token,
            min_price,
            max_price,
        )?;

        // Convert USD amount to token amount
        let token_amount = oracle::usd_to_tokens(usd_amount, price_usd_bps)?;

        if token_amount <= 0 {
            return Err(Error::InvalidUsdAmount);
        }

        // Create the stream with calculated token amount (linear curve, no special features)
        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            token_amount,
            start_time,
            end_time,
            CURVE_LINEAR,
            false,
            false,
            None,
        )?;

        // Collect protocol fee based on token amount
        collect_protocol_fee(&env, &sender, &token, stream_id, token_amount)?;

        // Emit USD creation event
        env.events().publish(
            (symbol_short!("usd_creat"), sender.clone()),
            StreamCreatedUsdEvent {
                stream_id,
                sender,
                receiver,
                token,
                usd_amount,
                token_amount,
                price_usd_bps,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(stream_id)
    }

    /// Create multiple streams atomically in a single transaction for gas efficiency.
    ///
    /// All streams in the batch share the same `sender`, which is authenticated
    /// exactly once. Every parameter is validated before any state is written, so
    /// the operation is all-or-nothing: either the entire batch is created or none
    /// of it is. Returns the newly allocated stream ids in the same order as `params`.
    ///
    /// Compared to calling `create_stream` repeatedly, this saves gas by requiring
    /// a single authentication, a single read/write of the `NEXTID` counter, and a
    /// single read/write of the stream map and user profiles.
    pub fn batch_create_streams(
        env: Env,
        sender: Address,
        params: Vec<StreamParams>,
    ) -> Result<Vec<u64>, Error> {
        sender.require_auth();
        batch_create_streams_internal(&env, &sender, &params)
    }

    /// Create a multi-signature proposal for a stream.
    ///
    /// The stream is not created immediately. Instead a proposal is stored
    /// which becomes a live stream automatically once `required_approvals`
    /// distinct addresses call [`approve_proposal`]. This lets a DAO treasury
    /// or corporate wallet require multiple signatures before committing to a
    /// payment stream.
    ///
    /// Returns the newly allocated proposal id.
    pub fn create_proposal(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        required_approvals: u32,
        deadline: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Admin)
            .is_none()
        {
            return Err(Error::Unauthorized);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if required_approvals == 0 {
            return Err(Error::InvalidApprovalThreshold);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::ProposalExpired);
        }
        if is_restricted(&env, &sender) || is_restricted(&env, &receiver) {
            return Err(Error::AddressRestricted);
        }

        let mut next = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::ProposalCounter)
            .unwrap_or(1);
        let id = next;
        next = next.checked_add(1).ok_or(Error::Overflow)?;

        let proposal = StreamProposal {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token,
            total_amount,
            start_time,
            end_time,
            approvers: Vec::new(&env),
            required_approvals,
            deadline,
            executed: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);
        extend_proposal_ttl(&env, id);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCounter, &next);

        env.events()
            .publish((symbol_short!("proposal"), sender.clone()), id);
        Ok(id)
    }

    /// Approve a pending proposal.
    ///
    /// Each address may approve a given proposal at most once. When the number
    /// of distinct approvers reaches `required_approvals`, the proposal is
    /// marked executed and the underlying stream is created immediately.
    pub fn approve_proposal(env: Env, proposal_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();
        extend_instance_ttl(&env);
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }

        let mut proposal = get_proposal(&env, proposal_id)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.deadline {
            return Err(Error::ProposalExpired);
        }
        if proposal.approvers.contains(approver.clone()) {
            return Err(Error::AlreadyApproved);
        }

        proposal.approvers.push_back(approver.clone());
        env.events()
            .publish((symbol_short!("approval"), approver.clone()), proposal_id);

        if proposal.approvers.len() >= proposal.required_approvals {
            let stream_id = create_stream_internal(
                &env,
                &proposal.sender,
                &proposal.receiver,
                &proposal.token,
                proposal.total_amount,
                proposal.start_time,
                proposal.end_time,
                CURVE_LINEAR,
                false,
                false,
                None,
            )?;
            proposal.executed = true;
            save_proposal(&env, proposal_id, &proposal);
            env.events().publish(
                (symbol_short!("executed"), proposal.sender.clone()),
                stream_id,
            );
        } else {
            save_proposal(&env, proposal_id, &proposal);
        }

        Ok(())
    }

    /// Query a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<StreamProposal, Error> {
        get_proposal(&env, proposal_id)
    }

    /// Withdraw the currently unlocked amount to the receiver.
    /// Returns the amount withdrawn.
    pub fn withdraw(env: Env, stream_id: u64, receiver: Address) -> Result<i128, Error> {
        receiver.require_auth();
        extend_instance_ttl(&env);

        // Re-entrancy guard (temporary storage lock).
        if env
            .storage()
            .temporary()
            .get::<_, bool>(&DataKey::ReentrancyLock)
            .unwrap_or(false)
        {
            return Err(Error::Reentrancy);
        }
        env.storage()
            .temporary()
            .set(&DataKey::ReentrancyLock, &true);

        let result = withdraw_inner(&env, stream_id, &receiver);

        env.storage().temporary().remove(&DataKey::ReentrancyLock);
        result
    }

    /// Cancel a stream. Only the sender may cancel; refunds are implicit because
    /// the receiver can no longer withdraw unlocked funds once the stream is closed.
    pub fn cancel_stream(env: Env, stream_id: u64, sender: Address) -> Result<(), Error> {
        sender.require_auth();
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }

        // Validate borrow amount is positive
        if amount <= 0 {
            return Err(Error::InvalidFlashBorrowAmount);
        }

        // Calculate idle liquidity: total contract balance - TVL
        let tvl: i128 = get_tvl(&env)
            .get(token.clone())
            .unwrap_or(0);

        // Get token contract client to check balance
        let token_client = TokenClient::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());

        // Idle liquidity is balance minus allocated (TVL)
        let idle_liquidity = contract_balance - tvl;
        if idle_liquidity < amount {
            return Err(Error::InsufficientFlashLiquidity);
        }

        // Calculate fee (0.5% default = 50 bps)
        let fee = flash_loan::calculate_flash_loan_fee(amount, 50)
            .map_err(|_| Error::FlashLoanFeeOverflow)?;

        // Set re-entrancy lock for this token
        env.storage()
            .temporary()
            .set(&DataKey::ActiveFlashLoan(token.clone()), &true);

        // Transfer tokens to callback contract
        token_client.transfer(&env.current_contract_address(), &callback_contract, &amount);

        // Emit flash loan event
        env.events().publish(
            (symbol_short!("fl_exec"), borrower.clone()),
            flash_loan::FlashLoanEvent {
                borrower: borrower.clone(),
                token: token.clone(),
                amount,
                fee,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Call the callback contract's execute_flash_loan function
        let callback_result = env.invoke_contract::<Result<(), String>>(
            &callback_contract,
            &symbol_short!("fl_exec"),
            (&token, &amount, &fee, &callback_data),
        );

        if let Err(_) = callback_result {
            env.storage()
                .temporary()
                .remove(&DataKey::ActiveFlashLoan(token));
            return Err(Error::FlashLoanCallbackFailed);
        }

        // Verify repayment: contract must have received at least amount + fee
        let final_balance = token_client.balance(&env.current_contract_address());
        let repaid = final_balance - contract_balance;

        if repaid < amount + fee {
            env.storage()
                .temporary()
                .remove(&DataKey::ActiveFlashLoan(token));
            return Err(Error::InsufficientFlashRepayment);
        }

        // Update TVL with fee (fee goes to protocol, increases available balance)
        // The TVL remains unchanged since we're only borrowing idle tokens
        // Fee is just extra tokens returned beyond the principal

        // Emit repayment event
        env.events().publish(
            (symbol_short!("fl_repay"), borrower),
            flash_loan::FlashLoanRepaymentEvent {
                borrower,
                token: token.clone(),
                amount,
                fee,
                timestamp: env.ledger().timestamp(),
            },
        );

        // Clear re-entrancy lock
        env.storage()
            .temporary()
            .remove(&DataKey::ActiveFlashLoan(token));

        Ok(())
    }

    /// Cancel a stream. Only the sender may cancel; refunds are implicit because
    /// the receiver can no longer withdraw unlocked funds once the stream is closed.
    pub fn cancel_stream(env: Env, stream_id: u64, sender: Address) -> Result<(), Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == STATE_FROZEN {
            return Err(Error::StreamFrozen);
        }
        // Cancellation would moot any pending arbitration outcome.
        require_no_open_dispute(&env, stream_id)?;
        stream.state = STATE_CLOSED;
        save_stream(&env, &stream);
        record_stream_closed(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Cancelled);
        Ok(())
    }

    /// Pause an active stream. Only the sender may pause.
    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        extend_instance_ttl(&env);
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_PAUSED {
            return Err(Error::AlreadyPaused);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == STATE_FROZEN {
            return Err(Error::StreamFrozen);
        }
        // Pausing changes vesting math and would skew a pending resolution.
        require_no_open_dispute(&env, stream_id)?;
        stream.state = STATE_PAUSED;
        stream.last_paused_at = env.ledger().timestamp();
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Paused);
        Ok(())
    }

    /// Resume a paused stream. Only the sender may resume.
    pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        extend_instance_ttl(&env);
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_FROZEN {
            return Err(Error::StreamFrozen);
        }
        // Resuming changes vesting math and would skew a pending resolution.
        require_no_open_dispute(&env, stream_id)?;
        if stream.state != STATE_PAUSED {
            return Err(Error::StreamNotPaused);
        }
        let now = env.ledger().timestamp();
        if stream.last_paused_at > 0 && now > stream.last_paused_at {
            stream.paused_duration = stream
                .paused_duration
                .checked_add(now - stream.last_paused_at)
                .ok_or(Error::Overflow)?;
        }
        stream.state = STATE_ACTIVE;
        stream.last_paused_at = 0;
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Resumed);
        Ok(())
    }

    /// Query a stream by id.
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        get_stream(&env, stream_id)
    }

    /// Query the metadata attached to a stream. Returns `None` when no metadata
    /// has been set for the stream.
    pub fn get_stream_metadata(env: Env, stream_id: u64) -> Option<StreamMetadata> {
        get_metadata(&env).get(stream_id)
    }

    /// Calculate the total unlocked amount for a stream at the current ledger time.
    pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(unlocked_amount(&env, &stream))
    }

    /// Calculate the currently withdrawable amount for a stream.
    pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(withdrawable_amount(&env, &stream))
    }

    pub fn get_time_remaining_seconds(env: Env, stream_id: u64) -> Result<u64, Error> {
        let stream = get_stream(&env, stream_id)?;

        if stream.state == STATE_CLOSED {
            return Ok(0);
        }

        let current_time = env.ledger().timestamp();
        let mut effective_time = current_time;

        if stream.state == STATE_PAUSED {
            effective_time = stream.last_paused_at;
        }

        let adjusted_end = stream.end_time + stream.paused_duration;

        if effective_time >= adjusted_end {
            Ok(0)
        } else {
            Ok(adjusted_end - effective_time)
        }
    }

    pub fn get_time_remaining_days(env: Env, stream_id: u64) -> Result<u64, Error> {
        let seconds = Self::get_time_remaining_seconds(env.clone(), stream_id)?;
        Ok(seconds / 86400)
    }

    pub fn get_completion_percentage(env: Env, stream_id: u64) -> Result<u32, Error> {
        let stream = get_stream(&env, stream_id)?;

        let current_time = env.ledger().timestamp();
        let mut effective_time = current_time;

        if stream.state == STATE_PAUSED {
            effective_time = stream.last_paused_at;
        }

        let adjusted_end = stream.end_time + stream.paused_duration;

        if effective_time >= adjusted_end || stream.state == STATE_CLOSED {
            return Ok(10000);
        }

        if effective_time <= stream.start_time {
            return Ok(0);
        }

        let elapsed = effective_time - stream.start_time;
        let total_duration = adjusted_end - stream.start_time;

        if total_duration == 0 {
            return Ok(10000);
        }

        let percentage = (elapsed as u128 * 10000) / (total_duration as u128);
        Ok(percentage as u32)
    }

    /// Return the list of stream ids associated with a user (as sender or receiver).
    pub fn get_user_streams(env: Env, user: Address) -> Vec<u64> {
        get_user_streams(&env, &user)
    }

    // ------------------------- Monitoring -------------------------

    /// Point-in-time health of the contract.
    ///
    /// Read-only, and O(1) apart from copying the per-token TVL map: every
    /// field is a counter maintained as streams change rather than something
    /// derived by scanning stream state, so this is safe to poll on a short
    /// interval. See `METRICS.md` for the exporter that scrapes it.
    pub fn health_check(env: Env) -> ContractHealth {
        ContractHealth {
            is_paused: is_contract_paused(&env),
            active_streams: env
                .storage()
                .instance()
                .get(&DataKey::ActiveStreams)
                .unwrap_or(0),
            total_tvl: get_tvl(&env),
            last_activity_time: env
                .storage()
                .instance()
                .get(&DataKey::LastActivity)
                .unwrap_or(0),
            version: CONTRACT_VERSION,
        }
    }

    /// Rolling 24-hour usage statistics.
    ///
    /// Read-only. Sums at most [`METRICS_WINDOW_HOURS`] hourly buckets, so cost
    /// is bounded by the width of the window and not by how many streams or
    /// users exist. Averages are over streams *created* in the window and are
    /// zero when the window is empty.
    ///
    /// `unique_users_24h` is capped at [`MAX_TRACKED_USERS`]: once that many
    /// distinct addresses are active within a window the count saturates rather
    /// than growing without bound. Treat it as "at least this many".
    pub fn get_metrics(env: Env) -> ContractMetrics {
        let cutoff = window_start_hour(&env);
        let buckets = get_buckets(&env);

        let mut streams_created_24h: u64 = 0;
        let mut withdrawals_24h: u64 = 0;
        let mut duration_sum: u64 = 0;
        let mut amount_sum: i128 = 0;

        for (hour, bucket) in buckets.iter() {
            if hour < cutoff {
                continue;
            }
            streams_created_24h = streams_created_24h.saturating_add(bucket.streams_created);
            withdrawals_24h = withdrawals_24h.saturating_add(bucket.withdrawals);
            duration_sum = duration_sum.saturating_add(bucket.duration_sum);
            amount_sum = amount_sum.saturating_add(bucket.amount_sum);
        }

        let (avg_stream_duration, avg_stream_amount) = if streams_created_24h == 0 {
            (0, 0)
        } else {
            (
                duration_sum.checked_div(streams_created_24h).unwrap_or(0),
                amount_sum
                    .checked_div(streams_created_24h as i128)
                    .unwrap_or(0),
            )
        };

        let mut unique_users_24h: u64 = 0;
        for (_, last_seen) in get_user_seen(&env).iter() {
            if last_seen >= cutoff {
                unique_users_24h += 1;
            }
        }

        ContractMetrics {
            streams_created_24h,
            withdrawals_24h,
            avg_stream_duration,
            avg_stream_amount,
            unique_users_24h,
        }
    }

    // ------------------------- Protocol fee -------------------------

    /// Set the protocol fee charged on stream creation, in basis points.
    ///
    /// Requires the caller to hold [`ROLE_TREASURY`] or [`ROLE_ADMIN`]. The fee
    /// is capped at [`MAX_FEE_BPS`] (1_000 bps = 10%); anything above that is
    /// rejected with [`Error::FeeTooHigh`] so an out-of-range rate can never
    /// reach `create_stream`. Passing `0` disables fee collection entirely.
    pub fn set_protocol_fee(
        env: Env,
        treasury_manager: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        treasury_manager.require_auth();
        extend_instance_ttl(&env);
        require_treasury_manager(&env, &treasury_manager)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.events()
            .publish((symbol_short!("set_fee"), treasury_manager), fee_bps);
        Ok(())
    }

    /// Set the address protocol fees are paid to.
    ///
    /// Requires the caller to hold [`ROLE_TREASURY`] or [`ROLE_ADMIN`]. While no
    /// treasury is set, any non-zero fee makes `create_stream` fail with
    /// [`Error::TreasuryNotSet`] rather than silently skipping collection.
    pub fn set_treasury_address(
        env: Env,
        treasury_manager: Address,
        new_treasury: Address,
    ) -> Result<(), Error> {
        treasury_manager.require_auth();
        extend_instance_ttl(&env);
        require_treasury_manager(&env, &treasury_manager)?;
        env.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);
        env.events()
            .publish((symbol_short!("set_treas"), treasury_manager), new_treasury);
        Ok(())
    }

    /// Current protocol fee in basis points (`0` when no fee is configured).
    pub fn get_protocol_fee(env: Env) -> u32 {
        fee_bps(&env)
    }

    /// Current treasury address, or `None` if one has never been set.
    pub fn get_treasury_address(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Treasury)
    }

    /// Fee that `create_stream` would charge on top of `amount`.
    ///
    /// Lets a caller work out the total it must be able to cover
    /// (`amount + fee`) before committing to a stream.
    pub fn calculate_protocol_fee(env: Env, amount: i128) -> Result<i128, Error> {
        protocol_fee_for(&env, amount)
    }

    // ------------------------- Administrative -------------------------

    pub fn grant_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        if role > ROLE_ARBITRATOR {
            return Err(Error::InvalidRole);
        }
        grant_role_internal(env, &account, role);
        Ok(())
    }

    pub fn revoke_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        revoke_role_internal(&env, &account, role);
        Ok(())
    }

    pub fn restrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        compliance::restrict_address(&env, &target);
        Ok(())
    }

    pub fn unrestrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        compliance::unrestrict_address(&env, &target);
        Ok(())
    }

    pub fn pause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        extend_instance_ttl(&env);
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage()
            .instance()
            .set(&DataKey::ContractPaused, &true);
        Ok(())
    }

    pub fn unpause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        extend_instance_ttl(&env);
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage()
            .instance()
            .set(&DataKey::ContractPaused, &false);
        Ok(())
    }

    pub fn is_address_restricted(env: Env, target: Address) -> bool {
        is_restricted(&env, &target)
    }

    /// Withdraw from multiple streams atomically. All-or-nothing semantics. (issue #1472)
    pub fn batch_withdraw(
        env: Env,
        stream_ids: Vec<u64>,
        receiver: Address,
    ) -> Result<Vec<i128>, Error> {
        receiver.require_auth();
        extend_instance_ttl(&env);
        if stream_ids.len() > 20 {
            return Err(Error::BatchSizeExceeded);
        }
        if stream_ids.is_empty() {
            return Err(Error::InvalidAmount);
        }

        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut total: i128 = 0;
        for i in 0..stream_ids.len() {
            let sid = stream_ids.get(i).unwrap();
            let stream = get_stream(&env, sid)?;
            if stream.receiver != receiver {
                return Err(Error::Unauthorized);
            }
            if stream.state == STATE_CLOSED {
                return Err(Error::AlreadyCancelled);
            }
            if stream.state == STATE_PAUSED {
                return Err(Error::StreamPaused);
            }
            if stream.state == STATE_FROZEN {
                return Err(Error::StreamFrozen);
            }
            // Fail fast on disputed streams so no partial batch pays out.
            require_no_open_dispute(&env, sid)?;
            let unlocked = unlocked_amount(&env, &stream);
            let w = unlocked - stream.withdrawn_amount;
            if w > 0 {
                amounts.push_back(w);
                total += w;
            } else {
                amounts.push_back(0);
            }
        }
        if total <= 0 {
            return Err(Error::InsufficientBalance);
        }

        for i in 0..stream_ids.len() {
            let amt = amounts.get(i).unwrap();
            if amt > 0 {
                let sid = stream_ids.get(i).unwrap();
                let mut stream = get_stream(&env, sid)?;
                stream.withdrawn_amount += amt;
                save_stream(&env, &stream);
                record_withdrawal(&env, &receiver, &stream.token, amt);
                TokenClient::new(&env, &stream.token).transfer(&stream.sender, &receiver, &amt);
            }
        }
        Ok(amounts)
    }

    /// Update the metadata for a stream. Only the sender may update metadata.
    pub fn update_stream_metadata(
        env: Env,
        stream_id: u64,
        sender: Address,
        label: String,
        tags: Vec<String>,
        external_ref: Option<String>,
    ) -> Result<(), Error> {
        sender.require_auth();
        let stream = get_stream(&env, stream_id)?;
        if stream.sender != sender { return Err(Error::Unauthorized); }
        if stream.state == STATE_CLOSED { return Err(Error::StreamEnded); }
        if label.len() > 64 { return Err(Error::MetadataLabelTooLong); }
        if tags.len() > 5 { return Err(Error::TooManyTags); }
        for i in 0..tags.len() {
            if let Some(tag) = tags.get(i) {
                if tag.len() > 32 {
                    return Err(Error::TagTooLong);
                }
            }
        }
        let mut metadata = get_metadata(&env);
        metadata.set(stream_id, StreamMetadata { label, tags, external_ref });
        env.storage().persistent().set(&METADATA, &metadata);
        env.events().publish(
            (symbol_short!("meta_upd"), sender.clone()),
            StreamMetadataUpdatedEvent {
                stream_id,
                sender,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Return the metadata attached to a stream, if any has been set.
    pub fn get_stream_metadata(env: Env, stream_id: u64) -> Option<StreamMetadata> {
        let key = DataKey::StreamMetadata(stream_id);
        let metadata = env.storage().persistent().get::<_, StreamMetadata>(&key);
        if metadata.is_some() {
            extend_metadata_ttl(&env, stream_id);
        }
        metadata
    }

    /// Return the next stream id that will be allocated (for testing/inspection).
    pub fn next_stream_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get::<_, u64>(&DataKey::StreamCounter)
            .unwrap_or(1)
    }

    // ------------------------- History Queries -------------------------

    pub fn get_stream_history(env: Env, stream_id: u64) -> Vec<StreamEvent> {
        let key = DataKey::StreamHistory(stream_id);
        let history = env.storage().persistent().get::<_, Vec<StreamEvent>>(&key);
        if history.is_some() {
            extend_history_ttl(&env, stream_id);
        }
        history.unwrap_or(Vec::new(&env))
    }

    // ------------------------- Count Queries -------------------------

    pub fn get_active_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_ACTIVE {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_active_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_ACTIVE && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }

    pub fn get_total_streams_count(env: Env) -> u64 {
        let next_id = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::StreamCounter)
            .unwrap_or(1);
        next_id - 1
    }

    pub fn get_user_total_streams_count(env: Env, user: Address) -> u64 {
        get_user_streams(&env, &user).len() as u64
    }

    pub fn get_paused_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_PAUSED {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_paused_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_PAUSED && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }

    pub fn get_closed_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_CLOSED {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_closed_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_CLOSED && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }

    // ===== Advanced Query =====

    /// Query streams with advanced filtering and pagination support.
    ///
    /// # Arguments
    /// - `filter`: A [`StreamFilter`] struct specifying criteria for matching streams.
    ///   All filter fields use AND logic; if a field is None, that filter is skipped.
    /// - `offset`: Number of matching streams to skip (0-indexed pagination).
    /// - `limit`: Maximum number of matching streams to return.
    ///   Capped at 50 to prevent unbounded gas usage.
    ///
    /// # Returns
    /// A vector of [`Stream`] objects matching all specified criteria,
    /// paginated according to `offset` and `limit`.
    ///
    /// # Filter Criteria
    /// - `token`: Only return streams using this token address.
    /// - `state`: Only return streams in this state (e.g., STATE_ACTIVE, STATE_PAUSED, STATE_CLOSED).
    /// - `min_amount` / `max_amount`: Only return streams with total_amount in this range (inclusive).
    /// - `start_time_after`: Only return streams with start_time >= this value.
    /// - `end_time_before`: Only return streams with end_time <= this value.
    ///
    /// # Examples
    /// ```ignore
    /// // Get first 10 active streams
    /// let filter = StreamFilter { state: Some(STATE_ACTIVE), ..Default::default() };
    /// let streams = StellarStreamContract::query_streams(env, filter, 0, 10);
    ///
    /// // Get streams for a specific token in amount range [1000, 5000]
    /// let filter = StreamFilter {
    ///     token: Some(token_addr),
    ///     min_amount: Some(1000),
    ///     max_amount: Some(5000),
    ///     ..Default::default()
    /// };
    /// let streams = StellarStreamContract::query_streams(env, filter, 0, 20);
    /// ```
    ///
    /// # Gas Efficiency
    /// - Limit is capped at 50 results to prevent gas exhaustion.
    /// - All filters are applied in-memory; no storage iteration beyond
    ///   the initial stream enumeration.
    /// - For dashboards expecting larger result sets, use pagination
    ///   with multiple calls.
    pub fn query_streams(
        env: Env,
        filter: StreamFilter,
        offset: u32,
        limit: u32,
    ) -> Vec<Stream> {
        // Cap the limit to prevent unbounded gas usage
        let capped_limit = if limit > 50 { 50 } else { limit };

        // Get all streams
        let all_streams = get_streams(&env);

        let mut matching_streams: Vec<Stream> = Vec::new(&env);

        // Filter and collect matching streams
        for (_, stream) in all_streams.iter() {
            // Apply all filter criteria (AND logic)
            if let Some(ref token_filter) = filter.token {
                if stream.token != *token_filter {
                    continue;
                }
            }

            if let Some(state_filter) = filter.state {
                if stream.state != state_filter {
                    continue;
                }
            }

            if let Some(min_amt) = filter.min_amount {
                if stream.total_amount < min_amt {
                    continue;
                }
            }

            if let Some(max_amt) = filter.max_amount {
                if stream.total_amount > max_amt {
                    continue;
                }
            }

            if let Some(start_after) = filter.start_time_after {
                if stream.start_time < start_after {
                    continue;
                }
            }

            if let Some(end_before) = filter.end_time_before {
                if stream.end_time > end_before {
                    continue;
                }
            }

            // All filters passed; add to results
            matching_streams.push_back(stream);
        }

        // Apply pagination (offset + limit)
        let mut result: Vec<Stream> = Vec::new(&env);

        for i in 0..capped_limit {
            let idx = offset + i;
            if idx < matching_streams.len() as u32 {
                if let Some(s) = matching_streams.get(idx) {
                    result.push_back(s);
                }
            } else {
                break;
            }
        }

        result
    }

    // ===== Clawback entry points =====

    /// Request the return of `amount` tokens already withdrawn from stream `stream_id`.
    ///
    /// The stream must have been created with `clawback_enabled = true`.
    /// `amount` must be > 0 and ≤ `stream.withdrawn_amount`.
    /// Only the stream's sender may call this.
    pub fn request_clawback(
        env: Env,
        stream_id: u64,
        sender: Address,
        amount: i128,
        reason: String,
        required_approvals: u32,
        expires_at: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        clawback::request_clawback(
            &env,
            stream_id,
            &sender,
            amount,
            reason,
            required_approvals,
            expires_at,
        )
    }

    /// Approve a pending clawback request.
    ///
    /// The receiver's approval immediately satisfies the condition.
    /// Any other address counts as a governance approver toward `required_approvals`.
    pub fn approve_clawback(env: Env, clawback_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();
        extend_instance_ttl(&env);
        clawback::approve_clawback(&env, clawback_id, &approver)
    }

fn get_metadata(env: &Env) -> Map<u64, StreamMetadata> {
    env.storage()
        .persistent()
        .get(&METADATA)
        .unwrap_or(Map::new(env))
}

fn get_stream(env: &Env, stream_id: u64) -> Result<Stream, Error> {
    get_streams(env)
        .get(stream_id)
        .ok_or(Error::StreamNotFound)
}

    /// Fetch a clawback request by ID. Returns `None` if it does not exist.
    pub fn get_clawback_request(env: Env, clawback_id: u64) -> Option<ClawbackRequest> {
        clawback::get_clawback_request(&env, clawback_id)
    }

    // ===== Upgrade entry points =====

    /// Upgrade the contract WASM to a new version.
    ///
    /// Requires the caller to hold [`ROLE_ADMIN`]. Replaces the running
    /// bytecode atomically via [`env.deployer().update_current_contract_wasm`],
    /// increments the version counter in instance storage, and emits a
    /// [`ContractUpgradedEvent`].
    ///
    /// Instance storage (streams, proposals, metrics, roles, etc.) persists
    /// automatically across upgrades because Soroban instance storage is
    /// keyed by contract address, not by WASM hash.
    ///
    /// # Arguments
    /// * `admin` — must hold the Admin role and have authorized this call.
    /// * `new_wasm_hash` — SHA-256 hash of the compiled WASM to deploy.
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    // ===== Recurring stream entry points =====

    /// Create a recurring stream that auto-renews after each period.
    ///
    /// Transfers `amount_per_period` from `sender` and creates the first
    /// period's stream. When the sender fully withdraws from the completed
    /// stream, the contract automatically creates the next period's stream
    /// (up to `max_occurrences`, or infinitely if `max_occurrences == 0`).
    ///
    /// Returns the newly allocated stream id of the first period.
    pub fn create_recurring_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount_per_period: i128,
        period_duration: u64,
        max_occurrences: u32,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);

        if amount_per_period <= 0 {
            return Err(Error::InvalidAmount);
        }
        if period_duration == 0 {
            return Err(Error::InvalidTimeRange);
        }

        let now = env.ledger().timestamp();
        let end_time = now + period_duration;

        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            amount_per_period,
            now,
            end_time,
            CURVE_LINEAR,
            false,
            false,
            None,
        )?;

        // Mark the stream as recurring and attach config.
        let mut stream = get_stream(&env, stream_id)?;
        stream.is_recurring = true;
        stream.recurrence_config = Some(RecurrenceConfig {
            enabled: true,
            max_occurrences,
            occurrences_completed: 0,
            period_duration,
            amount_per_period,
            current_period_start: now,
            current_period_end: end_time,
            stopped: false,
        });
        save_stream(&env, &stream);

        collect_protocol_fee(&env, &sender, &token, stream_id, amount_per_period)?;

        env.events().publish(
            (symbol_short!("rec_stream"), sender.clone()),
            stream_id,
        );
        Ok(stream_id)
    }

    /// Stop a recurring stream from auto-renewing.
    ///
    /// Only the stream's sender may call this. The current period's stream
    /// continues to function normally; only future renewals are suppressed.
    pub fn stop_recurring_stream(
        env: Env,
        stream_id: u64,
        sender: Address,
    ) -> Result<(), Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }
        if !stream.is_recurring {
            return Err(Error::RecurrenceNotEnabled);
        }
        let mut config = stream.recurrence_config.ok_or(Error::RecurrenceNotEnabled)?;
        if config.stopped {
            return Err(Error::AlreadyCancelled);
        }
        config.stopped = true;
        config.enabled = false;
        stream.recurrence_config = Some(config);
        save_stream(&env, &stream);

        env.events().publish(
            (symbol_short!("rec_stop"), sender.clone()),
            RecurringStreamStoppedEvent {
                stream_id,
                stopped_by: sender,
                timestamp: env.ledger().timestamp(),
    // ===================== Dispute resolution (issue #1471) =====================
    //
    // Lifecycle:
    //   1. The stream's sender or receiver calls `raise_dispute`, which locks
    //      every stream operation until the dispute is finalized.
    //   2. Arbitrators (`ROLE_ARBITRATOR`) call `vote_on_dispute`.
    //   3. When approvals reach the configured threshold the proposed
    //      resolution executes automatically; when rejections reach it the
    //      proposal is voted down; when neither happens before the deadline,
    //      anyone may call `close_expired_dispute`.

    /// Grant the arbitrator role to `arbitrator`. Admin only.
    ///
    /// Arbitration authority is intentionally decoupled from administration:
    /// an admin must explicitly grant [`ROLE_ARBITRATOR`] before an address
    /// can vote, and granting admin rights never implies arbitration power.
    pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        grant_role_internal(env, &arbitrator, ROLE_ARBITRATOR);
        Ok(())
    }

    /// Revoke the arbitrator role from `arbitrator`. Admin only.
    ///
    /// Revocation takes effect immediately: a revoked arbitrator can no longer
    /// cast votes (already-recorded votes stay counted).
    pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;
        revoke_role_internal(&env, &arbitrator, ROLE_ARBITRATOR);
        Ok(())
    }

    /// List all current arbitrators.
    ///
    /// Derived from the authoritative role assignments (`Roles` storage), so
    /// it always agrees with `is_arbitrator` and can never drift from the
    /// grants made through `grant_role`.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        arbitrator_roster(&env)
    }

    /// Whether `who` currently holds the arbitrator role.
    pub fn is_arbitrator(env: Env, who: Address) -> bool {
        has_role(&env, &who, ROLE_ARBITRATOR)
    }

    /// Set how many approval votes are required to auto-execute a proposed
    /// resolution. Admin only.
    ///
    /// Must be between 1 and [`MAX_ARBITRATION_THRESHOLD`]. Note that a
    /// threshold above the number of sitting arbitrators makes auto-execution
    /// unreachable; such disputes end via rejection majority or expiry.
    pub fn set_arbitration_threshold(
        env: Env,
        admin: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        require_admin(&env, &admin)?;

        let old_version: u32 = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::Version)
            .unwrap_or(INITIAL_VERSION);

        // Perform the atomic WASM upgrade.
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        let new_version = old_version + 1;
        env.storage().instance().set(&DataKey::Version, &new_version);

        env.events().publish(
            (symbol_short!("upgrade"), admin.clone()),
            ContractUpgradedEvent {
                old_version,
                new_version,
                new_wasm_hash,
                timestamp: env.ledger().timestamp(),
        if threshold == 0 || threshold > MAX_ARBITRATION_THRESHOLD {
            return Err(Error::InvalidApprovalThreshold);
        }
        env.storage()
            .instance()
            .set(&DataKey::DisputeThreshold, &threshold);
        Ok(())
    }

    /// Approvals required to auto-execute a resolution (default
    /// [`DEFAULT_ARBITRATION_THRESHOLD`]).
    pub fn get_arbitration_threshold(env: Env) -> u32 {
        arbitration_threshold(&env)
    }

    /// Raise a dispute on `stream_id`. Only the stream's sender or receiver
    /// may raise, and only one dispute may be open per stream.
    ///
    /// Raising a dispute **blocks** withdrawals, batched withdrawals,
    /// cancellation, pause/resume and clawbacks on the stream until the
    /// dispute is resolved or expires, so the balance a resolution will act
    /// upon is frozen for the whole voting window.
    ///
    /// Returns the newly allocated dispute id.
    pub fn raise_dispute(
        env: Env,
        stream_id: u64,
        caller: Address,
        reason: String,
        proposed_resolution: DisputeResolution,
    ) -> Result<u64, Error> {
        caller.require_auth();
        extend_instance_ttl(&env);

        let stream = get_stream(&env, stream_id)?;
        if stream.sender != caller && stream.receiver != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::StreamEnded);
        }
        if active_dispute_id(&env, stream_id).is_some() {
            return Err(Error::DisputeAlreadyOpen);
        }
        validate_resolution_amount(&env, &stream, &proposed_resolution)?;
        compliance::require_not_restricted(&env, &caller);

        let now = env.ledger().timestamp();
        let deadline = now
            .checked_add(DISPUTE_VOTING_PERIOD_SECS)
            .ok_or(Error::Overflow)?;

        let dispute_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DisputeCounter)
            .unwrap_or(0);
        let next = dispute_id.checked_add(1).ok_or(Error::Overflow)?;

        let dispute = Dispute {
            id: dispute_id,
            stream_id,
            raised_by: caller.clone(),
            reason,
            proposed_resolution,
            arbitrator_votes: Map::new(&env),
            resolved: false,
            created_at: now,
            deadline,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(dispute_id), &dispute);
        extend_dispute_ttl(&env, dispute_id);
        env.storage()
            .instance()
            .set(&DataKey::DisputeCounter, &next);
        env.storage()
            .persistent()
            .set(&DataKey::ActiveDispute(stream_id), &dispute_id);
        storage::extend_active_dispute_ttl_if_present(&env, stream_id);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("raised")),
            DisputeRaisedEvent {
                dispute_id,
                stream_id,
                raised_by: caller,
                timestamp: now,
            },
        );
        Ok(dispute_id)
    }

    /// Cast an arbitrator's vote on `dispute_id`.
    ///
    /// Only addresses holding [`ROLE_ARBITRATOR`] may vote, one vote each.
    /// When either side reaches the configured threshold the dispute is
    /// finalized immediately: on approval majority the proposed resolution is
    /// executed automatically, on rejection majority the stream is released
    /// unchanged.
    pub fn vote_on_dispute(
        env: Env,
        dispute_id: u64,
        arbitrator: Address,
        approve: bool,
    ) -> Result<(), Error> {
        arbitrator.require_auth();
        extend_instance_ttl(&env);

        if !has_role(&env, &arbitrator, ROLE_ARBITRATOR) {
            return Err(Error::NotArbitrator);
        }

        let mut dispute = get_dispute_internal(&env, dispute_id)?;
        if dispute.resolved {
            return Err(Error::DisputeNotOpen);
        }
        let now = env.ledger().timestamp();
        if now > dispute.deadline {
            return Err(Error::DisputeExpired);
        }
        if dispute.arbitrator_votes.contains_key(arbitrator.clone()) {
            return Err(Error::AlreadyVoted);
        }

        dispute.arbitrator_votes.set(arbitrator.clone(), approve);
        let threshold = arbitration_threshold(&env);
        let (approvals, rejections) = count_votes(&env, &dispute.arbitrator_votes);

        // Checks-effects-interactions: persist the finalized dispute state
        // BEFORE executing the resolution so a failing external transfer can
        // neither leave the vote unrecorded nor double-execute later.
        if approvals >= threshold {
            finalize_dispute(&env, &mut dispute, true, false)?;
        } else if rejections >= threshold {
            finalize_dispute(&env, &mut dispute, false, false)?;
        } else {
            save_dispute(&env, &dispute);
        }

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("voted")),
            DisputeVotedEvent {
                dispute_id,
                stream_id: dispute.stream_id,
                arbitrator,
                approve,
                approvals,
                rejections,
                threshold,
                timestamp: now,
            },
        );
        Ok(())
    }

    /// Return the current contract version from instance storage.
    ///
    /// Returns [`INITIAL_VERSION`] (1) for the original deployment, and
    /// increments by 1 each time [`upgrade`] is called successfully.
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::Version)
            .unwrap_or(INITIAL_VERSION)
    /// Return the recurrence configuration for a stream, if any.
    pub fn get_recurrence_config(
        env: Env,
        stream_id: u64,
    ) -> Option<RecurrenceConfig> {
        let stream = get_stream(&env, stream_id).ok()?;
        stream.recurrence_config
    /// Close a dispute whose voting window has lapsed without reaching any
    /// threshold. Permissionless: anyone may trigger it.
    ///
    /// Nothing is executed; the stream simply becomes operable again.
    pub fn close_expired_dispute(env: Env, dispute_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        let mut dispute = get_dispute_internal(&env, dispute_id)?;
        if dispute.resolved {
            return Err(Error::DisputeNotOpen);
        }
        if env.ledger().timestamp() <= dispute.deadline {
            return Err(Error::DisputeNotOpen);
        }
        finalize_dispute(&env, &mut dispute, false, true)?;
        Ok(())
    }

    /// Fetch a dispute by id.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, Error> {
        get_dispute_internal(&env, dispute_id)
    }

    /// Id of the dispute currently open against `stream_id`, if any.
    pub fn get_active_dispute_id(env: Env, stream_id: u64) -> Option<u64> {
        active_dispute_id(&env, stream_id)
    }

    /// Convenience check: does this stream have an open dispute?
    pub fn has_active_dispute(env: Env, stream_id: u64) -> bool {
        active_dispute_id(&env, stream_id).is_some()
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
fn withdraw_inner(env: &Env, stream_id: u64, receiver: &Address) -> Result<i128, Error> {
    let mut stream = get_stream(env, stream_id)?;
    if stream.state == STATE_CLOSED {
        return Err(Error::AlreadyCancelled);
    }
    if stream.state == STATE_PAUSED {
        return Err(Error::StreamPaused);
    }
    if stream.state == STATE_FROZEN {
        return Err(Error::StreamFrozen);
    }
    // An open arbitration locks the balance it will act upon.
    require_no_open_dispute(env, stream_id)?;
    if &stream.receiver != receiver {
        return Err(Error::Unauthorized);
    }
    // OFAC compliance: block withdrawals to restricted receivers.
    compliance::require_not_restricted(env, receiver);

    let withdrawable = withdrawable_amount(env, &stream);
    if withdrawable <= 0 {
        return Ok(0);
    }

    // Checks-effects-interactions: mutate state BEFORE any external call so a
    // re-entrant token callback cannot double-spend.
    stream.withdrawn_amount = stream
        .withdrawn_amount
        .checked_add(withdrawable)
        .ok_or(Error::Overflow)?;
    save_stream(env, &stream);
    record_withdrawal(env, receiver, &stream.token, withdrawable);

    // External token transfer (best-effort; a malicious token cannot double-spend
    // because state above is already committed).
    TokenClient::new(env, &stream.token).transfer(&stream.sender, receiver, &withdrawable);

    // Record history event
    add_history(env, stream_id, StreamAction::Withdrawn(withdrawable));

    // Auto-renew recurring stream if the period is fully withdrawn.
    if stream.is_recurring {
        let reloaded = get_stream(env, stream_id)?;
        if let Some(ref config) = reloaded.recurrence_config {
            if config.enabled && !config.stopped {
                let total = reloaded.total_amount;
                if reloaded.withdrawn_amount >= total {
                    // Period fully withdrawn — attempt renewal (best-effort).
                    let _ = try_renew_recurring_stream(env, &reloaded);
                }
            }
        }
    }

    Ok(withdrawable)
}

/// Attempt to create the next period's stream for a recurring series.
///
/// Called after the sender fully withdraws from a completed recurring
/// stream. Checks balance, enforces max occurrences, and creates a new
/// stream linked via [`DataKey::RecurringChildStreamId`].
fn try_renew_recurring_stream(env: &Env, stream: &Stream) -> Result<u64, Error> {
    let mut config = stream.recurrence_config.as_ref().ok_or(Error::RecurrenceNotEnabled)?.clone();

    if !config.enabled || config.stopped {
        return Err(Error::RecurrenceNotEnabled);
    }

    // Check max occurrences.
    if config.max_occurrences > 0 && config.occurrences_completed >= config.max_occurrences {
        return Err(Error::MaxOccurrencesReached);
    }

    let new_start = config.current_period_end;
    let new_end = new_start + config.period_duration;

    // Check contract has enough tokens for the next period.
    let token_client = TokenClient::new(env, &stream.token);
    let balance = token_client.balance(&env.current_contract_address());
    if balance < config.amount_per_period {
        return Err(Error::InsufficientRenewalBalance);
    }

    // Create the next child stream.
    let child_id = create_stream_internal(
        env,
        &stream.sender,
        &stream.receiver,
        &stream.token,
        config.amount_per_period,
        new_start,
        new_end,
        CURVE_LINEAR,
        false,
        false,
        None,
    )?;

    // Update the parent's recurrence config.
    config.occurrences_completed += 1;
    config.current_period_start = new_start;
    config.current_period_end = new_end;

    // If max occurrences reached after this renewal, disable further renewals.
    if config.max_occurrences > 0 && config.occurrences_completed >= config.max_occurrences {
        config.enabled = false;
    }

    let mut updated_stream = get_stream(env, stream.id)?;
    updated_stream.recurrence_config = Some(config);
    save_stream(env, &updated_stream);

    // Link the child to the parent.
    env.storage().persistent().set(
        &DataKey::RecurringChildStreamId(stream.id),
        &child_id,
    );

    env.events().publish(
        (symbol_short!("rec_renew"), stream.sender.clone()),
        RecurringStreamRenewedEvent {
            parent_stream_id: stream.id,
            child_stream_id: child_id,
            occurrences_completed: updated_stream.recurrence_config.as_ref().unwrap().occurrences_completed,
            timestamp: env.ledger().timestamp(),
        },
    );

    Ok(child_id)
}

fn unlocked_amount(env: &Env, stream: &Stream) -> i128 {
    let now = env.ledger().timestamp();
    if now <= stream.start_time {
        return 0;
    }
    let dur = stream.end_time - stream.start_time;
    let mut elapsed = now - stream.start_time;
    if elapsed > stream.paused_duration {
        elapsed -= stream.paused_duration;
    } else {
        elapsed = 0;
    }
    if elapsed >= dur || now >= stream.end_time {
        return stream.total_amount;
    }
    if stream.total_amount == 0 {
        return 0;
    }
    let unlocked = match stream.curve_type {
        CURVE_LINEAR => {
            let prod = (elapsed as i128).checked_mul(stream.total_amount);
            match prod {
                Some(p) => p / (dur as i128),
                None => return 0,
            }
        }
        CURVE_EXP => math::calculate_unlocked_exponential(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            now,
            stream.paused_duration,
        ),
        CURVE_MILESTONE => match &stream.milestones {
            // Milestones are keyed to absolute ledger timestamps, not
            // pause-adjusted elapsed time, so `now` is passed directly.
            Some(milestones) => {
                math::calculate_unlocked_milestone(stream.total_amount, now, milestones)
            }
            None => 0,
        },
        _ => 0,
    };
    if unlocked < 0 {
        0
    } else {
        unlocked
    }
}

fn withdrawable_amount(env: &Env, stream: &Stream) -> i128 {
    let unlocked = unlocked_amount(env, stream);
    let w = unlocked - stream.withdrawn_amount;
    if w < 0 {
        0
    } else {
        w
    }
}

/// Reconstruct the full stream map by reading every allocated stream id.
///
/// Used by the bulk count queries; targeted access should prefer
/// [`get_stream`] / [`save_stream`], which read or write a single entry and
/// extend that entry's TTL.
fn get_streams(env: &Env) -> Map<u64, Stream> {
    let mut streams = Map::new(env);
    let next = env
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::StreamCounter)
        .unwrap_or(1);
    for id in 1..next {
        if let Some(stream) = env
            .storage()
            .persistent()
            .get::<_, Stream>(&DataKey::Stream(id))
        {
            streams.set(id, stream);
        }
    }
    streams
}

fn get_stream(env: &Env, stream_id: u64) -> Result<Stream, Error> {
    let key = DataKey::Stream(stream_id);
    let stream = env
        .storage()
        .persistent()
        .get::<_, Stream>(&key)
        .ok_or(Error::StreamNotFound)?;
    // Long-term data: keep the entry alive whenever it is accessed.
    extend_stream_ttl(env, stream_id);
    Ok(stream)
}

fn save_stream(env: &Env, stream: &Stream) {
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream.id), stream);
    extend_stream_ttl(env, stream.id);
}

/// Shared stream-creation path used both by `create_stream` (single-signature)
/// and by `approve_proposal` (multi-signature auto-execution). Does not require
/// the sender's auth because proposal execution is authorized by the approvals.
fn create_stream_internal(
    env: &Env,
    sender: &Address,
    receiver: &Address,
    token: &Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: u32,
    is_soulbound: bool,
    clawback_enabled: bool,
    milestones: Option<Vec<Milestone>>,
) -> Result<u64, Error> {
    if is_contract_paused(env) {
        return Err(Error::ContractPaused);
    }
    if env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Admin)
        .is_none()
    {
        return Err(Error::Unauthorized);
    }
    if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP && curve_type != CURVE_MILESTONE {
        return Err(Error::InvalidCurve);
    }
    if total_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if start_time >= end_time {
        return Err(Error::InvalidTimeRange);
    }
    if is_restricted(env, sender) || is_restricted(env, receiver) {
        return Err(Error::AddressRestricted);
    }
    if curve_type == CURVE_MILESTONE {
        validate_milestones(&milestones, end_time)?;
    } else if milestones.is_some() {
        return Err(Error::InvalidMilestones);
    }

    let mut next = env
        .storage()
        .instance()
        .get::<_, u64>(&DataKey::StreamCounter)
        .unwrap_or(1);
    let id = next;
    next = next.checked_add(1).ok_or(Error::Overflow)?;

    let stream = Stream {
        id,
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount,
        start_time,
        end_time,
        withdrawn_amount: 0,
        state: STATE_ACTIVE,
        curve_type,
        is_soulbound,
        paused_duration: 0,
        last_paused_at: 0,
        milestones,
        clawback_enabled,
        is_recurring: false,
        recurrence_config: None,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Stream(id), &stream);
    extend_stream_ttl(env, id);

    record_stream_created(env, &stream);

    add_user_stream(env, sender, id);
    add_user_stream(env, receiver, id);

    env.storage().instance().set(&DataKey::StreamCounter, &next);

    // Record the stream's creation in its history.
    add_history(env, id, StreamAction::Created);
    Ok(id)
}

/// Shared batch-creation path for `batch_create_streams`.
///
/// Validates the entire batch up-front (before any state mutation) and then
/// persists every stream in a single pass. Returns the allocated ids in order.
fn batch_create_streams_internal(
    env: &Env,
    sender: &Address,
    params: &Vec<StreamParams>,
) -> Result<Vec<u64>, Error> {
    if params.is_empty() {
        return Err(Error::InvalidAmount);
    }
    if params.len() > MAX_BATCH_SIZE {
        return Err(Error::BatchSizeExceeded);
    }
    if is_contract_paused(env) {
        return Err(Error::ContractPaused);
    }
    if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
        return Err(Error::Unauthorized);
    }

    // Validate every parameter and accumulate the combined total (overflow guard)
    // BEFORE mutating any state, so a single bad entry rolls back the whole batch.
    let mut total: i128 = 0;
    for i in 0..params.len() {
        let p = params.get(i).unwrap();
        if p.curve_type != CURVE_LINEAR && p.curve_type != CURVE_EXP {
            return Err(Error::InvalidCurve);
        }
        if p.total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if p.start_time >= p.end_time {
            return Err(Error::InvalidTimeRange);
        }
        if is_restricted(env, sender) || is_restricted(env, &p.receiver) {
            return Err(Error::AddressRestricted);
        }
        total = total.checked_add(p.total_amount).ok_or(Error::Overflow)?;
    }

    // Allocate ids and build the streams in one pass, then persist once.
    let mut next = env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1);
    let mut ids: Vec<u64> = Vec::new(env);
    let mut streams = get_streams(env);

    for i in 0..params.len() {
        let p = params.get(i).unwrap();
        let id = next;
        next = next.checked_add(1).ok_or(Error::Overflow)?;

        let stream = Stream {
            id,
            sender: sender.clone(),
            receiver: p.receiver.clone(),
            token: p.token.clone(),
            total_amount: p.total_amount,
            start_time: p.start_time,
            end_time: p.end_time,
            withdrawn_amount: 0,
            state: STATE_ACTIVE,
            curve_type: p.curve_type,
            is_soulbound: p.is_soulbound,
            paused_duration: 0,
            last_paused_at: 0,
        };
        streams.set(id, stream);
        ids.push_back(id);
    }
    env.storage().persistent().set(&STREAMS, &streams);

    // Update sender + receiver profiles in a single read/write of the map.
    let mut profiles: Map<Address, Vec<u64>> = env
        .storage()
        .persistent()
        .get(&USTREAMS)
        .unwrap_or(Map::new(env));
    for i in 0..params.len() {
        let id = ids.get(i).unwrap();
        push_stream_id(env, &mut profiles, sender, id);
        let p = params.get(i).unwrap();
        push_stream_id(env, &mut profiles, &p.receiver, id);
    }
    env.storage().persistent().set(&USTREAMS, &profiles);

    env.storage().instance().set(&NEXTID, &next);
    Ok(ids)
}

/// Append `id` to `user`'s stream list inside the in-memory profiles map.
fn push_stream_id(env: &Env, profiles: &mut Map<Address, Vec<u64>>, user: &Address, id: u64) {
    let mut list = profiles.get(user.clone()).unwrap_or(Vec::new(env));
    list.push_back(id);
    profiles.set(user.clone(), list);
}

fn get_proposal(env: &Env, proposal_id: u64) -> Result<StreamProposal, Error> {
    let key = DataKey::Proposal(proposal_id);
    let proposal = env
        .storage()
        .persistent()
        .get::<_, StreamProposal>(&key)
        .ok_or(Error::ProposalNotFound)?;
    extend_proposal_ttl(env, proposal_id);
    Ok(proposal)
}

fn save_proposal(env: &Env, proposal_id: u64, proposal: &StreamProposal) {
    env.storage()
        .persistent()
        .set(&DataKey::Proposal(proposal_id), proposal);
    extend_proposal_ttl(env, proposal_id);
}

fn get_user_streams(env: &Env, user: &Address) -> Vec<u64> {
    let key = DataKey::UserStreams(user.clone());
    let streams = env.storage().persistent().get::<_, Vec<u64>>(&key);
    if streams.is_some() {
        extend_user_streams_ttl(env, user);
    }
    streams.unwrap_or(Vec::new(env))
}

fn add_user_stream(env: &Env, user: &Address, id: u64) {
    let key = DataKey::UserStreams(user.clone());
    let mut list = env
        .storage()
        .persistent()
        .get::<_, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));
    list.push_back(id);
    env.storage().persistent().set(&key, &list);
    extend_user_streams_ttl(env, user);
}

// ---------------------------------------------------------------------------
// Monitoring bookkeeping
//
// Counters are maintained as operations happen so that `health_check` and
// `get_metrics` stay read-only and cheap. The alternative -- deriving them by
// scanning stream state on read -- would make the read cost grow with the size
// of the contract, which is exactly what a frequently polled health endpoint
// must not do.
// ---------------------------------------------------------------------------

/// The oldest hour still inside the rolling window.
fn window_start_hour(env: &Env) -> u64 {
    current_hour(env).saturating_sub(METRICS_WINDOW_HOURS - 1)
}

fn current_hour(env: &Env) -> u64 {
    env.ledger().timestamp() / SECONDS_PER_HOUR
}

fn get_buckets(env: &Env) -> Map<u64, MetricBucket> {
    let buckets = env
        .storage()
        .persistent()
        .get::<_, Map<u64, MetricBucket>>(&DataKey::MetricBuckets);
    if buckets.is_some() {
        bump_persistent_ttl_if_present(env, &DataKey::MetricBuckets);
    }
    buckets.unwrap_or(Map::new(env))
}

fn get_user_seen(env: &Env) -> Map<Address, u64> {
    let seen = env
        .storage()
        .persistent()
        .get::<_, Map<Address, u64>>(&DataKey::UserSeen);
    if seen.is_some() {
        bump_persistent_ttl_if_present(env, &DataKey::UserSeen);
    }
    seen.unwrap_or(Map::new(env))
}

fn get_tvl(env: &Env) -> Map<Address, i128> {
    env.storage()
        .instance()
        .get(&DataKey::TotalTvl)
        .unwrap_or(Map::new(env))
}

/// Record that something happened, and fold `user` into the 24h active set.
fn touch_activity(env: &Env, user: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::LastActivity, &env.ledger().timestamp());
    prune_window(env);

    let hour = current_hour(env);
    let mut seen = get_user_seen(env);
    // Refreshing an address already tracked is always allowed; only admitting a
    // new one is capped, so a busy contract keeps reporting its regulars.
    if seen.get(user.clone()).is_some() || seen.len() < MAX_TRACKED_USERS {
        seen.set(user.clone(), hour);
        env.storage().persistent().set(&DataKey::UserSeen, &seen);
        bump_persistent_ttl_if_present(env, &DataKey::UserSeen);
    }
}

/// Drop buckets and address entries that have fallen out of the window.
///
/// Runs at most once per hour: the scan is bounded, but there is no reason to
/// repeat it on every operation within the same hour.
fn prune_window(env: &Env) {
    let hour = current_hour(env);
    let last_prune: Option<u64> = env.storage().instance().get(&DataKey::LastPrune);
    if last_prune == Some(hour) {
        return;
    }
    env.storage().instance().set(&DataKey::LastPrune, &hour);

    let cutoff = window_start_hour(env);

    let buckets = get_buckets(env);
    let mut fresh_buckets = Map::new(env);
    for (bucket_hour, bucket) in buckets.iter() {
        if bucket_hour >= cutoff {
            fresh_buckets.set(bucket_hour, bucket);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::MetricBuckets, &fresh_buckets);
    bump_persistent_ttl_if_present(env, &DataKey::MetricBuckets);

    let seen = get_user_seen(env);
    let mut fresh_seen = Map::new(env);
    for (address, last_seen) in seen.iter() {
        if last_seen >= cutoff {
            fresh_seen.set(address, last_seen);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::UserSeen, &fresh_seen);
    bump_persistent_ttl_if_present(env, &DataKey::UserSeen);
}

fn with_current_bucket(env: &Env, update: impl FnOnce(&mut MetricBucket)) {
    let hour = current_hour(env);
    let mut buckets = get_buckets(env);
    let mut bucket = buckets.get(hour).unwrap_or(MetricBucket {
        streams_created: 0,
        withdrawals: 0,
        duration_sum: 0,
        amount_sum: 0,
    });
    update(&mut bucket);
    buckets.set(hour, bucket);
    env.storage()
        .persistent()
        .set(&DataKey::MetricBuckets, &buckets);
    bump_persistent_ttl_if_present(env, &DataKey::MetricBuckets);
}

/// Fold a stream creation into the counters.
fn record_stream_created(env: &Env, stream: &Stream) {
    touch_activity(env, &stream.sender);

    let active: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ActiveStreams)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::ActiveStreams, &active.saturating_add(1));

    adjust_tvl(env, &stream.token, stream.total_amount);

    let duration = stream.end_time.saturating_sub(stream.start_time);
    let amount = stream.total_amount;
    with_current_bucket(env, |bucket| {
        bucket.streams_created = bucket.streams_created.saturating_add(1);
        bucket.duration_sum = bucket.duration_sum.saturating_add(duration);
        bucket.amount_sum = bucket.amount_sum.saturating_add(amount);
    });
}

/// Fold a withdrawal into the counters. `amount` leaves the locked total.
fn record_withdrawal(env: &Env, receiver: &Address, token: &Address, amount: i128) {
    touch_activity(env, receiver);
    adjust_tvl(env, token, -amount);
    with_current_bucket(env, |bucket| {
        bucket.withdrawals = bucket.withdrawals.saturating_add(1);
    });
}

/// Fold a cancellation into the counters. The unwithdrawn remainder is released.
fn record_stream_closed(env: &Env, stream: &Stream) {
    touch_activity(env, &stream.sender);

    let active: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ActiveStreams)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::ActiveStreams, &active.saturating_sub(1));

    let remaining = stream.total_amount.saturating_sub(stream.withdrawn_amount);
    adjust_tvl(env, &stream.token, -remaining);
}

/// Move the locked total for `token` by `delta`, clamping at zero.
fn adjust_tvl(env: &Env, token: &Address, delta: i128) {
    let mut tvl = get_tvl(env);
    let current = tvl.get(token.clone()).unwrap_or(0);
    let next = current.saturating_add(delta);
    tvl.set(token.clone(), if next < 0 { 0 } else { next });
    env.storage().instance().set(&DataKey::TotalTvl, &tvl);
}

/// Protocol fee rate in basis points; `0` when unset.
fn fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
}

/// Fee owed on `amount` at the current rate, rounded down.
///
/// The multiplication is checked so that a very large `amount` reports
/// [`Error::Overflow`] instead of wrapping into a nonsensical fee.
fn protocol_fee_for(env: &Env, amount: i128) -> Result<i128, Error> {
    let bps = fee_bps(env);
    if bps == 0 || amount <= 0 {
        return Ok(0);
    }
    amount
        .checked_mul(bps as i128)
        .map(|scaled| scaled / BPS_DENOMINATOR)
        .ok_or(Error::Overflow)
}

/// Transfer the protocol fee for `amount` from `sender` to the treasury.
///
/// Returns the fee charged. A zero fee short-circuits without touching the
/// token contract, so a zero-fee protocol costs nothing extra to run.
fn collect_protocol_fee(
    env: &Env,
    sender: &Address,
    token: &Address,
    stream_id: u64,
    amount: i128,
) -> Result<i128, Error> {
    let fee = protocol_fee_for(env, amount)?;
    if fee == 0 {
        return Ok(0);
    }
    let treasury = env
        .storage()
        .instance()
        .get::<_, Address>(&DataKey::Treasury)
        .ok_or(Error::TreasuryNotSet)?;

    TokenClient::new(env, token).transfer(sender, &treasury, &fee);

    env.events().publish(
        (symbol_short!("fee"), sender.clone()),
        ProtocolFeeCollectedEvent {
            stream_id,
            payer: sender.clone(),
            treasury,
            token: token.clone(),
            fee_amount: fee,
            fee_bps: fee_bps(env),
        },
    );
    Ok(fee)
}

/// Fee settings may be changed by a treasury manager or by an admin.
fn require_treasury_manager(env: &Env, account: &Address) -> Result<(), Error> {
    if has_role(env, account, ROLE_TREASURY) || has_role(env, account, ROLE_ADMIN) {
        Ok(())
    } else {
        Err(Error::Unauthorized)
    }
}

fn is_contract_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ContractPaused)
        .unwrap_or(false)
}

fn add_history(env: &Env, stream_id: u64, action: StreamAction) {
    let key = DataKey::StreamHistory(stream_id);
    let mut events = env
        .storage()
        .persistent()
        .get::<_, Vec<StreamEvent>>(&key)
        .unwrap_or(Vec::new(env));
    events.push_back(StreamEvent {
        stream_id,
        action,
        timestamp: env.ledger().timestamp(),
    });
    env.storage().persistent().set(&key, &events);
    extend_history_ttl(env, stream_id);
}

fn is_restricted(env: &Env, target: &Address) -> bool {
    compliance::is_restricted(env, target)
}

// ---------------------------------------------------------------------------
// Dispute resolution internals (issue #1471)
// ---------------------------------------------------------------------------

/// Accounts currently holding `ROLE_ARBITRATOR`, derived directly from the
/// authoritative role assignments in `DataKey::Roles`.
///
/// Deriving the roster from the same storage that `has_role` reads guarantees
/// `get_arbitrators` can never diverge from actual voting authority, whether
/// an arbitrator was assigned via `add_arbitrator` or the generic
/// `grant_role`.
fn arbitrator_roster(env: &Env) -> Vec<Address> {
    let roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&DataKey::Roles)
        .unwrap_or(Map::new(env));
    let mut arbitrators = Vec::new(env);
    for (account, assigned) in roles.iter() {
        if assigned.contains(ROLE_ARBITRATOR) {
            arbitrators.push_back(account);
        }
    }
    arbitrators
}

/// Approvals needed to auto-execute a resolution.
fn arbitration_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::DisputeThreshold)
        .unwrap_or(DEFAULT_ARBITRATION_THRESHOLD)
}

/// Id of the dispute currently open against `stream_id`, if any.
fn active_dispute_id(env: &Env, stream_id: u64) -> Option<u64> {
    let id: Option<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::ActiveDispute(stream_id));
    if id.is_some() {
        storage::extend_active_dispute_ttl_if_present(env, stream_id);
    }
    id
}

/// Guard used by every state-changing stream operation: reject while an
/// arbitration is in flight so its outcome acts on an immutable balance.
pub(crate) fn require_no_open_dispute(env: &Env, stream_id: u64) -> Result<(), Error> {
    if active_dispute_id(env, stream_id).is_some() {
        return Err(Error::DisputeAlreadyOpen);
    }
    Ok(())
}

/// Reject monetary resolutions that do not fit inside `(0, remaining]`.
fn validate_resolution_amount(
    _env: &Env,
    stream: &Stream,
    resolution: &DisputeResolution,
) -> Result<(), Error> {
    let remaining = stream.total_amount.saturating_sub(stream.withdrawn_amount);
    match resolution {
        DisputeResolution::RefundSender(amount) | DisputeResolution::PayReceiver(amount) => {
            if *amount <= 0 || *amount > remaining {
                return Err(Error::InvalidAmount);
            }
        }
        DisputeResolution::FreezeStream | DisputeResolution::CancelStream => {}
    }
    Ok(())
}

/// Tally recorded votes; returns `(approvals, rejections)`.
fn count_votes(_env: &Env, votes: &Map<Address, bool>) -> (u32, u32) {
    let mut approvals = 0u32;
    let mut rejections = 0u32;
    for (_, approve) in votes.iter() {
        if approve {
            approvals += 1;
        } else {
            rejections += 1;
        }
    }
    (approvals, rejections)
}

fn get_dispute_internal(env: &Env, dispute_id: u64) -> Result<Dispute, Error> {
    let dispute = env
        .storage()
        .persistent()
        .get::<_, Dispute>(&DataKey::Dispute(dispute_id))
        .ok_or(Error::DisputeNotFound)?;
    extend_dispute_ttl(env, dispute_id);
    Ok(dispute)
}

fn save_dispute(env: &Env, dispute: &Dispute) {
    env.storage()
        .persistent()
        .set(&DataKey::Dispute(dispute.id), dispute);
    extend_dispute_ttl(env, dispute.id);
}

/// Mark a dispute finalized: persist its state, clear the per-stream lock and
/// (for approval majorities) execute the proposed resolution.
///
/// Follows checks-effects-interactions: the finalized dispute is committed
/// before any external token transfer, so a failing transfer reverts the
/// whole vote rather than leaving it half-applied, and a successful one can
/// never be replayed by voting again.
fn finalize_dispute(
    env: &Env,
    dispute: &mut Dispute,
    approved: bool,
    expired: bool,
) -> Result<(), Error> {
    let executed = approved && !expired;
    dispute.resolved = true;
    let stream_id = dispute.stream_id;

    // Effects: persist finality and release the operation block.
    env.storage()
        .persistent()
        .remove(&DataKey::ActiveDispute(stream_id));
    save_dispute(env, dispute);

    if executed {
        execute_resolution(env, stream_id, &dispute.proposed_resolution)?;
    }

    env.events().publish(
        (symbol_short!("dispute"), symbol_short!("resolved")),
        DisputeResolvedEvent {
            dispute_id: dispute.id,
            stream_id,
            executed,
            approved,
            expired,
            timestamp: env.ledger().timestamp(),
        },
    );
    Ok(())
}

/// Execute an approved resolution against its stream.
///
/// Uses the same discipline as [`withdraw_inner`]: all contract state is
/// mutated and committed before the single external token transfer.
fn execute_resolution(
    env: &Env,
    stream_id: u64,
    resolution: &DisputeResolution,
) -> Result<(), Error> {
    let mut stream = get_stream(env, stream_id)?;
    if stream.state == STATE_CLOSED {
        return Err(Error::AlreadyCancelled);
    }

    match resolution {
        DisputeResolution::RefundSender(amount) => {
            // Defensive re-validation: the balance cannot move while the
            // dispute blocks operations, but stay explicit about the invariant.
            validate_resolution_amount(env, &stream, resolution)?;
            debug_assert!(*amount > 0);

            // Pull-based custody: closing the stream writes off the
            // unwithdrawn remainder, which simply stays with the sender.
            close_stream_record(env, &mut stream);
        }
        DisputeResolution::PayReceiver(amount) => {
            validate_resolution_amount(env, &stream, resolution)?;

            // Effects first: fold the forced payout into accounting exactly
            // like a receiver-initiated withdrawal.
            stream.withdrawn_amount = stream
                .withdrawn_amount
                .checked_add(*amount)
                .ok_or(Error::Overflow)?;
            record_withdrawal(env, &stream.receiver, &stream.token, *amount);
            close_stream_record(env, &mut stream);

            // Interaction last, mirroring withdraw_inner.
            TokenClient::new(env, &stream.token).transfer(&stream.sender, &stream.receiver, amount);
            add_history(env, stream_id, StreamAction::Withdrawn(*amount));
        }
        DisputeResolution::FreezeStream => {
            stream.state = STATE_FROZEN;
            save_stream(env, &stream);
            add_history(env, stream_id, StreamAction::Frozen);
        }
        DisputeResolution::CancelStream => {
            close_stream_record(env, &mut stream);
        }
    }
    Ok(())
}

/// Close a stream and release its unwithdrawn balance from the locked total.
fn close_stream_record(env: &Env, stream: &mut Stream) {
    stream.state = STATE_CLOSED;
    save_stream(env, stream);
    record_stream_closed(env, stream);
    add_history(env, stream.id, StreamAction::Cancelled);
}

fn require_admin(env: &Env, account: &Address) -> Result<(), Error> {
    require_role(env, account, ROLE_ADMIN)
}

fn require_role(env: &Env, account: &Address, role: u32) -> Result<(), Error> {
    if !has_role(env, account, role) {
        return Err(if role == ROLE_ADMIN {
            Error::NotAdmin
        } else if role == ROLE_ARBITRATOR {
            Error::NotArbitrator
        } else {
            Error::NotPauser
        });
    }
    Ok(())
}

fn has_role(env: &Env, account: &Address, role: u32) -> bool {
    let roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&DataKey::Roles)
        .unwrap_or(Map::new(env));
    roles
        .get(account.clone())
        .map(|v| v.contains(role))
        .unwrap_or(false)
}

fn grant_role_internal(env: Env, account: &Address, role: u32) {
    let mut roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&DataKey::Roles)
        .unwrap_or(Map::new(&env));
    let mut list = roles.get(account.clone()).unwrap_or(Vec::new(&env));
    if !list.contains(role) {
        list.push_back(role);
    }
    roles.set(account.clone(), list);
    env.storage().instance().set(&DataKey::Roles, &roles);
}

fn revoke_role_internal(env: &Env, account: &Address, role: u32) {
    let mut roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&DataKey::Roles)
        .unwrap_or(Map::new(env));
    if let Some(list) = roles.get(account.clone()) {
        let mut out = Vec::new(env);
        let len = list.len();
        for i in 0..len {
            if let Some(r) = list.get(i) {
                if r != role {
                    out.push_back(r);
                }
            }
        }
        roles.set(account.clone(), out);
        env.storage().instance().set(&DataKey::Roles, &roles);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod common;

#[cfg(test)]
mod test;

#[cfg(test)]
mod stress_test;

#[cfg(test)]
mod security_test;

#[cfg(test)]
mod batch_test;
