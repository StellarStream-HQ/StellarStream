//! Integration tests for the dispute resolution framework (issue #1471).
//!
//! Coverage mirrors the acceptance criteria: raising by both parties,
//! arbitrator-only voting, threshold auto-execution of every resolution
//! type, blocked operations during an open dispute, insufficient votes,
//! rejection majorities, dispute closure, expired disputes, arbitrator
//! assignment (kept separate from Admin), events, and balance updates.
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};

/// Reason string shared by most tests.
fn reason(env: &Env) -> String {
    String::from_str(env, "deliverables rejected")
}

/// Standard fixture pre-loaded with `n` arbitrators enrolled by the admin.
struct Arbitrated {
    f: Fixture,
    arbs: Vec<Address>,
}

fn setup_arbitrated(n: u32) -> Arbitrated {
    let f = setup();
    let mut arbs = Vec::new(&f.env);
    for _ in 0..n {
        let a = Address::generate(&f.env);
        client(&f.env, &f.contract).grant_role(&f.admin, &a, &ROLE_ARBITRATOR);
        arbs.push_back(a);
    }
    Arbitrated { f, arbs }
}

impl Arbitrated {
    fn stream_args(&self) -> (i128, u64, u64) {
        (1_000_000, 0, 1_000)
    }

    /// Create a `stream_args` linear stream; `clawback` enables clawback.
    fn create_stream_with(&self, clawback: bool) -> u64 {
        let (amount, start, end) = self.stream_args();
        client(&self.f.env, &self.f.contract).create_stream(
            &self.f.sender,
            &self.f.receiver,
            &self.f.token,
            &amount,
            &start,
            &end,
            &CURVE_LINEAR,
            &false,
            &clawback,
            &None,
        )
    }

    /// Default 1_000_000 unit linear stream over [0, 1000).
    fn create_stream(&self) -> u64 {
        self.create_stream_with(false)
    }

    fn raise_by_sender(&self, stream_id: u64, resolution: DisputeResolution) -> u64 {
        client(&self.f.env, &self.f.contract).raise_dispute(
            &stream_id,
            &self.f.sender,
            &reason(&self.f.env),
            &resolution,
        )
    }

    fn raise_by_receiver(&self, stream_id: u64, resolution: DisputeResolution) -> u64 {
        client(&self.f.env, &self.f.contract).raise_dispute(
            &stream_id,
            &self.f.receiver,
            &reason(&self.f.env),
            &resolution,
        )
    }

    fn arb(&self, i: u32) -> Address {
        self.arbs.get(i).unwrap()
    }
}

// ---------------------------------------------------------------------------
// Raising disputes
// ---------------------------------------------------------------------------

#[test]
fn test_sender_can_raise_dispute() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    let dispute_id = x.raise_by_sender(id, DisputeResolution::CancelStream);

    let d = client(&x.f.env, &x.f.contract).get_dispute(&dispute_id);
    assert_eq!(d.id, dispute_id);
    assert_eq!(d.stream_id, id);
    assert_eq!(d.raised_by, x.f.sender);
    assert_eq!(d.proposed_resolution, DisputeResolution::CancelStream);
    assert!(!d.resolved);
    // Voting window is exactly DISPUTE_VOTING_PERIOD_SECS.
    assert_eq!(d.deadline, d.created_at + DISPUTE_VOTING_PERIOD_SECS);
    // The stream now reports an active dispute.
    assert!(client(&x.f.env, &x.f.contract).has_active_dispute(&id));
}

#[test]
fn test_receiver_can_raise_dispute() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    let dispute_id = x.raise_by_receiver(id, DisputeResolution::FreezeStream);

    let d = client(&x.f.env, &x.f.contract).get_dispute(&dispute_id);
    assert_eq!(d.raised_by, x.f.receiver);
}

#[test]
fn test_outsider_cannot_raise_dispute() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    let outsider = Address::generate(&x.f.env);

    let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
        &id,
        &outsider,
        &reason(&x.f.env),
        &DisputeResolution::CancelStream,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_only_one_open_dispute_per_stream() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::CancelStream);

    // A second dispute (by either party) is refused while one is open.
    let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
        &id,
        &x.f.receiver,
        &reason(&x.f.env),
        &DisputeResolution::FreezeStream,
    );
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));

    // Resolve by rejection majority; a fresh dispute may then be raised.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &false);
    let second = x.raise_by_receiver(id, DisputeResolution::PayReceiver(100));
    assert_eq!(second, 1);
}

#[test]
fn test_raise_error_paths() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    // Unknown stream.
    let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
        &999,
        &x.f.sender,
        &reason(&x.f.env),
        &DisputeResolution::CancelStream,
    );
    assert_eq!(result, Err(Ok(Error::StreamNotFound)));

    // Closed stream.
    client(&x.f.env, &x.f.contract).cancel_stream(&id, &x.f.sender);
    let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
        &id,
        &x.f.sender,
        &reason(&x.f.env),
        &DisputeResolution::CancelStream,
    );
    assert_eq!(result, Err(Ok(Error::StreamEnded)));
}

#[test]
fn test_monetary_resolution_amounts_validated() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    // Above the remaining balance.
    let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
        &id,
        &x.f.sender,
        &reason(&x.f.env),
        &DisputeResolution::PayReceiver(2_000_000),
    );
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));

    // Zero and negative amounts are meaningless resolutions.
    for bad in [0i128, -5] {
        let result = client(&x.f.env, &x.f.contract).try_raise_dispute(
            &id,
            &x.f.sender,
            &reason(&x.f.env),
            &DisputeResolution::RefundSender(bad),
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }
}

// ---------------------------------------------------------------------------
// Voting authorization
// ---------------------------------------------------------------------------

#[test]
fn test_only_arbitrators_can_vote() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::CancelStream);

    // A stranger has no vote…
    let stranger = Address::generate(&x.f.env);
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &stranger, &true);
    assert_eq!(result, Err(Ok(Error::NotArbitrator)));

    // …and crucially neither does the admin: arbitration authority must be
    // granted explicitly and is never implied by ROLE_ADMIN.
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &x.f.admin, &true);
    assert_eq!(result, Err(Ok(Error::NotArbitrator)));

    // Unknown dispute ids are rejected for legitimate arbitrators too.
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&42, &x.arb(0), &true);
    assert_eq!(result, Err(Ok(Error::DisputeNotFound)));
}

#[test]
fn test_arbitrator_cannot_vote_twice() {
    let x = setup_arbitrated(2);
    let id = x.create_stream();

    // Threshold 2 keeps the dispute open after the first vote…
    client(&x.f.env, &x.f.contract).set_arbitration_threshold(&x.f.admin, &2);

    x.raise_by_receiver(id, DisputeResolution::CancelStream);
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &x.arb(0), &false);
    assert_eq!(result, Err(Ok(Error::AlreadyVoted)));

    // …and the recorded vote is the first one (still 1 approval).
    let d = client(&x.f.env, &x.f.contract).get_dispute(&0);
    assert_eq!(d.arbitrator_votes.len(), 1);
}

#[test]
fn test_finalized_disputes_refuse_votes() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::FreezeStream);

    // Threshold execution finalizes the dispute.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &x.arb(0), &false);
    assert_eq!(result, Err(Ok(Error::DisputeNotOpen)));
}

// ---------------------------------------------------------------------------
// Threshold auto-execution of every resolution type
// ---------------------------------------------------------------------------

#[test]
fn test_threshold_executes_pay_receiver() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    x.raise_by_sender(id, DisputeResolution::PayReceiver(400_000));
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    // Balance update: the forced payout is folded into the stream exactly
    // like a withdrawal, then the stream is closed.
    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.withdrawn_amount, 400_000i128);
    assert_eq!(s.state, STATE_CLOSED);

    // Lock released, dispute finalized.
    assert!(!client(&x.f.env, &x.f.contract).has_active_dispute(&id));
    let d = client(&x.f.env, &x.f.contract).get_dispute(&0);
    assert!(d.resolved);

    // Nothing further can be withdrawn from the closed stream.
    x.f.env.ledger().with_mut(|li| li.timestamp = 2_000);
    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn test_threshold_executes_refund_sender() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    x.raise_by_receiver(id, DisputeResolution::RefundSender(1_000_000));
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    // Stream closed with nothing paid out; remainder stays with the sender
    // (pull-based custody) and can never be streamed again.
    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_CLOSED);
    assert_eq!(s.withdrawn_amount, 0i128);

    x.f.env.ledger().with_mut(|li| li.timestamp = 5_000);
    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn test_threshold_executes_freeze_stream() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    x.raise_by_sender(id, DisputeResolution::FreezeStream);
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_FROZEN);

    // Every state-changing operation is blocked on a frozen stream.
    x.f.env.ledger().with_mut(|li| li.timestamp = 500);

    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::StreamFrozen)));

    let result = client(&x.f.env, &x.f.contract).try_pause_stream(&id, &x.f.sender);
    assert_eq!(result, Err(Ok(Error::StreamFrozen)));

    let result = client(&x.f.env, &x.f.contract).try_cancel_stream(&id, &x.f.sender);
    assert_eq!(result, Err(Ok(Error::StreamFrozen)));

    // The dispute itself is finalized, so no new dispute may be raised…
    assert!(!client(&x.f.env, &x.f.contract).has_active_dispute(&id));

    // …and batch withdrawals hit the frozen guard too.
    let mut ids = Vec::new(&x.f.env);
    ids.push_back(id);
    let result = client(&x.f.env, &x.f.contract).try_batch_withdraw(&ids, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::StreamFrozen)));
}

#[test]
fn test_threshold_executes_cancel_stream() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    x.raise_by_receiver(id, DisputeResolution::CancelStream);
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);

    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_CLOSED);

    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn test_multi_member_threshold_auto_execution() {
    let x = setup_arbitrated(3);
    let id = x.create_stream();
    client(&x.f.env, &x.f.contract).set_arbitration_threshold(&x.f.admin, &2);

    x.raise_by_sender(id, DisputeResolution::PayReceiver(250_000));

    // First approval: below threshold, nothing executes.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);
    assert!(!client(&x.f.env, &x.f.contract).get_dispute(&0).resolved);
    assert_eq!(
        client(&x.f.env, &x.f.contract).get_stream(&id).state,
        STATE_ACTIVE
    );

    // Second approval reaches the threshold: automatic execution.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(1), &true);
    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_CLOSED);
    assert_eq!(s.withdrawn_amount, 250_000i128);

    // The remaining arbitrator's vote is refused after finalization.
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &x.arb(2), &false);
    assert_eq!(result, Err(Ok(Error::DisputeNotOpen)));
}

// ---------------------------------------------------------------------------
// Blocked operations while a dispute is open
// ---------------------------------------------------------------------------

#[test]
fn test_withdraw_blocked_during_dispute() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::PayReceiver(100_000));

    x.f.env.ledger().with_mut(|li| li.timestamp = 500);
    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));
}

#[test]
fn test_batch_and_pause_cancel_blocked_during_dispute() {
    let x = setup_arbitrated(2);
    let id = x.create_stream();
    x.raise_by_receiver(id, DisputeResolution::CancelStream);

    // Batch withdrawal fail-fast.
    let mut ids = Vec::new(&x.f.env);
    ids.push_back(id);
    let result = client(&x.f.env, &x.f.contract).try_batch_withdraw(&ids, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));

    // Sender-side controls are blocked as well: they would change the
    // balance a pending resolution acts upon.
    let result = client(&x.f.env, &x.f.contract).try_pause_stream(&id, &x.f.sender);
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));

    let result = client(&x.f.env, &x.f.contract).try_cancel_stream(&id, &x.f.sender);
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));
}

#[test]
fn test_clawback_blocked_during_dispute() {
    let x = setup_arbitrated(1);
    let id = x.create_stream_with(true);

    // Withdraw first so a clawback would be possible in the absence of the
    // dispute guard.
    x.f.env.ledger().with_mut(|li| li.timestamp = 500);
    client(&x.f.env, &x.f.contract).withdraw(&id, &x.f.receiver);

    let expires = x.f.env.ledger().timestamp() + 1_000;
    x.raise_by_sender(id, DisputeResolution::CancelStream);

    let result = client(&x.f.env, &x.f.contract).try_request_clawback(
        &id,
        &x.f.sender,
        &10,
        &reason(&x.f.env),
        &1u32,
        &expires,
    );
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));
}

// ---------------------------------------------------------------------------
// Insufficient votes, rejections and expiry
// ---------------------------------------------------------------------------

#[test]
fn test_insufficient_votes_keep_stream_locked() {
    let x = setup_arbitrated(3);
    let id = x.create_stream();
    client(&x.f.env, &x.f.contract).set_arbitration_threshold(&x.f.admin, &3);

    x.raise_by_sender(id, DisputeResolution::PayReceiver(100));
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(1), &true);

    // Two of three approvals: not executed yet…
    let d = client(&x.f.env, &x.f.contract).get_dispute(&0);
    assert!(!d.resolved);

    // …and the stream stays locked for the whole window.
    x.f.env.ledger().with_mut(|li| li.timestamp = 500);
    let result = client(&x.f.env, &x.f.contract).try_withdraw(&id, &x.f.receiver);
    assert_eq!(result, Err(Ok(Error::DisputeAlreadyOpen)));

    // The deciding vote executes immediately.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(2), &true);
    assert_eq!(
        client(&x.f.env, &x.f.contract).get_stream(&id).state,
        STATE_CLOSED
    );
}

#[test]
fn test_rejection_majority_finalizes_without_execution() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::FreezeStream);

    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &false);

    let d = client(&x.f.env, &x.f.contract).get_dispute(&0);
    assert!(d.resolved);

    // Nothing executed; the stream is operable again.
    x.f.env.ledger().with_mut(|li| li.timestamp = 500);
    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_ACTIVE);
    let withdrawn = client(&x.f.env, &x.f.contract).withdraw(&id, &x.f.receiver);
    assert!(withdrawn > 0);
}

#[test]
fn test_votes_after_deadline_rejected() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::CancelStream);

    // One tick past the deadline votes are refused…
    x.f.env
        .ledger()
        .with_mut(|li| li.timestamp = DISPUTE_VOTING_PERIOD_SECS + 1);
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &x.arb(0), &true);
    assert_eq!(result, Err(Ok(Error::DisputeExpired)));

    // …exactly at the deadline they are still accepted.
    x.f.env
        .ledger()
        .with_mut(|li| li.timestamp = DISPUTE_VOTING_PERIOD_SECS);
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);
    assert!(client(&x.f.env, &x.f.contract).get_dispute(&0).resolved);
}

#[test]
fn test_close_expired_dispute_lifts_lock() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();
    x.raise_by_receiver(id, DisputeResolution::FreezeStream);

    // Permissionless closure before the deadline is refused.
    let result = client(&x.f.env, &x.f.contract).try_close_expired_dispute(&0);
    assert_eq!(result, Err(Ok(Error::DisputeNotOpen)));

    // After the deadline anyone may close it; nothing executes.
    x.f.env
        .ledger()
        .with_mut(|li| li.timestamp = DISPUTE_VOTING_PERIOD_SECS + 10);
    client(&x.f.env, &x.f.contract).close_expired_dispute(&0);

    let d = client(&x.f.env, &x.f.contract).get_dispute(&0);
    assert!(d.resolved);

    let s = client(&x.f.env, &x.f.contract).get_stream(&id);
    assert_eq!(s.state, STATE_ACTIVE);

    // The lock is lifted and the stream is operable again.
    x.f.env.ledger().with_mut(|li| {
        li.timestamp = DISPUTE_VOTING_PERIOD_SECS + 500;
    });
    let withdrawn = client(&x.f.env, &x.f.contract).withdraw(&id, &x.f.receiver);
    assert!(withdrawn > 0);

    // Double closure is refused.
    let result = client(&x.f.env, &x.f.contract).try_close_expired_dispute(&0);
    assert_eq!(result, Err(Ok(Error::DisputeNotOpen)));
}

// ---------------------------------------------------------------------------
// Arbitrator assignment, threshold configuration, events
// ---------------------------------------------------------------------------

#[test]
fn test_arbitrator_assignment_lifecycle() {
    let x = setup_arbitrated(1);
    let newcomer = Address::generate(&x.f.env);

    // Assignment is admin-only.
    let result = client(&x.f.env, &x.f.contract).try_add_arbitrator(&newcomer, &newcomer);
    assert_eq!(result, Err(Ok(Error::NotAdmin)));

    // The admin grants the role; roster introspection agrees.
    client(&x.f.env, &x.f.contract).add_arbitrator(&x.f.admin, &newcomer);
    assert!(client(&x.f.env, &x.f.contract).is_arbitrator(&newcomer));
    assert_eq!(client(&x.f.env, &x.f.contract).get_arbitrators().len(), 2);

    // Revocation is immediate: a revoked arbitrator cannot vote.
    let id = x.create_stream();
    x.raise_by_sender(id, DisputeResolution::CancelStream);
    client(&x.f.env, &x.f.contract).remove_arbitrator(&x.f.admin, &newcomer);
    assert!(!client(&x.f.env, &x.f.contract).is_arbitrator(&newcomer));
    let result = client(&x.f.env, &x.f.contract).try_vote_on_dispute(&0, &newcomer, &true);
    assert_eq!(result, Err(Ok(Error::NotArbitrator)));
}

#[test]
fn test_threshold_configuration() {
    let x = setup_arbitrated(1);
    let stranger = Address::generate(&x.f.env);

    // Admin-only.
    let result = client(&x.f.env, &x.f.contract).try_set_arbitration_threshold(&stranger, &2);
    assert_eq!(result, Err(Ok(Error::NotAdmin)));

    // Zero and above-ceiling values are refused.
    let result = client(&x.f.env, &x.f.contract).try_set_arbitration_threshold(&x.f.admin, &0);
    assert_eq!(result, Err(Ok(Error::InvalidApprovalThreshold)));
    let result = client(&x.f.env, &x.f.contract)
        .try_set_arbitration_threshold(&x.f.admin, &(MAX_ARBITRATION_THRESHOLD + 1));
    assert_eq!(result, Err(Ok(Error::InvalidApprovalThreshold)));

    // Defaults to 1 until configured.
    assert_eq!(
        client(&x.f.env, &x.f.contract).get_arbitration_threshold(),
        DEFAULT_ARBITRATION_THRESHOLD
    );
    client(&x.f.env, &x.f.contract)
        .set_arbitration_threshold(&x.f.admin, &MAX_ARBITRATION_THRESHOLD);
    assert_eq!(
        client(&x.f.env, &x.f.contract).get_arbitration_threshold(),
        MAX_ARBITRATION_THRESHOLD
    );
}

#[test]
fn test_dispute_events_emitted() {
    let x = setup_arbitrated(1);
    let id = x.create_stream();

    x.raise_by_sender(id, DisputeResolution::PayReceiver(100_000));
    // Raising publishes a `dispute/raised` event in its invocation.
    assert!(
        !x.f.env.events().all().is_empty(),
        "raising a dispute must publish an event"
    );

    // A finalizing vote publishes both `dispute/voted` and `dispute/resolved`
    // within the same invocation.
    client(&x.f.env, &x.f.contract).vote_on_dispute(&0, &x.arb(0), &true);
    assert!(
        x.f.env.events().all().len() >= 2,
        "a finalizing vote must publish vote + resolution events; got: {}",
        x.f.env.events().all().len()
    );
}
