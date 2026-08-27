//! Storage architecture (issue #1437)
//!
//! All contract state is addressed through the type-safe [`DataKey`] enum
//! instead of ad-hoc string/symbol keys. Every key belongs to exactly one of
//! Soroban's three storage types, chosen by how long the data must live and
//! whether it may be cleared:
//!
//! | Storage type | Data | Lifetime |
//! |---|---|---|
//! | `instance()` | [`DataKey::Admin`], [`DataKey::ContractPaused`], [`DataKey::StreamCounter`], [`DataKey::ProposalCounter`], [`DataKey::Roles`], [`DataKey::RestrictedAddresses`], [`DataKey::ActiveStreams`], [`DataKey::TotalTvl`], [`DataKey::LastActivity`], [`DataKey::LastPrune`], [`DataKey::FeeBps`], [`DataKey::Treasury`], [`DataKey::DisputeCounter`], [`DataKey::DisputeThreshold`] | Survives contract upgrades; lives as long as the contract instance |
//! | `persistent()` | [`DataKey::Stream`], [`DataKey::UserStreams`], [`DataKey::Proposal`], [`DataKey::StreamMetadata`], [`DataKey::StreamHistory`], [`DataKey::MetricBuckets`], [`DataKey::UserSeen`], [`DataKey::Dispute`], [`DataKey::ActiveDispute`] | Long-term data; must be TTL-extended on access |
//! | `temporary()` | [`DataKey::ReentrancyLock`] | Transaction-scoped; cleared automatically |
//!
//! # TTL management
//!
//! Soroban storage entries expire unless their TTL is extended. The rule is:
//! **always extend the TTL when accessing long-term data.** The helpers in
//! this module encapsulate that policy:
//!
//! - [`extend_instance_ttl`] keeps the contract instance (and its instance
//!   storage) alive, and should be called on every state-changing entry point.
//! - [`extend_stream_ttl`], [`extend_proposal_ttl`], [`extend_metadata_ttl`],
//!   [`extend_history_ttl`] and [`extend_user_streams_ttl`] keep individual
//!   persistent entries alive when they are read or written.
//! - [`bump_persistent_ttl_if_present`] is a generic fallback for the
//!   map-style persistent keys ([`DataKey::MetricBuckets`],
//!   [`DataKey::UserSeen`]).
//!
//! TTL values are expressed in ledgers. Bump thresholds are small
//! ([`LEDGER_BUMP_SHARED`], [`LEDGER_BUMP_STREAM`]) so that an entry is only
//! refreshed once it is close to expiring, and the extension caps are generous
//! ([`MAX_TTL_STREAM`], [`MAX_TTL_INSTANCE`]). The host clamps the actual
//! extension to the protocol maximum.

use soroban_sdk::{contracttype, Address, Env};

/// Type-safe storage keys for every piece of contract state.
///
/// Variants are grouped by the storage type they live in (instance,
/// persistent, temporary). Parameterized variants (e.g. [`DataKey::Stream`])
/// hold the id/address that identifies the specific record, so no string
/// keys are ever constructed by callers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // -----------------------------------------------------------------------
    // Instance storage: survives contract upgrades, lives with the instance.
    // -----------------------------------------------------------------------
    /// Address of the contract administrator (set in `initialize`).
    Admin,
    /// Global pause flag.
    ContractPaused,
    /// Next stream id to allocate.
    StreamCounter,
    /// Next multi-signature proposal id to allocate.
    ProposalCounter,
    /// Role assignments: `Map<Address, Vec<u32>>` of role ids per account.
    Roles,
    /// OFAC-style restricted addresses: `Map<Address, bool>`.
    RestrictedAddresses,
    /// Number of streams that are not closed (health/metrics counter).
    ActiveStreams,
    /// Value still owed to receivers, per token: `Map<Address, i128>`.
    TotalTvl,
    /// Ledger timestamp of the last state-changing operation.
    LastActivity,
    /// Hour of the last metrics-window prune.
    LastPrune,
    /// Protocol fee rate in basis points.
    FeeBps,
    /// Address protocol fees are collected to.
    Treasury,
    /// Current contract version (incremented on each WASM upgrade).
    Version,
    /// Next dispute id to allocate.
    DisputeCounter,
    /// Number of arbitrator approvals required to auto-execute a resolution.
    DisputeThreshold,

    // -----------------------------------------------------------------------
    // Persistent storage: long-term data, must be TTL-extended on access.
    // -----------------------------------------------------------------------
    /// A stream by id.
    Stream(u64),
    /// Stream ids associated with a user: `Vec<u64>`.
    UserStreams(Address),
    /// A pending multi-signature proposal by id.
    Proposal(u64),
    /// Categorization metadata for a stream by stream id.
    StreamMetadata(u64),
    /// Append-only event log for a stream by stream id: `Vec<StreamEvent>`.
    StreamHistory(u64),
    /// Hourly metrics buckets: `Map<u64, MetricBucket>`.
    MetricBuckets,
    /// Addresses seen in the metrics window with their last-seen hour.
    UserSeen,

    // -----------------------------------------------------------------------
    // Persistent storage: clawback records (long-term, TTL-extended on access).
    // -----------------------------------------------------------------------
    /// A clawback request by id.
    Clawback(u64),
    /// Next clawback id to allocate.
    ClawbackCounter,

    // -----------------------------------------------------------------------
    // Persistent storage: recurring stream records (long-term, TTL-extended on access).
    // -----------------------------------------------------------------------
    /// Maps a parent recurring stream to its current child stream id.
    RecurringChildStreamId(u64),
    // Persistent storage: dispute records (long-term, TTL-extended on access).
    // -----------------------------------------------------------------------
    /// A dispute record by id.
    Dispute(u64),
    /// Id of the currently open dispute for a stream, if any.
    ActiveDispute(u64),

    // -----------------------------------------------------------------------
    // Temporary storage: transaction-scoped, cleared automatically.
    // -----------------------------------------------------------------------
    /// Re-entrancy mutex (true while a protected call is executing).
    ReentrancyLock,
    /// Active flash loan tracking (token address being borrowed).
    ActiveFlashLoan(Address),
}

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

/// Refresh threshold for shared/instance entries: extend when less than this
/// many ledgers remain.
pub const LEDGER_BUMP_SHARED: u32 = 100;
/// Refresh threshold for stream entries: extend when less than this many
/// ledgers remain.
pub const LEDGER_BUMP_STREAM: u32 = 200;
/// Extension cap for stream (persistent) entries, in ledgers (~365 days).
pub const MAX_TTL_STREAM: u32 = 31_536_000;
/// Extension cap for the contract instance, in ledgers (~120 days).
pub const MAX_TTL_INSTANCE: u32 = 2_073_600;

// ---------------------------------------------------------------------------
// TTL helpers
// ---------------------------------------------------------------------------

/// Extend the TTL of the contract instance (and its code) so the contract and
/// its instance storage stay alive. Call on state-changing entry points.
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_BUMP_SHARED, MAX_TTL_INSTANCE);
}

/// Extend the TTL of a stream's persistent entry.
///
/// Safe to call after the entry has been read or written; extending a
/// non-existent entry is a host error, so callers must only pass ids of
/// streams that exist.
pub fn extend_stream_ttl(env: &Env, stream_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Stream(stream_id),
        LEDGER_BUMP_STREAM,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a proposal's persistent entry.
pub fn extend_proposal_ttl(env: &Env, proposal_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Proposal(proposal_id),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a stream's metadata entry.
pub fn extend_metadata_ttl(env: &Env, stream_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::StreamMetadata(stream_id),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a stream's history entry.
pub fn extend_history_ttl(env: &Env, stream_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::StreamHistory(stream_id),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a user's stream-index entry.
pub fn extend_user_streams_ttl(env: &Env, user: &Address) {
    env.storage().persistent().extend_ttl(
        &DataKey::UserStreams(user.clone()),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a persistent key only if the entry exists.
///
/// Used for the map-style persistent keys ([`DataKey::MetricBuckets`],
/// [`DataKey::UserSeen`]) whose getters return an empty collection when the
/// entry has never been written.
pub fn bump_persistent_ttl_if_present(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, LEDGER_BUMP_SHARED, MAX_TTL_STREAM);
    }
}

/// Extend the TTL of a clawback request's persistent entry.
pub fn extend_clawback_ttl(env: &Env, clawback_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Clawback(clawback_id),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a dispute's persistent entry.
pub fn extend_dispute_ttl(env: &Env, dispute_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Dispute(dispute_id),
        LEDGER_BUMP_SHARED,
        MAX_TTL_STREAM,
    );
}

/// Extend the TTL of a stream's active-dispute pointer, if the entry exists.
///
/// The pointer is removed as soon as the dispute is resolved or closed, so the
/// entry may legitimately be absent (unlike a live dispute record).
pub fn extend_active_dispute_ttl_if_present(env: &Env, stream_id: u64) {
    bump_persistent_ttl_if_present(env, &DataKey::ActiveDispute(stream_id));
}
