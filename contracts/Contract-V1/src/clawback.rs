//! Clawback module for the StellarStream contract.
//!
//! Clawback allows a stream's **sender** to request the return of tokens that
//! have already been withdrawn by the receiver. This is an opt-in feature:
//! the stream must have been created with `clawback_enabled = true`.
//!
//! # Lifecycle
//!
//! ```text
//! sender calls request_clawback  →  Pending
//!   receiver OR governance calls approve_clawback  →  Approved
//!     anyone calls execute_clawback  →  Executed
//! ```
//!
//! A request that expires before reaching `Approved` is moved to `Rejected`.
//!
//! # Approval rules
//!
//! A clawback moves to `Approved` when **either**:
//! 1. The stream's receiver calls `approve_clawback`, **or**
//! 2. Enough governance addresses have approved (`approvals.len() >= required_approvals`).
//!
//! # Constraints
//!
//! - `amount` ≤ `stream.withdrawn_amount`
//! - `amount` > 0
//! - The stream must have `clawback_enabled = true`
//! - Only the stream's sender may call `request_clawback`

use soroban_sdk::{symbol_short, token, Address, Env, String, Vec};

use crate::{
    storage::{extend_clawback_ttl, DataKey},
    ClawbackApprovedEvent, ClawbackExecutedEvent, ClawbackRequest, ClawbackRequestedEvent,
    ClawbackStatus, Error, Stream, STATE_FROZEN,
};

/// Clawbacks move funds between the disputing parties, so they are blocked on
/// frozen streams and while an arbitration is in flight (issue #1471).
fn require_stream_operable(env: &Env, stream: &Stream) -> Result<(), Error> {
    if stream.state == STATE_FROZEN {
        return Err(Error::StreamFrozen);
    }
    crate::require_no_open_dispute(env, stream.id)
}

// ---------------------------------------------------------------------------
// Public functions (called from lib.rs #[contractimpl])
// ---------------------------------------------------------------------------

/// Creates a new clawback request for `amount` tokens from stream `stream_id`.
pub fn request_clawback(
    env: &Env,
    stream_id: u64,
    sender: &Address,
    amount: i128,
    reason: String,
    required_approvals: u32,
    expires_at: u64,
) -> Result<u64, Error> {
    let stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .ok_or(Error::StreamNotFound)?;

    if stream.sender != *sender {
        return Err(Error::Unauthorized);
    }
    if !stream.clawback_enabled {
        return Err(Error::ClawbackNotEnabled);
    }
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if amount > stream.withdrawn_amount {
        return Err(Error::ClawbackExceedsWithdrawn);
    }
    require_stream_operable(env, &stream)?;

    let clawback_id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ClawbackCounter)
        .unwrap_or(0);
    let next_id = clawback_id + 1;

    let req = ClawbackRequest {
        clawback_id,
        stream_id,
        amount,
        reason: reason.clone(),
        approved_by_receiver: false,
        approvals: Vec::new(env),
        required_approvals,
        status: ClawbackStatus::Pending,
        created_at: env.ledger().timestamp(),
        expires_at,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Clawback(clawback_id), &req);
    extend_clawback_ttl(env, clawback_id);
    env.storage()
        .instance()
        .set(&DataKey::ClawbackCounter, &next_id);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("request")),
        ClawbackRequestedEvent {
            clawback_id,
            stream_id,
            sender: sender.clone(),
            amount,
            reason,
            timestamp: env.ledger().timestamp(),
        },
    );

    Ok(clawback_id)
}

/// Approves a pending clawback request.
pub fn approve_clawback(env: &Env, clawback_id: u64, approver: &Address) -> Result<(), Error> {
    let mut req: ClawbackRequest = env
        .storage()
        .persistent()
        .get(&DataKey::Clawback(clawback_id))
        .ok_or(Error::ClawbackNotFound)?;

    if req.status == ClawbackStatus::Executed {
        return Err(Error::ClawbackAlreadyExecuted);
    }
    if req.status == ClawbackStatus::Rejected {
        return Err(Error::ClawbackRejected);
    }

    let now = env.ledger().timestamp();
    if req.expires_at != 0 && now > req.expires_at {
        req.status = ClawbackStatus::Rejected;
        env.storage()
            .persistent()
            .set(&DataKey::Clawback(clawback_id), &req);
        return Err(Error::ClawbackExpired);
    }

    let stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(req.stream_id))
        .ok_or(Error::StreamNotFound)?;

    require_stream_operable(env, &stream)?;

    let mut by_receiver = false;

    if *approver == stream.receiver {
        if req.approved_by_receiver {
            return Err(Error::ClawbackAlreadyApproved);
        }
        req.approved_by_receiver = true;
        by_receiver = true;
    } else {
        if *approver == stream.sender {
            return Err(Error::Unauthorized);
        }
        if req.approvals.contains(approver.clone()) {
            return Err(Error::ClawbackAlreadyApproved);
        }
        req.approvals.push_back(approver.clone());
    }

    let approval_count = req.approvals.len();
    if req.approved_by_receiver || approval_count >= req.required_approvals {
        req.status = ClawbackStatus::Approved;
    }

    env.storage()
        .persistent()
        .set(&DataKey::Clawback(clawback_id), &req);
    extend_clawback_ttl(env, clawback_id);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("approve")),
        ClawbackApprovedEvent {
            clawback_id,
            approver: approver.clone(),
            by_receiver,
            approval_count,
            timestamp: now,
        },
    );

    Ok(())
}

/// Executes an approved clawback, transferring tokens from receiver back to sender.
pub fn execute_clawback(env: &Env, clawback_id: u64) -> Result<(), Error> {
    let mut req: ClawbackRequest = env
        .storage()
        .persistent()
        .get(&DataKey::Clawback(clawback_id))
        .ok_or(Error::ClawbackNotFound)?;

    if req.status == ClawbackStatus::Executed {
        return Err(Error::ClawbackAlreadyExecuted);
    }
    if req.status == ClawbackStatus::Rejected {
        return Err(Error::ClawbackRejected);
    }

    let now = env.ledger().timestamp();
    if req.expires_at != 0 && now > req.expires_at {
        req.status = ClawbackStatus::Rejected;
        env.storage()
            .persistent()
            .set(&DataKey::Clawback(clawback_id), &req);
        return Err(Error::ClawbackExpired);
    }

    if req.status != ClawbackStatus::Approved {
        return Err(Error::ClawbackInsufficientApprovals);
    }

    let stream: Stream = env
        .storage()
        .persistent()
        .get(&DataKey::Stream(req.stream_id))
        .ok_or(Error::StreamNotFound)?;

    // An approved clawback transfers funds between the parties; block it
    // while an arbitration decides the stream's fate (issue #1471).
    require_stream_operable(env, &stream)?;

    // Checks-effects-interactions: mark executed before the token transfer.
    req.status = ClawbackStatus::Executed;
    env.storage()
        .persistent()
        .set(&DataKey::Clawback(clawback_id), &req);
    extend_clawback_ttl(env, clawback_id);

    token::Client::new(env, &stream.token).transfer(&stream.receiver, &stream.sender, &req.amount);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("execute")),
        ClawbackExecutedEvent {
            clawback_id,
            stream_id: req.stream_id,
            amount: req.amount,
            sender: stream.sender.clone(),
            timestamp: now,
        },
    );

    Ok(())
}

/// Fetches a clawback request by ID. Returns `None` if it does not exist.
pub fn get_clawback_request(env: &Env, clawback_id: u64) -> Option<ClawbackRequest> {
    env.storage()
        .persistent()
        .get(&DataKey::Clawback(clawback_id))
}
