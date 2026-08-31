#![no_std]

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

pub mod math;
pub mod storage;
pub mod clawback;
pub mod compliance;
pub mod types;

#[cfg(test)]
mod bench_test;
#[cfg(test)]
mod clawback_test;
#[cfg(test)]
mod compliance_test;
#[cfg(test)]
mod types_test;

// #[cfg(test)]
// mod interest_test;

// #[cfg(test)]
// mod mock_vault;

// #[cfg(test)]
// mod vault_integration_test;

#[cfg(test)]
mod ttl_stress_test;

#[cfg(test)]
mod upgrade_test;

use errors::Error;
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Vec};
use storage::{PROPOSAL_COUNT, RECEIPT, RESTRICTED_ADDRESSES, STREAM_COUNT};
use types::{
    ContributorRequest, CurveType, DataKey, Milestone, ProposalApprovedEvent, ProposalCreatedEvent,
    ReceiptMetadata, RequestCreatedEvent, RequestExecutedEvent, RequestKey, RequestStatus, Role,
    Stream, StreamCreatedEvent, StreamParams, StreamProposal, StreamReceipt, StreamRequest,
    StreamResumedEvent, StreamState,
};

// Stream state
pub const STATE_ACTIVE: u32 = 0;
pub const STATE_PAUSED: u32 = 1;
pub const STATE_CLOSED: u32 = 2;

// Vesting curve
pub const CURVE_LINEAR: u32 = 0;
pub const CURVE_EXP: u32 = 1;
pub const CURVE_MILESTONE: u32 = 2;

// Protocol fee
/// Denominator for basis-point math: 10_000 bps == 100%.
pub const BPS_DENOMINATOR: i128 = 10_000;
/// Hard ceiling on the protocol fee: 1_000 bps == 10%.
pub const MAX_FEE_BPS: u32 = 1_000;

// Monitoring
/// Version reported by [`StellarStreamContract::health_check`].
pub const CONTRACT_VERSION: u32 = 1;
/// Width of the rolling metrics window, in hourly buckets.
pub const METRICS_WINDOW_HOURS: u64 = 24;
/// Seconds per metrics bucket.
pub const SECONDS_PER_HOUR: u64 = 3_600;
/// Ceiling on addresses tracked for `unique_users_24h`, so that both the
/// bookkeeping and the read stay bounded regardless of traffic.
pub const MAX_TRACKED_USERS: u32 = 64;

// Template limits
/// Maximum template name length in characters.
pub const MAX_TEMPLATE_NAME_LEN: u32 = 32;
/// Maximum templates a single user may store.
pub const MAX_TEMPLATES_PER_USER: u32 = 20;

// Roles
pub const ROLE_ADMIN: u32 = 0;
pub const ROLE_PAUSER: u32 = 1;
pub const ROLE_TREASURY: u32 = 2;

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
    FeeTooHigh = 38,
    TreasuryNotSet = 39,
    InvalidMilestones = 40,
    InvalidMilestonePercentages = 41,

    // ===== Clawback errors =====
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

    // ===== Template errors =====
    /// No template exists for the given ID.
    TemplateNotFound = 50,
    /// Template name exceeds the maximum length (32 chars).
    TemplateNameTooLong = 51,
    /// User has reached the maximum number of templates (20).
    TooManyTemplates = 52,
    /// Caller is not the owner of this template.
    NotTemplateOwner = 53,
    /// The receiver address is the same as the sender address.
    InvalidReceiverAddress = 54,
    /// The end time must be after the current ledger timestamp.
    InvalidEndTime = 55,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------
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
    /// Present only when `curve_type == CURVE_MILESTONE`; see [`Milestone`].
    pub milestones: Option<Vec<Milestone>>,
    /// If true, the sender may raise clawback requests on this stream.
    pub clawback_enabled: bool,
}

// ---------------------------------------------------------------------------
// Stream metadata for categorization (issue #1466)
//
// Metadata lives in its own `StreamMetadata(stream_id)` persistent entry keyed
// by stream id rather than as an `Option<StreamMetadata>` field on `Stream`:
// soroban-sdk 22 cannot convert an `Option<T>` whose `T` is a user
// `#[contracttype]` struct, which makes any struct carrying such a field fail
// to build under `testutils`.

/// A single unlock checkpoint in a milestone-vesting schedule.
///
/// Milestone vesting unlocks tokens in discrete steps at fixed timestamps
/// instead of continuously over time. Each milestone's `percentage` is a
/// **cumulative** basis-point share (out of 10,000) of the stream's total
/// amount — not an incremental slice on top of the previous milestone. For
/// example, the schedule `[(3mo, 2500), (6mo, 5000), (12mo, 10000)]` means
/// 25% is unlocked at 3 months, a *total* of 50% at 6 months, and 100% at 12
/// months (not 25% + 25% + 50%).
///
/// A valid schedule must have strictly ascending `timestamp`s, strictly
/// ascending `percentage`s, and a final `percentage` of exactly 10,000 bps.
/// Before the first milestone's timestamp is reached, nothing is unlocked;
/// between two reached milestones, the most recently reached milestone's
/// percentage holds (no partial/gradual unlock in between).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    /// Ledger timestamp (seconds) at which this checkpoint is reached.
    pub timestamp: u64,
    /// Cumulative basis points (out of 10,000) unlocked once `timestamp` is reached.
    pub percentage: u32,
}

// Stream metadata for categorization (issue #1466)
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamMetadata {
    pub label: String,
    pub tags: Vec<String>,
    pub external_ref: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct StreamMetadataUpdatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub timestamp: u64,
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
#[allow(dead_code)]
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
// Clawback types
// ---------------------------------------------------------------------------

/// Lifecycle state of a clawback request.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClawbackStatus {
    Pending,
    Approved,
    Executed,
    Rejected,
}

/// A clawback request allowing a stream sender to recover previously withdrawn tokens.
///
/// Opt-in: the stream must have been created with `clawback_enabled = true`.
/// Amount cannot exceed `stream.withdrawn_amount`.
#[contracttype]
#[derive(Clone)]
pub struct ClawbackRequest {
    pub clawback_id: u64,
    pub stream_id: u64,
    pub amount: i128,
    pub reason: String,
    pub approved_by_receiver: bool,
    pub approvals: Vec<Address>,
    pub required_approvals: u32,
    pub status: ClawbackStatus,
    pub created_at: u64,
    pub expires_at: u64,
}

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

#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackApprovedEvent {
    pub clawback_id: u64,
    pub approver: Address,
    pub by_receiver: bool,
    pub approval_count: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackExecutedEvent {
    pub clawback_id: u64,
    pub stream_id: u64,
    pub amount: i128,
    pub sender: Address,
    pub timestamp: u64,
}


/// A saved stream template that users can reuse to quickly create similar streams.
///
/// Templates store configuration, not actual tokens. They simplify recurring
/// operations like monthly payroll or subscription payments.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamTemplate {
    /// Unique template id.
    pub id: u64,
    /// Owner of this template.
    pub owner: Address,
    /// Human-readable name (max 32 chars).
    pub name: String,
    /// Token contract address.
    pub token: Address,
    /// Default stream duration in seconds.
    pub duration: u64,
    /// Vesting curve type (CURVE_LINEAR, CURVE_EXP, CURVE_MILESTONE).
    pub curve_type: u32,
    /// Whether streams created from this template are soulbound.
    pub is_soulbound: bool,
    /// Optional cliff duration in seconds.
    pub cliff_duration: Option<u64>,
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
        if env.storage().instance().get::<_, Address>(&DataKey::Admin).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ContractPaused, &false);
        env.storage().instance().set(&DataKey::StreamCounter, &1u64);
        env.storage().instance().set(&DataKey::ProposalCounter, &1u64);
        grant_role_internal(env.clone(), &admin, ROLE_ADMIN);
        Ok(())
    }

    /// Create a new stream. Returns the newly allocated stream id.
    ///
    /// This is the core stream-creation entry point. A sender can fund a new
    /// continuous vesting stream for a receiver, with validation, transfer,
    /// storage, and event emission performed atomically as part of the same
    /// contract call.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        curve_type: CurveType,
        is_soulbound: bool,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if sender == receiver {
            return Err(Error::InvalidReceiverAddress);
        }
        if end_time <= env.ledger().timestamp() {
            return Err(Error::InvalidEndTime);
        }
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if is_restricted(&env, &sender) || is_restricted(&env, &receiver) {
            return Err(Error::AddressRestricted);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            total_amount,
            start_time,
            end_time,
            curve_type as u32,
            is_soulbound,
            false,
            None,
        )?;

        collect_protocol_fee(&env, &sender, &token, stream_id, total_amount)?;
        Ok(stream_id)
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
        if env.storage().instance().get::<_, Address>(&DataKey::Admin).is_none() {
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

        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        extend_proposal_ttl(&env, id);
        env.storage().instance().set(&DataKey::ProposalCounter, &next);

        env.events()
            .publish((symbol_short!("proposal"), sender.clone()), id);
        Ok(id)
    }

    /// Approve a pending proposal.
    ///
    /// Each address may approve a given proposal at most once. When the number
    /// of distinct approvers reaches `required_approvals`, the proposal is
    /// marked executed and the underlying stream is created immediately.
    pub fn approve_proposal(
        env: Env,
        proposal_id: u64,
        approver: Address,
    ) -> Result<(), Error> {
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
            env.events()
                .publish((symbol_short!("executed"), proposal.sender.clone()), stream_id);
        } else {
            save_proposal(&env, proposal_id, &proposal);
        }

        Ok(())
    }

    /// Query a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<StreamProposal, Error> {
        get_proposal(&env, proposal_id)
    }

<<<<<<< HEAD
    /// Withdraw the currently unlocked amount to the receiver.
    /// Returns the amount withdrawn.
    pub fn withdraw(env: Env, stream_id: u64, receiver: Address) -> Result<i128, Error> {
        receiver.require_auth();
        extend_instance_ttl(&env);

        // Re-entrancy guard (temporary storage lock).
        if env.storage().temporary().get::<_, bool>(&DataKey::ReentrancyLock).unwrap_or(false) {
            return Err(Error::Reentrancy);
        }
        env.storage().temporary().set(&DataKey::ReentrancyLock, &true);

        let result = withdraw_inner(&env, stream_id, &receiver);

        env.storage().temporary().remove(&DataKey::ReentrancyLock);
        result
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
        stream.state = STATE_CLOSED;
        save_stream(&env, &stream);
        record_stream_closed(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Cancelled);
        Ok(())
    }

    /// Pause an active stream. Only the sender may pause.
    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
=======
    /// Create a new stream with optional soulbound locking
    ///
    /// # Parameters
    /// - `is_soulbound`: Set to true to permanently bind this stream to the receiver's address.
    ///   Cannot be changed after stream creation. Irreversible.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        curve_type: CurveType,
        is_soulbound: bool,
    ) -> Result<u64, Error> {
        let milestones = Vec::new(&env);
        let params = StreamParams {
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            curve_type,
            is_soulbound,
            vault_address: None,
        };
        Self::create_stream_with_milestones(env, params)
    }

    /// Create a new stream with milestones and optional soulbound locking
    ///
    /// # Parameters
    /// - `params`: Stream parameters bundled in a struct to avoid exceeding parameter limits
    pub fn create_stream_with_milestones(
        env: Env,
        params: StreamParams,
    ) -> Result<u64, Error> {
        params.sender.require_auth();

        // Validate time range
        if params.start_time >= params.end_time {
            return Err(Error::InvalidTimeRange);
        }
        if params.total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if Self::is_address_restricted(env.clone(), params.receiver.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }

        // Validate cliff period
        if params.cliff_time < params.start_time || params.cliff_time > params.end_time {
            panic!("Cliff time must be between start and end time");
        }

        // Validate vault if provided
        let vault_shares = if let Some(ref vault) = params.vault_address {
            // Transfer tokens to contract first
            let token_client = token::Client::new(&env, &params.token);
            token_client.transfer(&params.sender, &env.current_contract_address(), &params.total_amount);

            // Deposit to vault and get shares
            vault::deposit_to_vault(&env, vault, &params.token, params.total_amount)
                .map_err(|_| Error::InvalidAmount)?
        } else {
            // Standard stream without vault
            let token_client = token::Client::new(&env, &params.token);
            token_client.transfer(&params.sender, &env.current_contract_address(), &params.total_amount);
            0
        };

        let stream_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let next_id = stream_id + 1;

        let stream = Stream {
            sender: params.sender.clone(),
            receiver: params.receiver.clone(),
            token: params.token.clone(),
            total_amount: params.total_amount,
            start_time: params.start_time,
            cliff_time: params.cliff_time,
            end_time: params.end_time,
            withdrawn_amount: 0,
            interest_strategy: 0,
            vault_address: params.vault_address.clone(),
            deposited_principal: params.total_amount,
            metadata: None,
            withdrawn: 0,
            receipt_owner: params.receiver.clone(),
            paused_time: 0,
            total_paused_duration: 0,
            milestones: params.milestones,
            curve_type: params.curve_type,
            is_usd_pegged: false,
            usd_amount: 0,
            oracle_address: params.sender.clone(),
            oracle_max_staleness: 0,
            price_min: 0,
            price_max: 0,
            is_soulbound: params.is_soulbound,
            clawback_enabled: false, // TODO: Check token flags
            arbiter: None,
            is_frozen: false,
            state: StreamState::Active,
        };

        let stream_key = (STREAM_COUNT, stream_id);

        // Extend contract instance TTL to ensure long-term accessibility
        // TTL extension removed

        env.storage().instance().set(&stream_key, &stream);
        env.storage().instance().set(&STREAM_COUNT, &next_id);

        // Store vault shares if vault is used
        if vault_shares > 0 {
            env.storage()
                .instance()
                .set(&DataKey::VaultShares(stream_id), &vault_shares);
        }

        // If soulbound, emit event and add to index
        if params.is_soulbound {
            env.events().publish(
                (symbol_short!("soulbound"), symbol_short!("locked")),
                (stream_id, params.receiver.clone()),
            );

            // Add to soulbound streams index
            let mut soulbound_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::SoulboundStreams)
                .unwrap_or(Vec::new(&env));
            soulbound_streams.push_back(stream_id);
            env.storage()
                .persistent()
                .set(&DataKey::SoulboundStreams, &soulbound_streams);
        }

        env.events().publish(
            (symbol_short!("create"), params.sender.clone()),
            StreamCreatedEvent {
                stream_id,
                sender: params.sender.clone(),
                receiver: params.receiver.clone(),
                token: params.token,
                total_amount: params.total_amount,
                start_time: params.start_time,
                end_time: params.end_time,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::mint_receipt(&env, stream_id, &params.receiver);

        Ok(stream_id)
    }

    /// Maximum number of recipients allowed in a single batch call.
    /// Prevents exceeding the Stellar ledger's maximum transaction size.
    pub const MAX_RECIPIENTS: u32 = 120;

    /// Create multiple streams in a single call.
    ///
    /// Returns `Error::BatchSizeExceeded` if the number of requests exceeds
    /// `MAX_RECIPIENTS`.
    pub fn create_batch_streams(
        env: Env,
        sender: Address,
        token: Address,
        requests: Vec<StreamRequest>,
    ) -> Result<Vec<u64>, Error> {
        if requests.len() > Self::MAX_RECIPIENTS {
            return Err(Error::BatchSizeExceeded);
        }

        sender.require_auth();

        let mut stream_ids: Vec<u64> = Vec::new(&env);

        for req in requests.iter() {
            let milestones: Vec<Milestone> = Vec::new(&env);
            let params = StreamParams {
                sender: sender.clone(),
                receiver: req.receiver,
                token: token.clone(),
                total_amount: req.amount,
                start_time: req.start_time,
                cliff_time: req.cliff_time,
                end_time: req.end_time,
                milestones,
                curve_type: CurveType::Linear,
                is_soulbound: false,
                vault_address: req.vault_address,
            };
            let stream_id = Self::create_stream_with_milestones(env.clone(), params)?;
            stream_ids.push_back(stream_id);
        }

        Ok(stream_ids)
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();

        // Check if contract is already initialized
        let is_initialized: bool = env
            .storage()
            .instance()
            .get(&DataKey::Initialized)
            .unwrap_or(false);
        
        if is_initialized {
            return Err(Error::AlreadyInitialized);
        }

        // Mark contract as initialized
        env.storage()
            .instance()
            .set(&DataKey::Initialized, &true);

        // Set admin address
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Grant all roles to admin
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::SuperAdmin), &true);
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::Guardian), &true);
        env.storage().instance().set(
            &DataKey::Role(admin.clone(), Role::FinancialOperator),
            &true,
        );

        // Extend storage TTL for long-term contract lifecycle
        // Set minimum TTL bump to 17280 ledgers (~1 day at 5s/ledger)
        // Set maximum TTL to 2073600 ledgers (~120 days at 5s/ledger)
        const LEDGER_BUMP: u32 = 17280;      // ~1 day
        const MAX_TTL: u32 = 2073600;        // ~120 days
        env.storage()
            .instance()
            .extend_ttl(LEDGER_BUMP, MAX_TTL);

        // Emit initialization event
        env.events().publish(
            (symbol_short!("init"), symbol_short!("success")),
            admin.clone(),
        );

        Ok(())
    }

    // ========== RBAC Functions ==========

    /// Grant a role to an address (Admin only)
    pub fn grant_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            panic!("{}", Error::Unauthorized as u32);
        }

        // Grant the role
        env.storage()
            .instance()
            .set(&DataKey::Role(target.clone(), role), &true);

        // Emit event
        env.events().publish((symbol_short!("grant"), target), role);
    }

    /// Revoke a role from an address (Admin only)
    pub fn revoke_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return; // Error::Unauthorized;
        }

        // Revoke the role
        env.storage()
            .instance()
            .remove(&DataKey::Role(target.clone(), role));

        // Emit event
        env.events()
            .publish((symbol_short!("revoke"), target), role);
    }

    /// Check if an address has a specific role
    pub fn check_role(env: Env, address: Address, role: Role) -> bool {
        Self::has_role(&env, &address, role)
    }

    /// Internal helper to check if an address has a role
    fn has_role(env: &Env, address: &Address, role: Role) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Role(address.clone(), role))
            .unwrap_or(false)
    }

    // ========== Contract Upgrade Functions ==========

    /// Upgrade the contract to a new WASM hash
    /// Only addresses with Admin role can perform this operation
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return; // Error::Unauthorized;
        }

        // Update the contract WASM
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        // Emit upgrade event with new WASM hash
        env.events()
            .publish((symbol_short!("upgrade"), admin), new_wasm_hash);
    }

    /// Get the current admin address (for backward compatibility)
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn restrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        if !list.contains(address.clone()) {
            list.push_back(address);
            env.storage().instance().set(&RESTRICTED_ADDRESSES, &list);
        }
    }

    pub fn is_address_restricted(env: Env, address: Address) -> bool {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        list.contains(address)
    }

    pub fn unrestrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for a in list.iter() {
            if a != address {
                new_list.push_back(a.clone());
            }
        }
        env.storage()
            .instance()
            .set(&RESTRICTED_ADDRESSES, &new_list);
    }

    pub fn get_restricted_addresses(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env))
    }

    /// Returns true if the given vault address is in the approved vaults list.
    pub fn is_vault_approved(env: Env, vault: Address) -> bool {
        let approved: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ApprovedVaults)
            .unwrap_or(Vec::new(&env));
        approved.contains(vault)
    }

    /// Extend instance storage TTL so long-lived streams remain accessible.
    #[allow(dead_code)]
    fn extend_contract_ttl(env: &Env) {
        const EXTEND_LEDGERS: u32 = 6_000_000; // ~1 year at 5s/ledger
        env.storage()
            .instance()
            .extend_ttl(EXTEND_LEDGERS, EXTEND_LEDGERS);
    }

    fn mint_receipt(env: &Env, stream_id: u64, owner: &Address) {
        let receipt = StreamReceipt {
            stream_id,
            owner: owner.clone(),
            minted_at: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&(RECEIPT, stream_id), &receipt);
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        env.storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)
    }

    pub fn get_stream_remaining_time(env: Env, stream_id: u64) -> Result<u64, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;

        let current_time = env.ledger().timestamp();

        if current_time >= stream.end_time {
            Ok(0)
        } else {
            Ok(stream.end_time - current_time)
        }
    }

    pub fn is_stream_active(env: Env, stream_id: u64) -> bool {
        let stream: Option<Stream> = env.storage().instance().get(&(STREAM_COUNT, stream_id));

        match stream {
            None => false,
            Some(s) => {
                let current_time = env.ledger().timestamp();
                s.state == StreamState::Active && !s.is_frozen && current_time < s.end_time
            }
        }
    }

    pub fn get_soulbound_streams(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SoulboundStreams)
            .unwrap_or(Vec::new(&env))
    }

    pub fn transfer_receiver(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_receiver: Address,
    ) -> Result<(), Error> {
>>>>>>> 66f9b0a (feat(contract): implement secure contract initialization)
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

    // ------------------------- Rate Queries (issue #1477) -------------------------

    /// Calculate streaming rate per second, accounting for paused duration.
    ///
    /// Returns `0` for closed, paused, or zero-duration streams.
    pub fn get_stream_rate_per_second(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(math::rate_per_second(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
            stream.state,
        ))
    }

    /// Calculate streaming rate per day (per_second × 86,400).
    pub fn get_stream_rate_per_day(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(math::rate_per_day(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
            stream.state,
        ))
    }

    /// Calculate streaming rate per month (per_second × 2,592,000 = 30 days).
    pub fn get_stream_rate_per_month(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(math::rate_per_month(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
            stream.state,
        ))
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
            active_streams: env.storage().instance().get(&DataKey::ActiveStreams).unwrap_or(0),
            total_tvl: get_tvl(&env),
            last_activity_time: env.storage().instance().get(&DataKey::LastActivity).unwrap_or(0),
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
                duration_sum / streams_created_24h,
                amount_sum / streams_created_24h as i128,
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
        env.storage().instance().set(&DataKey::Treasury, &new_treasury);
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
        if role > ROLE_TREASURY {
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
        env.storage().instance().set(&DataKey::ContractPaused, &true);
        Ok(())
    }

    pub fn unpause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        extend_instance_ttl(&env);
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage().instance().set(&DataKey::ContractPaused, &false);
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
        if stream_ids.len() > 20 { return Err(Error::BatchSizeExceeded); }
        if stream_ids.is_empty() { return Err(Error::InvalidAmount); }

        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut total: i128 = 0;
        for i in 0..stream_ids.len() {
            let sid = stream_ids.get(i).unwrap();
            let stream = get_stream(&env, sid)?;
            if stream.receiver != receiver { return Err(Error::Unauthorized); }
            if stream.state == STATE_CLOSED { return Err(Error::AlreadyCancelled); }
            if stream.state == STATE_PAUSED { return Err(Error::StreamPaused); }
            let unlocked = unlocked_amount(&env, &stream);
            let w = unlocked - stream.withdrawn_amount;
            if w > 0 { amounts.push_back(w); total += w; } else { amounts.push_back(0); }
        }
        if total <= 0 { return Err(Error::InsufficientBalance); }

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
        extend_instance_ttl(&env);
        let stream = get_stream(&env, stream_id)?;
        if stream.sender != sender { return Err(Error::Unauthorized); }
        if stream.state == STATE_CLOSED { return Err(Error::StreamEnded); }
        if label.len() > 64 { return Err(Error::MetadataLabelTooLong); }
        if tags.len() > 5 { return Err(Error::TooManyTags); }
        for i in 0..tags.len() {
            if let Some(tag) = tags.get(i) {
                if tag.len() > 32 { return Err(Error::TagTooLong); }
            }
        }
        env.storage().persistent().set(
            &DataKey::StreamMetadata(stream_id),
            &StreamMetadata {
                label,
                tags,
                external_ref,
            },
        );
        extend_metadata_ttl(&env, stream_id);
        // Optimized event: sender is a topic, body is just (stream_id, timestamp).
        env.events().publish(
            (symbol_short!("meta_upd"), sender.clone(), stream_id),
            env.ledger().timestamp(),
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

    // ===== Template entry points (issue #1473) =====

    /// Save a new stream template for the caller.
    ///
    /// Returns the newly allocated template id. The caller must provide a
    /// name (≤ 32 chars), token address, duration, and curve type. A user
    /// may store at most [`MAX_TEMPLATES_PER_USER`] templates.
    pub fn save_template(
        env: Env,
        user: Address,
        name: String,
        token: Address,
        duration: u64,
        curve_type: u32,
        is_soulbound: bool,
        cliff_duration: Option<u64>,
    ) -> Result<u64, Error> {
        user.require_auth();
        extend_instance_ttl(&env);
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if name.len() > MAX_TEMPLATE_NAME_LEN {
            return Err(Error::TemplateNameTooLong);
        }
        if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP {
            return Err(Error::InvalidCurve);
        }

        let user_templates = get_user_template_ids(&env, &user);
        if user_templates.len() >= MAX_TEMPLATES_PER_USER {
            return Err(Error::TooManyTemplates);
        }

        let mut next = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::TemplateCounter)
            .unwrap_or(1);
        let id = next;
        next = next.checked_add(1).ok_or(Error::Overflow)?;

        let template = StreamTemplate {
            id,
            owner: user.clone(),
            name,
            token,
            duration,
            curve_type,
            is_soulbound,
            cliff_duration,
        };

        env.storage().persistent().set(&DataKey::Template(id), &template);
        extend_template_ttl(&env, id);
        add_user_template(&env, &user, id);
        env.storage().instance().set(&DataKey::TemplateCounter, &next);

        env.events()
            .publish((symbol_short!("tpl_save"), user), id);
        Ok(id)
    }

    /// Create a stream from a saved template.
    ///
    /// The caller must be the template owner. The template provides token,
    /// duration, curve, and soulbound settings; the caller specifies
    /// receiver, total_amount, and start_time. end_time is computed as
    /// start_time + template.duration.
    pub fn create_stream_from_template(
        env: Env,
        sender: Address,
        template_id: u64,
        receiver: Address,
        total_amount: i128,
        start_time: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        extend_instance_ttl(&env);
        let template = get_template(&env, template_id)?;
        if template.owner != sender {
            return Err(Error::NotTemplateOwner);
        }

        let end_time = start_time
            .checked_add(template.duration)
            .ok_or(Error::Overflow)?;

        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &template.token,
            total_amount,
            start_time,
            end_time,
            template.curve_type,
            template.is_soulbound,
            false, // clawback_enabled defaults to false
            None,  // milestones not supported from templates
        )?;
        collect_protocol_fee(&env, &sender, &template.token, stream_id, total_amount)?;

        env.events().publish(
            (symbol_short!("tpl_use"), sender),
            (template_id, stream_id),
        );
        Ok(stream_id)
    }

    /// Update an existing template. Only the owner may update.
    pub fn update_template(
        env: Env,
        user: Address,
        template_id: u64,
        name: String,
        token: Address,
        duration: u64,
        curve_type: u32,
        is_soulbound: bool,
        cliff_duration: Option<u64>,
    ) -> Result<(), Error> {
        user.require_auth();
        extend_instance_ttl(&env);
        let mut template = get_template(&env, template_id)?;
        if template.owner != user {
            return Err(Error::NotTemplateOwner);
        }
        if name.len() > MAX_TEMPLATE_NAME_LEN {
            return Err(Error::TemplateNameTooLong);
        }
        if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP {
            return Err(Error::InvalidCurve);
        }

        template.name = name;
        template.token = token;
        template.duration = duration;
        template.curve_type = curve_type;
        template.is_soulbound = is_soulbound;
        template.cliff_duration = cliff_duration;

        env.storage().persistent().set(&DataKey::Template(template_id), &template);
        extend_template_ttl(&env, template_id);

        env.events()
            .publish((symbol_short!("tpl_upd"), user), template_id);
        Ok(())
    }

    /// Delete a template. Only the owner may delete.
    pub fn delete_template(
        env: Env,
        user: Address,
        template_id: u64,
    ) -> Result<(), Error> {
        user.require_auth();
        extend_instance_ttl(&env);
        let template = get_template(&env, template_id)?;
        if template.owner != user {
            return Err(Error::NotTemplateOwner);
        }

        env.storage().persistent().remove(&DataKey::Template(template_id));
        remove_user_template(&env, &user, template_id);

        env.events()
            .publish((symbol_short!("tpl_del"), user), template_id);
        Ok(())
    }

    /// Return all template ids owned by a user.
    pub fn get_user_templates(env: Env, user: Address) -> Vec<u64> {
        get_user_template_ids(&env, &user)
    }

    /// Query a template by id.
    pub fn get_template(env: Env, template_id: u64) -> Result<StreamTemplate, Error> {
        get_template(&env, template_id)
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
        clawback::request_clawback(&env, stream_id, &sender, amount, reason, required_approvals, expires_at)
    }

    /// Approve a pending clawback request.
    ///
    /// The receiver's approval immediately satisfies the condition.
    /// Any other address counts as a governance approver toward `required_approvals`.
    pub fn approve_clawback(
        env: Env,
<<<<<<< HEAD
        clawback_id: u64,
        approver: Address,
=======
        receiver: Address,
        token: Address,
        total_amount: i128,
        duration: u64,
        metadata: Option<soroban_sdk::BytesN<32>>,
    ) -> u64 {
        receiver.require_auth();
        let count: u64 = env
            .storage()
            .instance()
            .get(&RequestKey::RequestCount)
            .unwrap_or(0);
        let request_id = count + 1;
        let now = env.ledger().timestamp();
        let request = ContributorRequest {
            id: request_id,
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            duration,
            start_time: now,
            status: RequestStatus::Pending,
            metadata,
        };
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        env.storage()
            .instance()
            .set(&RequestKey::RequestCount, &request_id);
        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "RequestCreated"), request_id),
            RequestCreatedEvent {
                request_id,
                receiver,
                token,
                total_amount,
                duration,
                timestamp: now,
            },
        );
        request_id
    }

    pub fn execute_request(env: Env, admin: Address, request_id: u64) -> Result<u64, Error> {
        admin.require_auth();
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }
        let mut request: ContributorRequest = env
            .storage()
            .instance()
            .get(&RequestKey::Request(request_id))
            .ok_or(Error::StreamNotFound)?;
        if request.status != RequestStatus::Pending {
            return Err(Error::AlreadyExecuted);
        }
        request.status = RequestStatus::Approved;
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        
        let params = StreamParams {
            sender: admin.clone(),
            receiver: request.receiver.clone(),
            token: request.token.clone(),
            total_amount: request.total_amount,
            start_time: request.start_time,
            cliff_time: request.start_time, // cliff_time = start_time (no cliff)
            end_time: request.start_time + request.duration,
            milestones: Vec::new(&env),
            curve_type: CurveType::Linear,
            is_soulbound: false,
            vault_address: None,
        };
        let stream_id = Self::create_stream_with_milestones(env.clone(), params)?;
        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "RequestExecuted"),
                request_id,
            ),
            RequestExecutedEvent {
                request_id,
                stream_id,
                executor: admin,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(stream_id)
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<ContributorRequest> {
        env.storage()
            .instance()
            .get(&RequestKey::Request(request_id))
    }

    // ========== OFAC Compliance Functions ==========

    /// Internal helper: validate receiver is not restricted
    fn validate_receiver(env: &Env, receiver: &Address) -> Result<(), Error> {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or_else(|| Vec::new(env));
        for existing in list.iter() {
            if &existing == receiver {
                return Err(Error::ReceiverRestricted);
            }
        }
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<StreamProposal> {
        env.storage().instance().get(&(PROPOSAL_COUNT, proposal_id))
    }

    pub fn get_receipt(env: Env, stream_id: u64) -> Option<StreamReceipt> {
        env.storage().instance().get(&(RECEIPT, stream_id))
    }

    pub fn get_receipt_metadata(env: Env, stream_id: u64) -> Result<ReceiptMetadata, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;
        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let locked = stream.total_amount - unlocked;
        Ok(ReceiptMetadata {
            stream_id,
            locked_balance: locked,
            unlocked_balance: unlocked,
            total_amount: stream.total_amount,
            token: stream.token,
        })
    }

    pub fn transfer_receipt(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_owner: Address,
>>>>>>> 66f9b0a (feat(contract): implement secure contract initialization)
    ) -> Result<(), Error> {
        approver.require_auth();
        extend_instance_ttl(&env);
        clawback::approve_clawback(&env, clawback_id, &approver)
    }

    /// Execute an approved clawback, transferring tokens from receiver back to sender.
    ///
    /// May be called by anyone once the request is in `Approved` status.
    pub fn execute_clawback(
        env: Env,
        clawback_id: u64,
        executor: Address,
    ) -> Result<(), Error> {
        executor.require_auth();
        extend_instance_ttl(&env);
        clawback::execute_clawback(&env, clawback_id)
    }

    /// Fetch a clawback request by ID. Returns `None` if it does not exist.
    pub fn get_clawback_request(env: Env, clawback_id: u64) -> Option<ClawbackRequest> {
        clawback::get_clawback_request(&env, clawback_id)
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

    Ok(withdrawable)
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
        CURVE_EXP => {
            let e = elapsed as i128;
            let d = dur as i128;
            // quadratic: total * elapsed^2 / dur^2
            let num = e.checked_mul(e).and_then(|v| v.checked_mul(stream.total_amount));
            let den = d.checked_mul(d);
            match (num, den) {
                (Some(n), Some(den)) if den != 0 => n / den,
                _ => 0,
            }
        }
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
    if env.storage().instance().get::<_, Address>(&DataKey::Admin).is_none() {
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
    };

    env.storage().persistent().set(&DataKey::Stream(id), &stream);
    extend_stream_ttl(env, id);

    record_stream_created(env, &stream);

    add_user_stream(env, sender, id);
    add_user_stream(env, receiver, id);

    env.storage().instance().set(&DataKey::StreamCounter, &next);

    // Record the stream's creation in its history.
    add_history(env, id, StreamAction::Created);
    Ok(id)
}

/// Validates a milestone-vesting schedule before it is attached to a stream.
///
/// Requires: a non-empty schedule, strictly ascending timestamps, strictly
/// ascending cumulative percentages, a final percentage of exactly
/// `math::BPS_DENOMINATOR` (10,000 bps = 100%), and a last-milestone timestamp
/// no later than the stream's `end_time` (otherwise the stream's end-of-term
/// fast path in `unlocked_amount` could release 100% before the schedule says
/// it should).
fn validate_milestones(milestones: &Option<Vec<Milestone>>, end_time: u64) -> Result<(), Error> {
    let milestones = milestones.as_ref().ok_or(Error::InvalidMilestones)?;
    if milestones.is_empty() {
        return Err(Error::InvalidMilestones);
    }

    let mut prev_timestamp: Option<u64> = None;
    let mut prev_percentage: u32 = 0;
    for i in 0..milestones.len() {
        let m = milestones.get(i).unwrap();
        if let Some(prev) = prev_timestamp {
            if m.timestamp <= prev {
                return Err(Error::InvalidMilestones);
            }
        }
        if m.percentage <= prev_percentage {
            return Err(Error::InvalidMilestonePercentages);
        }
        prev_timestamp = Some(m.timestamp);
        prev_percentage = m.percentage;
    }

    if prev_percentage as i128 != math::BPS_DENOMINATOR {
        return Err(Error::InvalidMilestonePercentages);
    }
    if prev_timestamp.unwrap() > end_time {
        return Err(Error::InvalidTimeRange);
    }

    Ok(())
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
    env.storage().persistent().set(&DataKey::MetricBuckets, &fresh_buckets);
    bump_persistent_ttl_if_present(env, &DataKey::MetricBuckets);

    let seen = get_user_seen(env);
    let mut fresh_seen = Map::new(env);
    for (address, last_seen) in seen.iter() {
        if last_seen >= cutoff {
            fresh_seen.set(address, last_seen);
        }
    }
    env.storage().persistent().set(&DataKey::UserSeen, &fresh_seen);
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
    env.storage().persistent().set(&DataKey::MetricBuckets, &buckets);
    bump_persistent_ttl_if_present(env, &DataKey::MetricBuckets);
}

/// Fold a stream creation into the counters.
fn record_stream_created(env: &Env, stream: &Stream) {
    touch_activity(env, &stream.sender);

    let active: u64 = env.storage().instance().get(&DataKey::ActiveStreams).unwrap_or(0);
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

    let active: u64 = env.storage().instance().get(&DataKey::ActiveStreams).unwrap_or(0);
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

    // Optimized event: stream_id and payer are topics, body is (fee_amount, fee_bps).
    // Indexers can derive treasury and token from the stream itself.
    env.events().publish(
        (symbol_short!("fee"), sender.clone(), stream_id),
        (fee, fee_bps(env)),
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
    env.storage().instance().get(&DataKey::ContractPaused).unwrap_or(false)
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

// ---------------------------------------------------------------------------
// Template helpers (issue #1473)
// ---------------------------------------------------------------------------

fn get_template(env: &Env, template_id: u64) -> Result<StreamTemplate, Error> {
    let key = DataKey::Template(template_id);
    let template = env
        .storage()
        .persistent()
        .get::<_, StreamTemplate>(&key)
        .ok_or(Error::TemplateNotFound)?;
    extend_template_ttl(env, template_id);
    Ok(template)
}

fn get_user_template_ids(env: &Env, user: &Address) -> Vec<u64> {
    let key = DataKey::UserTemplates(user.clone());
    let ids = env.storage().persistent().get::<_, Vec<u64>>(&key);
    if ids.is_some() {
        extend_user_templates_ttl(env, user);
    }
    ids.unwrap_or(Vec::new(env))
}

fn add_user_template(env: &Env, user: &Address, id: u64) {
    let key = DataKey::UserTemplates(user.clone());
    let mut list = env
        .storage()
        .persistent()
        .get::<_, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));
    list.push_back(id);
    env.storage().persistent().set(&key, &list);
    extend_user_templates_ttl(env, user);
}

fn remove_user_template(env: &Env, user: &Address, template_id: u64) {
    let key = DataKey::UserTemplates(user.clone());
    let list = env
        .storage()
        .persistent()
        .get::<_, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));
    let mut filtered = Vec::new(env);
    for i in 0..list.len() {
        if let Some(id) = list.get(i) {
            if id != template_id {
                filtered.push_back(id);
            }
        }
    }
    env.storage().persistent().set(&key, &filtered);
    extend_user_templates_ttl(env, user);
}

fn is_restricted(env: &Env, target: &Address) -> bool {
    compliance::is_restricted(env, target)
}

fn get_restricted(env: &Env) -> soroban_sdk::Map<Address, bool> {
    compliance::load_restricted(env)
}

fn require_admin(env: &Env, account: &Address) -> Result<(), Error> {
    require_role(env, account, ROLE_ADMIN)
}

fn require_role(env: &Env, account: &Address, role: u32) -> Result<(), Error> {
    if !has_role(env, account, role) {
        return Err(if role == ROLE_ADMIN {
            Error::NotAdmin
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
mod metrics_test;
mod fee_test;
