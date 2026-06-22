use crate::contracterror::Error;
use crate::types::{PendingRateUpdate, StreamV2};
use soroban_sdk::{contracttype, symbol_short, Address, Bytes, Env, Symbol, Vec};

const STATUS_ACTIVE: u8 = 0;
const STATUS_CANCELLED: u8 = 1;
const STATUS_PENDING: u8 = 2;
const STATUS_MASK: u128 = 0xFF;
const PENALTY_BPS_SHIFT: u32 = 8;
const PENALTY_BPS_MASK: u128 = 0xFFFF_FFFF;
const CURVE_TYPE_SHIFT: u32 = 40;
const CURVE_TYPE_MASK: u128 = 0xFF;
const MIGRATED_FROM_V1_SHIFT: u32 = 48;
const YIELD_ENABLED_SHIFT: u32 = 49;
const IS_RECURRENT_SHIFT: u32 = 50;
const CANCELLATION_TYPE_SHIFT: u32 = 51;
const CANCELLATION_TYPE_MASK: u128 = 0xFFFF_FFFF;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
struct StoredStreamV2 {
    pub sender: Address,
    pub receiver: Address,
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub cliff_time: u64,
    pub withdrawn_amount: i128,
    pub packed_meta: u128,
    pub v1_stream_id: u64,
    pub step_duration: i128,
    pub multiplier_bps: i128,
    pub vault_address: Option<Address>,
    pub cycle_duration: u64,
    pub yield_recipient: u32,
    pub split_address: Option<Address>,
    pub split_bps: u32,
}

// ----------------------------------------------------------------
// DataKeyV2 — all storage keys for the V2 contract.
//
// IMPORTANT: never reorder or remove variants — Soroban
// serialises the enum discriminant as the on-chain key.
// Only ever append new variants at the bottom.
// ----------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKeyV2 {
    // -- instance() keys -----------------------------------------
    Admin,       // 0
    Stream(u64), // 1

    // Issue #400 — multi-sig admin
    AdminList, // 2
    Threshold, // 3

    // -- Paused state --------------------------------------------
    Paused, // 4

    // -- Dust threshold ------------------------------------------
    /// Per-asset minimum stream amount. Falls back to DEFAULT_MIN_VALUE.
    MinValue(Address), // 5

    // -- Analytics -----------------------------------------------
    UserSeen(Address), // 6

    // -- Time-locked Admin Actions -------------------------------
    ScheduledOp(crate::types::Operation), // 7

    // -- Contract lifecycle (#934) --------------------------------
    ContractState, // 8
    ClaimDeadline, // 9

    // -- Sanctions oracle (#937) ----------------------------------
    OracleAddress, // 10
    // -- Protocol Fees -------------------------------------------
    /// Protocol treasury address for fee collection
    Treasury, // 8
    /// Accumulated pending fees per (recipient, token) pair
    PendingFees(Address, Address), // 9
    /// Protocol fee in basis points (e.g. 100 = 1%)
    FeeBps, // 10
    /// Verified assets supported for V2 stream creation
    WhitelistedAsset(Address), // 11

    // -- Migration pause -----------------------------------------
    /// When true, migrate_stream is blocked while standard V2 ops remain live.
    MigrationPaused, // 12

    // -- Pending Stream Requests (Multi-sig Approval) -----------------
    /// Pending stream request by ID
    PendingStreamRequest(u64), // 13
    /// Counter for generating unique pending stream request IDs
    StreamRequestCount, // 14

    // -- Compliance Oracle (Issue #412) ---------------------------
    /// Address of the compliance oracle contract
    ComplianceOracle, // 15
    // -- Emergency Mode (Issue #393) ---------------------------------
    /// When true, create_stream and top_up are blocked; withdraw remains accessible.
    Emergency, // 15

    // -- Migration Ledger Bit-Map (Issue #399) -----------------------
    /// Persistent flag per V1 stream ID. Set to true after a successful migration
    /// to prevent replay attacks (migrating the same V1 stream twice).
    V1MigratedMap(u64), // 16

    // -- Nebula-DAO Vote-Weight Integration (Issue: Governance) ------
    /// Address of the DAO governance token contract
    DaoToken, // 17
    /// Minimum voting power required to execute admin-only treasury splits
    VotingThreshold, // 18

    // -- Timelocked Treasury Splits (Issue: Governance Security) -----
    /// Pending treasury split by ID
    PendingTreasurySplit(u64), // 19
    /// Counter for pending treasury split IDs
    TreasurySplitCount, // 20

    // -- Issue #602 — Protocol Fee Capture for split_multi_asset -----
    /// Address that collects disbursement fees
    FeeCollector, // 21
    /// Token used to pay disbursement fees (e.g. native XLM SAC)
    FeeToken, // 22
    /// Fee charged per recipient in split_multi_asset, in the FeeToken's base unit
    FeePerRecipient, // 23

    // -- Issue #603 — Reentrancy Guard --------------------------------
    /// Set to true while split_multi_asset is executing; prevents reentrant calls
    Locked, // 24

    // -- Issue #378 — Streaming Swap (DEX Integration) -----------------
    /// Default DEX contract address for swap operations
    DexAddress, // 25
    /// DEX pool configuration for a specific asset pair (token_in, token_out)
    DexPool(Address, Address), // 26
    /// Whether swap streaming is enabled globally
    SwapEnabled, // 27

    // -- Issue #377 — Push-Pull Rate Re-balancing --------------------
    /// Pending rate update for a stream (stream_id -> PendingRateUpdate)
    PendingRateUpdate(u64), // 28
    /// Timestamp when pending rate update was set (for TTL tracking)
    PendingRateUpdateExpiry(u64), // 29

    // -- Issue #632 — Gas Tank Buffer ----------------------------------
    /// Per-sender XLM gas buffer in stroops.
    GasBuffer(Address), // 30

    // -- Emergency Recovery Multi-Sig (Issue: Security Critical) --------
    /// Vec<Address> of pre-approved recovery council members
    RecoveryCouncil, // 31
    /// Required number of council signatures to execute recovery
    RecoveryThreshold, // 32
    /// Timestamp when recovery was initiated (None = not initiated)
    RecoveryInitiatedAt, // 33
    /// Addresses that have already approved the current recovery
    RecoveryApprovals, // 34

    // -- Issue #938 — Variable-Fee Tiered Logic -----------------------
    FeeTiers,      // 35
    EventLog(u64), // 36
}

/// Global stream counter.
pub const STREAM_COUNT_V2: Symbol = symbol_short!("STR_V2");
pub const V2_TVL: Symbol = symbol_short!("V2_TVL");
pub const V2_USER_COUNT: Symbol = symbol_short!("V2_USER");

// TTL constants (~5-second ledger close time)
const INSTANCE_TTL_THRESHOLD: u32 = 518_400; // ~30 days
const INSTANCE_TTL_BUMP: u32 = 535_680; // ~31 days

// Per-stream persistent TTL constants
pub const STREAM_TTL_THRESHOLD: u32 = 518_400; // ~30 days — extend if below this
pub const STREAM_TTL_BUMP: u32 = 2_073_600; // ~120 days — extend to this

// 48-hour delay for administrative operations.
pub const ADMIN_DELAY: u64 = 172_800; // 48h in seconds

// ----------------------------------------------------------------
// Backward-compat single-admin bootstrap (used by init)
// ----------------------------------------------------------------

/// Seed a single-admin list with threshold = 1.
pub fn set_admin(env: &Env, admin: &Address) {
    let mut list = Vec::new(env);
    list.push_back(admin.clone());
    set_admin_list_raw(env, &list, 1);
}

/// Return the first admin (legacy helper used by existing callers).
pub fn get_admin(env: &Env) -> Address {
    bump_instance(env);
    get_admin_list(env)
        .first()
        .unwrap_or_else(|| env.panic_with_error(Error::ContractNotInitialized))
}

pub fn try_get_admin(env: &Env) -> Result<Address, Error> {
    bump_instance(env);
    get_admin_list(env)
        .first()
        .ok_or(Error::ContractNotInitialized)
}

/// Returns true if the admin list has been initialised.
pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKeyV2::AdminList)
}

// ----------------------------------------------------------------
// Multi-sig admin storage (Issue #400)
// ----------------------------------------------------------------

/// Atomically replace the admin set and threshold.
/// Validation (threshold bounds) is enforced in lib.rs.
pub fn set_admin_list_raw(env: &Env, admins: &Vec<Address>, threshold: u32) {
    env.storage().instance().set(&DataKeyV2::AdminList, admins);
    env.storage()
        .instance()
        .set(&DataKeyV2::Threshold, &threshold);
    bump_instance(env);
}

/// Return the full admin list.
pub fn get_admin_list(env: &Env) -> Vec<Address> {
    bump_instance(env);
    env.storage()
        .instance()
        .get(&DataKeyV2::AdminList)
        .unwrap_or_else(|| env.panic_with_error(Error::UnauthorizedSender))
}

pub fn try_get_admin_list(env: &Env) -> Result<Vec<Address>, Error> {
    bump_instance(env);
    env.storage()
        .instance()
        .get(&DataKeyV2::AdminList)
        .ok_or(Error::UnauthorizedSender)
}

/// Return the approval threshold.
pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKeyV2::Threshold)
        .unwrap_or(1)
}

/// Require that at least `threshold` of the admin list have authorised
/// this invocation.
///
/// Callers pass `signers` — the subset of admins that are signing this
/// particular transaction. The function:
///   1. Verifies every address in `signers` is in the admin list.
///   2. Calls `require_auth()` on each (host enforces the auth entry).
///   3. Checks `signers.len() >= threshold`.
pub fn require_multisig(env: &Env, signers: &Vec<Address>) -> Result<(), Error> {
    let admins = try_get_admin_list(env)?;
    let threshold = get_threshold(env);

    // Every supplied signer must be a registered admin.
    for signer in signers.iter() {
        if !admins.contains(&signer) {
            return Err(Error::NotEnoughSigners);
        }
        signer.require_auth();
    }

    if signers.len() < threshold {
        return Err(Error::NotEnoughSigners);
    }

    Ok(())
}

// ----------------------------------------------------------------
// persistent() helpers — Streams
// Stream storage
// ----------------------------------------------------------------

pub fn next_stream_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&STREAM_COUNT_V2).unwrap_or(0);
    env.storage().instance().set(&STREAM_COUNT_V2, &(id + 1));
    id
}

pub(crate) fn pack_stream_metadata(stream: &StreamV2) -> u128 {
    let status = if stream.cancelled {
        STATUS_CANCELLED
    } else if stream.is_pending {
        STATUS_PENDING
    } else {
        STATUS_ACTIVE
    };

    let mut packed = status as u128;
    packed |= ((stream.penalty_bps as u128) & PENALTY_BPS_MASK) << PENALTY_BPS_SHIFT;
    packed |= ((stream.curve_type as u128) & CURVE_TYPE_MASK) << CURVE_TYPE_SHIFT;

    if stream.migrated_from_v1 {
        packed |= 1u128 << MIGRATED_FROM_V1_SHIFT;
    }
    if stream.yield_enabled {
        packed |= 1u128 << YIELD_ENABLED_SHIFT;
    }
    if stream.is_recurrent {
        packed |= 1u128 << IS_RECURRENT_SHIFT;
    }

    packed
        | ((stream.cancellation_type as u128 & CANCELLATION_TYPE_MASK) << CANCELLATION_TYPE_SHIFT)
}

pub(crate) fn unpack_stream_metadata(packed: u128) -> (u8, u32, u8, bool, bool, bool, u32) {
    let status = (packed & STATUS_MASK) as u8;
    let penalty_bps = ((packed >> PENALTY_BPS_SHIFT) & PENALTY_BPS_MASK) as u32;
    let curve_type = ((packed >> CURVE_TYPE_SHIFT) & CURVE_TYPE_MASK) as u8;
    let migrated_from_v1 = ((packed >> MIGRATED_FROM_V1_SHIFT) & 1) != 0;
    let yield_enabled = ((packed >> YIELD_ENABLED_SHIFT) & 1) != 0;
    let is_recurrent = ((packed >> IS_RECURRENT_SHIFT) & 1) != 0;
    let cancellation_type = ((packed >> CANCELLATION_TYPE_SHIFT) & CANCELLATION_TYPE_MASK) as u32;

    (
        status,
        penalty_bps,
        curve_type,
        migrated_from_v1,
        yield_enabled,
        is_recurrent,
        cancellation_type,
    )
}

/// Persist a V2 stream in persistent storage and set its initial TTL.
pub fn set_stream(env: &Env, stream_id: u64, stream: &StreamV2) {
    let key = DataKeyV2::Stream(stream_id);
    let stored = StoredStreamV2 {
        sender: stream.sender.clone(),
        receiver: stream.receiver.clone(),
        beneficiary: stream.beneficiary.clone(),
        token: stream.token.clone(),
        total_amount: stream.total_amount,
        start_time: stream.start_time,
        end_time: stream.end_time,
        cliff_time: stream.cliff_time,
        withdrawn_amount: stream.withdrawn_amount,
        packed_meta: pack_stream_metadata(stream),
        v1_stream_id: stream.v1_stream_id,
        step_duration: stream.step_duration,
        multiplier_bps: stream.multiplier_bps,
        vault_address: stream.vault_address.clone(),
        cycle_duration: stream.cycle_duration,
        yield_recipient: stream.yield_recipient,
        split_address: stream.split_address.clone(),
        split_bps: stream.split_bps,
    };
    env.storage().persistent().set(&key, &stored);
    env.storage()
        .persistent()
        .extend_ttl(&key, STREAM_TTL_THRESHOLD, STREAM_TTL_BUMP);
}

/// Read a V2 stream from persistent storage.
pub fn get_stream(env: &Env, stream_id: u64) -> Option<StreamV2> {
    let key = DataKeyV2::Stream(stream_id);
    let stream: Option<StoredStreamV2> = env.storage().persistent().get(&key);
    if stream.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, STREAM_TTL_THRESHOLD, STREAM_TTL_BUMP);
    }
    stream.map(|stored| {
        let (
            status,
            penalty_bps,
            curve_type,
            migrated_from_v1,
            yield_enabled,
            is_recurrent,
            cancellation_type,
        ) = unpack_stream_metadata(stored.packed_meta);

        StreamV2 {
            sender: stored.sender,
            receiver: stored.receiver,
            beneficiary: stored.beneficiary,
            token: stored.token,
            total_amount: stored.total_amount,
            start_time: stored.start_time,
            end_time: stored.end_time,
            cliff_time: stored.cliff_time,
            withdrawn_amount: stored.withdrawn_amount,
            cancelled: status == STATUS_CANCELLED,
            migrated_from_v1,
            v1_stream_id: stored.v1_stream_id,
            step_duration: stored.step_duration,
            multiplier_bps: stored.multiplier_bps,
            vault_address: stored.vault_address,
            yield_enabled,
            is_pending: status == STATUS_PENDING,
            is_recurrent,
            cycle_duration: stored.cycle_duration,
            cancellation_type,
            penalty_bps,
            yield_recipient: stored.yield_recipient,
            split_address: stored.split_address,
            split_bps: stored.split_bps,
            curve_type: curve_type as u32,
        }
    })
}

// ----------------------------------------------------------------
// instance() helpers — Analytics
// ----------------------------------------------------------------

/// Update TVL and unique user count.
pub fn update_stats(env: &Env, amount: i128, sender: &Address, receiver: &Address) {
    // Update TVL
    let tvl: i128 = env.storage().instance().get(&V2_TVL).unwrap_or(0);
    env.storage().instance().set(&V2_TVL, &(tvl + amount));

    // Update User Count
    let mut user_count: u32 = env.storage().instance().get(&V2_USER_COUNT).unwrap_or(0);

    if !env
        .storage()
        .persistent()
        .has(&DataKeyV2::UserSeen(sender.clone()))
    {
        env.storage()
            .persistent()
            .set(&DataKeyV2::UserSeen(sender.clone()), &true);
        user_count += 1;
    }

    if !env
        .storage()
        .persistent()
        .has(&DataKeyV2::UserSeen(receiver.clone()))
    {
        env.storage()
            .persistent()
            .set(&DataKeyV2::UserSeen(receiver.clone()), &true);
        user_count += 1;
    }

    env.storage().instance().set(&V2_USER_COUNT, &user_count);
    bump_instance(env);
}

/// Retrieve all V2 summary metrics.
pub fn get_health(env: &Env) -> crate::types::ProtocolHealthV2 {
    crate::types::ProtocolHealthV2 {
        total_v2_tvl: env.storage().instance().get(&V2_TVL).unwrap_or(0),
        active_v2_users: env.storage().instance().get(&V2_USER_COUNT).unwrap_or(0),
        total_v2_streams: env.storage().instance().get(&STREAM_COUNT_V2).unwrap_or(0),
    }
}

// ----------------------------------------------------------------
// instance() helpers — Migration pause
// ----------------------------------------------------------------

/// Returns true if migration-only pause is active.
pub fn is_migration_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::MigrationPaused)
        .unwrap_or(false)
}

/// Sets the migration-only paused state.
pub fn set_migration_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&DataKeyV2::MigrationPaused, &paused);
    bump_instance(env);
}

// ----------------------------------------------------------------
// instance() helpers — Paused
// ----------------------------------------------------------------

/// Returns true if the contract is currently paused.
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::Paused)
        .unwrap_or(false)
}

/// Sets the contract's paused state.
pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKeyV2::Paused, &paused);
    bump_instance(env);
}

// ----------------------------------------------------------------
// instance() helpers — Emergency Mode (Issue #393)
// ----------------------------------------------------------------

/// Returns true if the contract is in emergency (withdraw-only) mode.
pub fn is_emergency(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::Emergency)
        .unwrap_or(false)
}

/// Sets the emergency mode state.
pub fn set_emergency(env: &Env, active: bool) {
    env.storage().instance().set(&DataKeyV2::Emergency, &active);
    bump_instance(env);
}

// ----------------------------------------------------------------
// persistent() helpers — Migration Ledger Bit-Map (Issue #399)
// ----------------------------------------------------------------

/// Returns true if `v1_stream_id` has already been migrated to V2.
pub fn is_v1_migrated(env: &Env, v1_stream_id: u64) -> bool {
    env.storage()
        .persistent()
        .get(&DataKeyV2::V1MigratedMap(v1_stream_id))
        .unwrap_or(false)
}

/// Mark `v1_stream_id` as migrated. Uses the same TTL as streams so the
/// record outlives the migration window by at least 120 days.
pub fn mark_v1_migrated(env: &Env, v1_stream_id: u64) {
    let key = DataKeyV2::V1MigratedMap(v1_stream_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, STREAM_TTL_THRESHOLD, STREAM_TTL_BUMP);
}

// ----------------------------------------------------------------
// TTL
// ----------------------------------------------------------------

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
}

/// Extend persistent TTL for each stream ID in `ids`.
/// Skips IDs that no longer exist in storage.
/// Returns the count of streams whose TTL was extended.
pub fn bump_streams_ttl(env: &Env, ids: &soroban_sdk::Vec<u64>) -> u32 {
    let mut count: u32 = 0;
    for id in ids.iter() {
        let key = DataKeyV2::Stream(id);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, STREAM_TTL_THRESHOLD, STREAM_TTL_BUMP);
            count += 1;
        }
    }
    count
}

// ----------------------------------------------------------------
// Dust threshold helpers
// ----------------------------------------------------------------

/// 10 XLM in stroops (1 XLM = 10_000_000 stroops).
pub const DEFAULT_MIN_VALUE: i128 = 100_000_000; // 10 XLM

/// Set a per-asset minimum stream amount. Admin-only enforcement is
/// done in the contract layer.
pub fn set_min_value(env: &Env, asset: &Address, min: i128) {
    env.storage()
        .instance()
        .set(&DataKeyV2::MinValue(asset.clone()), &min);
    bump_instance(env);
}

/// Return the minimum stream amount for `asset`, defaulting to 10 XLM.
pub fn get_min_value(env: &Env, asset: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKeyV2::MinValue(asset.clone()))
        .unwrap_or(DEFAULT_MIN_VALUE)
}

// ----------------------------------------------------------------
// Time-locked operations
// ----------------------------------------------------------------

pub fn schedule_op(env: &Env, op: &crate::types::Operation, execution_time: u64) {
    env.storage()
        .instance()
        .set(&DataKeyV2::ScheduledOp(op.clone()), &execution_time);
    bump_instance(env);
}

pub fn get_scheduled_op_time(env: &Env, op: &crate::types::Operation) -> Option<u64> {
    env.storage()
        .instance()
        .get(&DataKeyV2::ScheduledOp(op.clone()))
}

pub fn clear_op(env: &Env, op: &crate::types::Operation) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::ScheduledOp(op.clone()));
    bump_instance(env);
}

// ----------------------------------------------------------------
// Protocol fee helpers
// ----------------------------------------------------------------

/// Set the protocol treasury address. Admin-only enforcement is in lib.rs.
pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKeyV2::Treasury, treasury);
    bump_instance(env);
}

/// Return the treasury address, if configured.
pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::Treasury)
}

/// Set the protocol fee in basis points. Admin-only enforcement is in lib.rs.
pub fn set_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKeyV2::FeeBps, &bps);
    bump_instance(env);
}

/// Return the current fee BPS (default 0 = no fee).
pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKeyV2::FeeBps)
        .unwrap_or(0)
}

/// Set the tiered fee configuration.
pub fn set_fee_tiers(env: &Env, tiers: Vec<crate::FeeTier>) {
    env.storage().instance().set(&DataKeyV2::FeeTiers, &tiers);
    bump_instance(env);
}

/// Return the tiered fee configuration, if set.
pub fn get_fee_tiers(env: &Env) -> Option<Vec<crate::FeeTier>> {
    env.storage().instance().get(&DataKeyV2::FeeTiers)
}

/// Add `amount` to the pending fee balance for `(recipient, token)`.
pub fn add_pending_fees(env: &Env, recipient: &Address, token: &Address, amount: i128) {
    let key = DataKeyV2::PendingFees(recipient.clone(), token.clone());
    let current: i128 = env.storage().instance().get(&key).unwrap_or(0);
    env.storage().instance().set(&key, &(current + amount));
    bump_instance(env);
}

/// Return the accumulated pending fee balance for `(recipient, token)`.
pub fn get_pending_fees(env: &Env, recipient: &Address, token: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKeyV2::PendingFees(recipient.clone(), token.clone()))
        .unwrap_or(0)
}

/// Clear the pending fee balance for `(recipient, token)` after withdrawal.
pub fn clear_pending_fees(env: &Env, recipient: &Address, token: &Address) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::PendingFees(recipient.clone(), token.clone()));
    bump_instance(env);
}

pub fn add_to_whitelist(env: &Env, asset: &Address) {
    env.storage()
        .instance()
        .set(&DataKeyV2::WhitelistedAsset(asset.clone()), &true);
    bump_instance(env);
}

pub fn remove_from_whitelist(env: &Env, asset: &Address) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::WhitelistedAsset(asset.clone()));
    bump_instance(env);
}

pub fn is_asset_whitelisted(env: &Env, asset: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::WhitelistedAsset(asset.clone()))
        .unwrap_or(false)
}

// ----------------------------------------------------------------
// Pending Stream Requests (Multi-sig Approval)
// ----------------------------------------------------------------

/// Stored pending stream request waiting for multi-sig approval
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingStreamRequest {
    pub args: crate::types::StreamArgs,
    pub approvals: u32,
    pub approved_by: Vec<Address>,
    pub created_at: u64,
    pub executed: bool,
}

/// Generate the next pending stream request ID
pub fn next_stream_request_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKeyV2::StreamRequestCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKeyV2::StreamRequestCount, &(id + 1));
    id
}

/// Store a pending stream request
pub fn set_pending_stream_request(env: &Env, request_id: u64, request: &PendingStreamRequest) {
    env.storage()
        .instance()
        .set(&DataKeyV2::PendingStreamRequest(request_id), request);
    bump_instance(env);
}

/// Retrieve a pending stream request
pub fn get_pending_stream_request(env: &Env, request_id: u64) -> Option<PendingStreamRequest> {
    env.storage()
        .instance()
        .get(&DataKeyV2::PendingStreamRequest(request_id))
}

/// Remove a pending stream request after execution or cancellation
pub fn remove_pending_stream_request(env: &Env, request_id: u64) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::PendingStreamRequest(request_id));
    bump_instance(env);
}

// ----------------------------------------------------------------
// Compliance Oracle helpers (Issue #412)
// ----------------------------------------------------------------

/// Set the compliance oracle address. Admin-only enforcement is in lib.rs.
pub fn set_compliance_oracle(env: &Env, oracle: &Address) {
    env.storage()
        .instance()
        .set(&DataKeyV2::ComplianceOracle, oracle);
    bump_instance(env);
}

/// Return the compliance oracle address, if configured.
pub fn get_compliance_oracle(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::ComplianceOracle)
}

// ----------------------------------------------------------------
// Issue #602 — Protocol Fee Capture for split_multi_asset
// ----------------------------------------------------------------

pub fn set_fee_collector(env: &Env, collector: &Address) {
    env.storage()
        .instance()
        .set(&DataKeyV2::FeeCollector, collector);
    bump_instance(env);
}

pub fn get_fee_collector(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::FeeCollector)
}

pub fn set_fee_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKeyV2::FeeToken, token);
    bump_instance(env);
}

pub fn get_fee_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::FeeToken)
}

/// Fee charged per recipient (in fee_token base units). Default 0 = no fee.
pub fn set_fee_per_recipient(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKeyV2::FeePerRecipient, &amount);
    bump_instance(env);
}

pub fn get_fee_per_recipient(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKeyV2::FeePerRecipient)
        .unwrap_or(0)
}

// ----------------------------------------------------------------
// Issue #632 — Gas Tank Buffer
// ----------------------------------------------------------------

/// Set a sender's internal gas buffer (in stroops).
pub fn set_gas_buffer(env: &Env, sender: &Address, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKeyV2::GasBuffer(sender.clone()), &amount);
    bump_instance(env);
}

/// Get a sender's internal gas buffer (in stroops).
pub fn get_gas_buffer(env: &Env, sender: &Address) -> i128 {
    env.storage()
        .instance()
        .get(&DataKeyV2::GasBuffer(sender.clone()))
        .unwrap_or(0)
}

// ----------------------------------------------------------------
// Issue #603 — Reentrancy Guard
// ----------------------------------------------------------------

/// Returns true if the contract is currently inside a multi-transfer execution.
pub fn is_locked(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::Locked)
        .unwrap_or(false)
}

/// Acquire the reentrancy lock. Returns Err if already locked.
pub fn acquire_lock(env: &Env) -> Result<(), crate::contracterror::Error> {
    if is_locked(env) {
        return Err(crate::contracterror::Error::Reentrant);
    }
    env.storage().instance().set(&DataKeyV2::Locked, &true);
    Ok(())
}

/// Release the reentrancy lock.
pub fn release_lock(env: &Env) {
    env.storage().instance().remove(&DataKeyV2::Locked);
}

// ----------------------------------------------------------------
// Issue #378 — Streaming Swap (DEX Integration)
// ----------------------------------------------------------------

use crate::types::DexPoolInfo;

/// Set the default DEX contract address for swap operations.
pub fn set_dex_address(env: &Env, dex_address: &Address) {
    env.storage()
        .instance()
        .set(&DataKeyV2::DexAddress, dex_address);
    bump_instance(env);
}

/// Get the configured DEX contract address, if set.
pub fn get_dex_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::DexAddress)
}

/// Set a specific DEX pool configuration for an asset pair.
pub fn set_dex_pool(env: &Env, token_in: &Address, token_out: &Address, pool_info: &DexPoolInfo) {
    env.storage().instance().set(
        &DataKeyV2::DexPool(token_in.clone(), token_out.clone()),
        pool_info,
    );
    bump_instance(env);
}

/// Get the DEX pool configuration for an asset pair.
pub fn get_dex_pool(env: &Env, token_in: &Address, token_out: &Address) -> Option<DexPoolInfo> {
    env.storage()
        .instance()
        .get(&DataKeyV2::DexPool(token_in.clone(), token_out.clone()))
}

/// Enable or disable swap streaming globally.
pub fn set_swap_enabled(env: &Env, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKeyV2::SwapEnabled, &enabled);
    bump_instance(env);
}

/// Check if swap streaming is enabled globally.
pub fn is_swap_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKeyV2::SwapEnabled)
        .unwrap_or(false) // Default to disabled
}

// ----------------------------------------------------------------
// Issue #377 — Push-Pull Rate Re-balancing
// ----------------------------------------------------------------

/// TTL for pending rate updates (7 days in seconds)
pub const RATE_UPDATE_TTL: u64 = 604_800;

/// Set a pending rate update for a stream.
pub fn set_pending_rate_update(env: &Env, stream_id: u64, update: &PendingRateUpdate) {
    env.storage()
        .instance()
        .set(&DataKeyV2::PendingRateUpdate(stream_id), update);
    env.storage().instance().set(
        &DataKeyV2::PendingRateUpdateExpiry(stream_id),
        &update.proposed_at,
    );
    bump_instance(env);
}

/// Get a pending rate update for a stream.
pub fn get_pending_rate_update(env: &Env, stream_id: u64) -> Option<PendingRateUpdate> {
    env.storage()
        .instance()
        .get(&DataKeyV2::PendingRateUpdate(stream_id))
}

/// Get the expiry timestamp of a pending rate update.
pub fn get_pending_rate_update_expiry(env: &Env, stream_id: u64) -> Option<u64> {
    env.storage()
        .instance()
        .get(&DataKeyV2::PendingRateUpdateExpiry(stream_id))
}

/// Check if a pending rate update has expired.
pub fn is_pending_rate_update_expired(env: &Env, stream_id: u64) -> bool {
    if let Some(expiry) = get_pending_rate_update_expiry(env, stream_id) {
        let now = env.ledger().timestamp();
        return now > expiry.saturating_add(RATE_UPDATE_TTL);
    }
    true // If no expiry found, consider it expired
}

/// Remove a pending rate update for a stream.
pub fn remove_pending_rate_update(env: &Env, stream_id: u64) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::PendingRateUpdate(stream_id));
    env.storage()
        .instance()
        .remove(&DataKeyV2::PendingRateUpdateExpiry(stream_id));
}

/// Check if a pending rate update exists for a stream.
pub fn has_pending_rate_update(env: &Env, stream_id: u64) -> bool {
    env.storage()
        .instance()
        .has(&DataKeyV2::PendingRateUpdate(stream_id))
}

// ----------------------------------------------------------------
// Emergency Recovery Multi-Sig (Issue: Security Critical)
// ----------------------------------------------------------------

/// 7-day grace period before recovery funds can move.
pub const RECOVERY_GRACE_PERIOD: u64 = 604_800;

/// Persist the recovery council and required threshold.
pub fn set_recovery_council(env: &Env, council: &Vec<Address>, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKeyV2::RecoveryCouncil, council);
    env.storage()
        .instance()
        .set(&DataKeyV2::RecoveryThreshold, &threshold);
    bump_instance(env);
}

/// Return the recovery council, if configured.
pub fn get_recovery_council(env: &Env) -> Option<Vec<Address>> {
    env.storage().instance().get(&DataKeyV2::RecoveryCouncil)
}

/// Return the recovery threshold (default 1).
pub fn get_recovery_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKeyV2::RecoveryThreshold)
        .unwrap_or(1)
}

/// Record the timestamp when recovery was initiated.
pub fn set_recovery_initiated_at(env: &Env, ts: u64) {
    env.storage()
        .instance()
        .set(&DataKeyV2::RecoveryInitiatedAt, &ts);
    // Reset approvals list on new initiation.
    let empty: Vec<Address> = Vec::new(env);
    env.storage()
        .instance()
        .set(&DataKeyV2::RecoveryApprovals, &empty);
    bump_instance(env);
}

/// Return the timestamp when recovery was initiated, if any.
pub fn get_recovery_initiated_at(env: &Env) -> Option<u64> {
    env.storage()
        .instance()
        .get(&DataKeyV2::RecoveryInitiatedAt)
}

/// Clear recovery state (after execution or cancellation).
pub fn clear_recovery(env: &Env) {
    env.storage()
        .instance()
        .remove(&DataKeyV2::RecoveryInitiatedAt);
    env.storage()
        .instance()
        .remove(&DataKeyV2::RecoveryApprovals);
    bump_instance(env);
}

/// Return the list of addresses that have approved the current recovery.
pub fn get_recovery_approvals(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKeyV2::RecoveryApprovals)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append `signer` to the recovery approvals list.
pub fn add_recovery_approval(env: &Env, signer: &Address) {
    let mut approvals = get_recovery_approvals(env);
    approvals.push_back(signer.clone());
    env.storage()
        .instance()
        .set(&DataKeyV2::RecoveryApprovals, &approvals);
    bump_instance(env);
}

// ----------------------------------------------------------------
// Contract lifecycle helpers (#934)
// ----------------------------------------------------------------

/// 90 days in seconds.
pub const CLAIM_WINDOW_SECS: u64 = 90 * 24 * 60 * 60;

pub fn set_contract_state(env: &Env, state: &crate::types::ContractState) {
    env.storage()
        .instance()
        .set(&DataKeyV2::ContractState, state);
    bump_instance(env);
}

pub fn get_contract_state(env: &Env) -> crate::types::ContractState {
    env.storage()
        .instance()
        .get(&DataKeyV2::ContractState)
        .unwrap_or(crate::types::ContractState::Active)
}

pub fn set_claim_deadline(env: &Env, deadline: u64) {
    env.storage()
        .instance()
        .set(&DataKeyV2::ClaimDeadline, &deadline);
    bump_instance(env);
}

pub fn get_claim_deadline(env: &Env) -> Option<u64> {
    env.storage().instance().get(&DataKeyV2::ClaimDeadline)
}

// ----------------------------------------------------------------
// Sanctions oracle helpers (#937)
// ----------------------------------------------------------------

pub fn set_oracle_address(env: &Env, oracle: &Address) {
    env.storage()
        .instance()
        .set(&DataKeyV2::OracleAddress, oracle);
    bump_instance(env);
}

pub fn get_oracle_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::OracleAddress)
}

pub fn append_event_log(env: &Env, stream_id: u64, data: Bytes) {
    let key = DataKeyV2::EventLog(stream_id);
    let mut log: Vec<Bytes> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if log.len() >= 50 {
        log.remove(0);
    }
    log.push_back(data);
    env.storage().persistent().set(&key, &log);
}

pub fn get_event_log(env: &Env, stream_id: u64) -> Vec<Bytes> {
    let key = DataKeyV2::EventLog(stream_id);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_dao_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKeyV2::DaoToken, token);
    bump_instance(env);
}

pub fn get_dao_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKeyV2::DaoToken)
}

pub fn set_voting_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&DataKeyV2::VotingThreshold, &threshold);
    bump_instance(env);
}

pub fn get_voting_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKeyV2::VotingThreshold)
        .unwrap_or(0)
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingTreasurySplit {
    pub initiator: Address,
    pub token: Address,
    pub recipients: Vec<Address>,
    pub amounts: Vec<i128>,
    pub unlock_time: u64,
    pub executed: bool,
}

pub fn next_treasury_split_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKeyV2::TreasurySplitCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKeyV2::TreasurySplitCount, &(id + 1));
    bump_instance(env);
    id
}

pub fn set_pending_treasury_split(env: &Env, split_id: u64, split: &PendingTreasurySplit) {
    env.storage()
        .instance()
        .set(&DataKeyV2::PendingTreasurySplit(split_id), split);
    bump_instance(env);
}

pub fn get_pending_treasury_split(env: &Env, split_id: u64) -> Option<PendingTreasurySplit> {
    env.storage()
        .instance()
        .get(&DataKeyV2::PendingTreasurySplit(split_id))
}
