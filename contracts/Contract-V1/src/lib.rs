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
//!
//! See `contracts/Contract-V1/README.md` for the full specification.

pub mod math;

#[cfg(test)]
mod bench_test;

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
const HISTORY: Symbol = symbol_short!("HISTORY");
const METADATA: Symbol = symbol_short!("METADATA");

// Stream state
pub const STATE_ACTIVE: u32 = 0;
pub const STATE_PAUSED: u32 = 1;
pub const STATE_CLOSED: u32 = 2;

// Vesting curve
pub const CURVE_LINEAR: u32 = 0;
pub const CURVE_EXP: u32 = 1;

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
    StreamEnded = 33,
    MetadataLabelTooLong = 34,
    TooManyTags = 35,
    TagTooLong = 36,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------
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
pub struct StreamMetadataUpdatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub timestamp: u64,
}

// // Minimal token interface used by `withdraw`.
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

// Minimal token interface used by `withdraw`.
#[contractclient(name = "TokenClient")]
pub trait Token {
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
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
        if env.storage().instance().get::<_, Address>(&ADMIN).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&NEXTID, &1u64);
        env.storage().instance().set(&NEXTPROPOSAL, &1u64);
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
    ) -> Result<u64, Error> {
        sender.require_auth();
        create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            total_amount,
            start_time,
            end_time,
            curve_type,
            is_soulbound,
        )
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
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
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
            .get::<_, u64>(&NEXTPROPOSAL)
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

        let mut proposals = get_proposals(&env);
        proposals.set(id, proposal);
        env.storage().persistent().set(&PROPOSALS, &proposals);
        env.storage().instance().set(&NEXTPROPOSAL, &next);

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

    /// Withdraw the currently unlocked amount to the receiver.
    /// Returns the amount withdrawn.
    pub fn withdraw(env: Env, stream_id: u64, receiver: Address) -> Result<i128, Error> {
        receiver.require_auth();

        // Re-entrancy guard (temporary storage lock).
        if env.storage().temporary().get::<_, bool>(&LOCK).unwrap_or(false) {
            return Err(Error::Reentrancy);
        }
        env.storage().temporary().set(&LOCK, &true);

        let result = withdraw_inner(&env, stream_id, &receiver);

        env.storage().temporary().remove(&LOCK);
        result
    }

    /// Cancel a stream. Only the sender may cancel; refunds are implicit because
    /// the receiver can no longer withdraw unlocked funds once the stream is closed.
    pub fn cancel_stream(env: Env, stream_id: u64, sender: Address) -> Result<(), Error> {
        sender.require_auth();
        let mut stream = get_stream(&env, stream_id)?;
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }
        stream.state = STATE_CLOSED;
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Cancelled);
        Ok(())
    }

    /// Pause an active stream. Only the sender may pause.
    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
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

    // ------------------------- Administrative -------------------------

    pub fn grant_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        if role > ROLE_TREASURY {
            return Err(Error::InvalidRole);
        }
        grant_role_internal(env, &account, role);
        Ok(())
    }

    pub fn revoke_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        revoke_role_internal(&env, &account, role);
        Ok(())
    }

    pub fn restrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut r = get_restricted(&env);
        r.set(target, true);
        env.storage().instance().set(&RESTRICT, &r);
        Ok(())
    }

    pub fn unrestrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut r = get_restricted(&env);
        r.remove(target);
        env.storage().instance().set(&RESTRICT, &r);
        Ok(())
    }

    pub fn pause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage().instance().set(&PAUSED, &true);
        Ok(())
    }

    pub fn unpause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage().instance().set(&PAUSED, &false);
        Ok(())
    }

    pub fn is_address_restricted(env: Env, target: Address) -> bool {
        is_restricted(&env, &target)
    }

    /// Return the next stream id that will be allocated (for testing/inspection).
    
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
        let streams = get_streams(&env);
        let stream = streams.get(stream_id).ok_or(Error::StreamNotFound)?;
        if stream.sender != sender { return Err(Error::Unauthorized); }
        if stream.state == STATE_CLOSED { return Err(Error::StreamEnded); }
        if label.len() > 64 { return Err(Error::MetadataLabelTooLong); }
        if tags.len() > 5 { return Err(Error::TooManyTags); }
        for i in 0..tags.len() {
            if let Some(tag) = tags.get(i) {
                if tag.len() > 32 { return Err(Error::TagTooLong); }
            }
        }
        let mut metadata_map: Map<u64, StreamMetadata> = env
            .storage()
            .persistent()
            .get(&METADATA)
            .unwrap_or(Map::new(&env));
        metadata_map.set(stream_id, StreamMetadata { label, tags, external_ref });
        env.storage().persistent().set(&METADATA, &metadata_map);
        env.events().publish(
            (symbol_short!("meta_upd"), sender.clone()),
            StreamMetadataUpdatedEvent { stream_id, sender, timestamp: env.ledger().timestamp() },
        );
        Ok(())
    }
pub fn next_stream_id(env: Env) -> u64 {
        env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1)
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
        let next_id = env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1);
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

    // ------------------------- History Queries -------------------------

    pub fn get_stream_history(env: Env, stream_id: u64) -> Vec<StreamEvent> {
        get_history(&env).get(stream_id).unwrap_or(Vec::new(&env))
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

fn get_streams(env: &Env) -> Map<u64, Stream> {
    env.storage()
        .persistent()
        .get(&STREAMS)
        .unwrap_or(Map::new(env))
}

fn get_stream(env: &Env, stream_id: u64) -> Result<Stream, Error> {
    get_streams(env)
        .get(stream_id)
        .ok_or(Error::StreamNotFound)
}

fn save_stream(env: &Env, stream: &Stream) {
    let mut streams = get_streams(env);
    streams.set(stream.id, stream.clone());
    env.storage().persistent().set(&STREAMS, &streams);
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
) -> Result<u64, Error> {
    if is_contract_paused(env) {
        return Err(Error::ContractPaused);
    }
    if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
        return Err(Error::Unauthorized);
    }
    if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP {
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

    let mut next = env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1);
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
    };

    let mut streams = get_streams(env);
    streams.set(id, stream);
    env.storage().persistent().set(&STREAMS, &streams);

    add_user_stream(env, sender, id);
    add_user_stream(env, receiver, id);

    env.storage().instance().set(&NEXTID, &next);

    // Record history event
    add_history(env, id, StreamAction::Created);

    Ok(id)
}

fn get_proposals(env: &Env) -> Map<u64, StreamProposal> {
    env.storage()
        .persistent()
        .get(&PROPOSALS)
        .unwrap_or(Map::new(env))
}

fn get_proposal(env: &Env, proposal_id: u64) -> Result<StreamProposal, Error> {
    get_proposals(env)
        .get(proposal_id)
        .ok_or(Error::ProposalNotFound)
}

fn save_proposal(env: &Env, proposal_id: u64, proposal: &StreamProposal) {
    let mut proposals = get_proposals(env);
    proposals.set(proposal_id, proposal.clone());
    env.storage().persistent().set(&PROPOSALS, &proposals);
}

fn get_user_streams(env: &Env, user: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&USTREAMS)
        .unwrap_or(Map::new(env))
        .get(user.clone())
        .unwrap_or(Vec::new(env))
}

fn add_user_stream(env: &Env, user: &Address, id: u64) {
    let mut all: Map<Address, Vec<u64>> = env
        .storage()
        .persistent()
        .get(&USTREAMS)
        .unwrap_or(Map::new(env));
    let mut list = all.get(user.clone()).unwrap_or(Vec::new(env));
    list.push_back(id);
    all.set(user.clone(), list);
    env.storage().persistent().set(&USTREAMS, &all);
}

fn is_contract_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

fn get_history(env: &Env) -> Map<u64, Vec<StreamEvent>> {
    env.storage()
        .persistent()
        .get(&HISTORY)
        .unwrap_or(Map::new(env))
}

fn add_history(env: &Env, stream_id: u64, action: StreamAction) {
    let mut history = get_history(env);
    let mut events = history.get(stream_id).unwrap_or(Vec::new(env));
    events.push_back(StreamEvent {
        stream_id,
        action,
        timestamp: env.ledger().timestamp(),
    });
    history.set(stream_id, events);
    env.storage().persistent().set(&HISTORY, &history);
}

fn is_restricted(env: &Env, target: &Address) -> bool {
    get_restricted(env).get(target.clone()).unwrap_or(false)
}

fn get_restricted(env: &Env) -> Map<Address, bool> {
    env.storage().instance().get(&RESTRICT).unwrap_or(Map::new(env))
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
        .get(&ROLES)
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
        .get(&ROLES)
        .unwrap_or(Map::new(&env));
    let mut list = roles.get(account.clone()).unwrap_or(Vec::new(&env));
    if !list.contains(role) {
        list.push_back(role);
    }
    roles.set(account.clone(), list);
    env.storage().instance().set(&ROLES, &roles);
}

fn revoke_role_internal(env: &Env, account: &Address, role: u32) {
    let mut roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&ROLES)
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
        env.storage().instance().set(&ROLES, &roles);
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
