//! Core functionality sanity tests.
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Events as _, Ledger as _};

#[test]
fn test_initialize() {
    let f = setup();
    // Admin is stored after initialization.
    assert!(client(&f.env, &f.contract).next_stream_id() >= 1);
}

#[test]
fn test_initialize_is_idempotent() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    // Second initialize must be rejected.
    assert!(c.try_initialize(&f.admin).is_err());
}

#[test]
fn test_create_and_get_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    let s = c.get_stream(&id);
    assert_eq!(s.total_amount, 1_000_000i128);
    assert_eq!(s.state, STATE_ACTIVE);
}

#[test]
fn test_get_time_remaining_and_percentage() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    
    // Set current ledger time
    f.env.ledger().with_mut(|li| {
        li.timestamp = 100;
    });

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &100u64, // start time
        &1100u64, // end time (1000s duration)
        &CURVE_LINEAR,
        &false,
        &None,
    );

    // Initial state: 0 seconds elapsed
    assert_eq!(c.get_time_remaining_seconds(&id), 1000);
    assert_eq!(c.get_time_remaining_days(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 0);

    // Mid stream: 500 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 600;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 500);
    assert_eq!(c.get_completion_percentage(&id), 5000); // 50%

    // Near end: 999 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 1099;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 1);
    assert_eq!(c.get_completion_percentage(&id), 9990); // 99.9%

    // Stream finished: 1000 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 1100;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 10000); // 100%

    // Stream past end: 2000 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 2100;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 10000); // 100%
}

// ---------------------------------------------------------------------------
// Multi-signature proposal tests (issue #1459)
// ---------------------------------------------------------------------------

#[test]
fn test_create_proposal() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &2u32,
        &(now + 10_000),
    );
    assert_eq!(id, 1);

    let p = c.get_proposal(&id);
    assert_eq!(p.sender, f.sender);
    assert_eq!(p.receiver, f.receiver);
    assert_eq!(p.token, f.token);
    assert_eq!(p.total_amount, 5_000i128);
    assert_eq!(p.required_approvals, 2u32);
    assert!(!p.executed);
    assert_eq!(p.approvers.len(), 0);
}

#[test]
fn test_get_proposal_query() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &1u32,
        &(now + 10_000),
    );

    let p = c.get_proposal(&id);
    assert_eq!(p.deadline, now + 10_000);
    assert_eq!(p.start_time, now);
    assert_eq!(p.end_time, now + 1_000);
    assert_eq!(p.required_approvals, 1u32);
}

#[test]
fn test_single_approval() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &3u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin);

    let p = c.get_proposal(&id);
    assert_eq!(p.approvers.len(), 1);
    assert!(!p.executed);
}

#[test]
fn test_multiple_approvals_below_threshold() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &3u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin);
    c.approve_proposal(&id, &f.pauser);

    let p = c.get_proposal(&id);
    assert_eq!(p.approvers.len(), 2);
    assert!(!p.executed);
}

#[test]
fn test_threshold_execution() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &2u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin);
    c.approve_proposal(&id, &f.pauser); // threshold reached -> auto-execute

    let p = c.get_proposal(&id);
    assert!(p.executed);
    assert_eq!(p.approvers.len(), 2);
}

#[test]
fn test_execution_creates_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &2u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin);
    c.approve_proposal(&id, &f.pauser);

    // A stream is created immediately with the proposal's parameters.
    assert_eq!(c.next_stream_id(), 2);
    let stream = c.get_stream(&1);
    assert_eq!(stream.sender, f.sender);
    assert_eq!(stream.receiver, f.receiver);
    assert_eq!(stream.token, f.token);
    assert_eq!(stream.total_amount, 5_000i128);
    assert_eq!(stream.state, STATE_ACTIVE);
}

#[test]
fn test_proposal_expired_returns_error() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &1u32,
        &(now + 100),
    );

    f.env.ledger().with_mut(|li| {
        li.timestamp = now + 101;
    });

    assert_eq!(
        c.try_approve_proposal(&id, &f.admin),
        Err(Ok(Error::ProposalExpired))
    );
}

#[test]
fn test_duplicate_approval_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &2u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin);

    assert_eq!(
        c.try_approve_proposal(&id, &f.admin),
        Err(Ok(Error::AlreadyApproved))
    );
}

#[test]
fn test_approve_executed_proposal_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &1u32,
        &(now + 10_000),
    );
    c.approve_proposal(&id, &f.admin); // 1-of-1 executes immediately

    assert_eq!(
        c.try_approve_proposal(&id, &f.pauser),
        Err(Ok(Error::ProposalAlreadyExecuted))
    );
}

#[test]
fn test_approve_proposal_not_found() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(
        c.try_approve_proposal(&999u64, &f.admin),
        Err(Ok(Error::ProposalNotFound))
    );
}

#[test]
fn test_invalid_approval_threshold_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    assert_eq!(
        c.try_create_proposal(
            &f.sender,
            &f.receiver,
            &f.token,
            &5_000i128,
            &now,
            &(now + 1_000),
            &0u32,
            &(now + 10_000),
        ),
        Err(Ok(Error::InvalidApprovalThreshold))
    );
}

#[test]
fn test_proposal_approval_events_emitted() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let now = f.env.ledger().timestamp();

    let id = c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &5_000i128,
        &now,
        &(now + 1_000),
        &2u32,
        &(now + 10_000),
    );
    // `create_proposal` publishes a proposal event.
    assert_eq!(f.env.events().all().len(), 1);

    c.approve_proposal(&id, &f.admin);
    // `approve_proposal` publishes an approval event.
    assert_eq!(f.env.events().all().len(), 1);
}

// Count query tests (issue #1474)
// ---------------------------------------------------------------------------

#[test]
fn test_get_active_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_active_streams_count(), 0);

    let id1 = c.create_stream(
// ---------------------------------------------------------------------------
// Milestone-based vesting tests (issue #1462)
// ---------------------------------------------------------------------------

/// Builds a `Vec<Milestone>` from `(timestamp, cumulative_percentage_bps)` pairs.
fn milestone_schedule(env: &Env, entries: &[(u64, u32)]) -> Vec<Milestone> {
    let mut v = Vec::new(env);
    for &(timestamp, percentage) in entries {
        v.push_back(Milestone {
            timestamp,
            percentage,
        });
    }
    v
}

/// A standard 3-checkpoint schedule: 25% at 90, 50% at 180, 100% at 365.
fn standard_schedule(env: &Env) -> Vec<Milestone> {
    milestone_schedule(env, &[(90, 2_500), (180, 5_000), (365, 10_000)])
}

#[test]
fn test_milestone_simple_schedule() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_active_streams_count(), 1);

    let _id2 = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &2_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_active_streams_count(), 2);

    c.pause_stream(&id1, &f.sender);
    assert_eq!(c.get_active_streams_count(), 1);

    c.cancel_stream(&id1, &f.sender);
    assert_eq!(c.get_active_streams_count(), 1); // id2 is still active
}

#[test]
fn test_get_user_active_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_user_active_streams_count(&f.sender), 0);

    c.create_stream(
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    let s = c.get_stream(&id);
    assert_eq!(s.curve_type, CURVE_MILESTONE);
    assert!(s.milestones.is_some());
}

#[test]
fn test_milestone_before_first_returns_zero() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    f.env.ledger().with_mut(|li| li.timestamp = 89);
    assert_eq!(c.get_unlocked_amount(&id), 0);

    f.env.ledger().with_mut(|li| li.timestamp = 0);
    assert_eq!(c.get_unlocked_amount(&id), 0);
}

#[test]
fn test_milestone_at_milestone_returns_cumulative_percentage() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_active_streams_count(&f.sender), 1);
    assert_eq!(c.get_user_active_streams_count(&f.receiver), 1);

    c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &2_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_active_streams_count(&f.sender), 2);
    assert_eq!(c.get_user_active_streams_count(&f.receiver), 2);
}

#[test]
fn test_get_total_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_total_streams_count(), 0);

    c.create_stream(
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    f.env.ledger().with_mut(|li| li.timestamp = 90);
    assert_eq!(c.get_unlocked_amount(&id), 250_000);

    f.env.ledger().with_mut(|li| li.timestamp = 180);
    assert_eq!(c.get_unlocked_amount(&id), 500_000);

    f.env.ledger().with_mut(|li| li.timestamp = 365);
    assert_eq!(c.get_unlocked_amount(&id), 1_000_000);
}

#[test]
fn test_milestone_between_milestones_holds_previous_percentage() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_total_streams_count(), 1);

    c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &2_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_total_streams_count(), 2);
}

#[test]
fn test_get_user_total_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_user_total_streams_count(&f.sender), 0);

    c.create_stream(
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    // Between the 25% (t=90) and 50% (t=180) checkpoints, only 25% is unlocked.
    f.env.ledger().with_mut(|li| li.timestamp = 150);
    assert_eq!(c.get_unlocked_amount(&id), 250_000);

    // Between the 50% (t=180) and 100% (t=365) checkpoints, 50% is unlocked.
    f.env.ledger().with_mut(|li| li.timestamp = 300);
    assert_eq!(c.get_unlocked_amount(&id), 500_000);
}

#[test]
fn test_milestone_after_last_returns_total() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_total_streams_count(&f.sender), 1);
    assert_eq!(c.get_user_total_streams_count(&f.receiver), 1);

    c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &2_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_total_streams_count(&f.sender), 2);
    assert_eq!(c.get_user_total_streams_count(&f.receiver), 2);
}

#[test]
fn test_get_paused_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_paused_streams_count(), 0);

        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    f.env.ledger().with_mut(|li| li.timestamp = 365);
    assert_eq!(c.get_unlocked_amount(&id), 1_000_000);

    // The contract's end-of-term fast path also kicks in beyond end_time.
    f.env.ledger().with_mut(|li| li.timestamp = 10_000);
    assert_eq!(c.get_unlocked_amount(&id), 1_000_000);
}

#[test]
fn test_milestone_invalid_order_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    // Timestamps must be strictly ascending; 180 then 90 is not.
    let bad_schedule = milestone_schedule(&f.env, &[(180, 5_000), (90, 10_000)]);

    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_MILESTONE,
            &false,
            &Some(bad_schedule),
        ),
        Err(Ok(Error::InvalidMilestones))
    );
}

#[test]
fn test_milestone_invalid_percentages_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Non-ascending percentages.
    let non_ascending = milestone_schedule(&f.env, &[(90, 5_000), (180, 2_500), (365, 10_000)]);
    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_MILESTONE,
            &false,
            &Some(non_ascending),
        ),
        Err(Ok(Error::InvalidMilestonePercentages))
    );

    // Final percentage must equal 10,000 bps (100%).
    let incomplete = milestone_schedule(&f.env, &[(90, 2_500), (180, 5_000), (365, 9_000)]);
    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_MILESTONE,
            &false,
            &Some(incomplete),
        ),
        Err(Ok(Error::InvalidMilestonePercentages))
    );
}

#[test]
fn test_milestone_withdrawal() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_paused_streams_count(), 0);

    c.pause_stream(&id, &f.sender);
    assert_eq!(c.get_paused_streams_count(), 1);

    c.resume_stream(&id, &f.sender);
    assert_eq!(c.get_paused_streams_count(), 0);
}

#[test]
fn test_get_user_paused_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_user_paused_streams_count(&f.sender), 0);

        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    f.env.ledger().with_mut(|li| li.timestamp = 90);
    let first = c.withdraw(&id, &f.receiver);
    assert_eq!(first, 250_000);

    // No new milestone reached yet -> nothing further to withdraw.
    let second = c.withdraw(&id, &f.receiver);
    assert_eq!(second, 0);

    // Reaching the 50% checkpoint makes the remaining 25% withdrawable.
    f.env.ledger().with_mut(|li| li.timestamp = 180);
    let third = c.withdraw(&id, &f.receiver);
    assert_eq!(third, 250_000);

    let s = c.get_stream(&id);
    assert_eq!(s.withdrawn_amount, 500_000);
}

#[test]
fn test_milestone_cancellation() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_paused_streams_count(&f.sender), 0);
    assert_eq!(c.get_user_paused_streams_count(&f.receiver), 0);

    c.pause_stream(&id, &f.sender);
    assert_eq!(c.get_user_paused_streams_count(&f.sender), 1);
    assert_eq!(c.get_user_paused_streams_count(&f.receiver), 1);

    c.resume_stream(&id, &f.sender);
    assert_eq!(c.get_user_paused_streams_count(&f.sender), 0);
    assert_eq!(c.get_user_paused_streams_count(&f.receiver), 0);
}

#[test]
fn test_get_closed_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_closed_streams_count(), 0);

    let id = c.create_stream(
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );

    f.env.ledger().with_mut(|li| li.timestamp = 90);
    let withdrawn = c.withdraw(&id, &f.receiver);
    assert_eq!(withdrawn, 250_000);

    c.cancel_stream(&id, &f.sender);

    // Once cancelled, the receiver can no longer withdraw further milestone
    // unlocks, even though later milestones would otherwise have been reached.
    f.env.ledger().with_mut(|li| li.timestamp = 365);
    assert!(c.try_withdraw(&id, &f.receiver).is_err());

    let s = c.get_stream(&id);
    assert_eq!(s.state, STATE_CLOSED);
    assert_eq!(s.withdrawn_amount, 250_000);
}

#[test]
fn test_milestone_vs_linear_comparison() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let schedule = standard_schedule(&f.env);
    let milestone_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_MILESTONE,
        &false,
        &Some(schedule),
    );
    let linear_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_closed_streams_count(), 0);

    c.cancel_stream(&id, &f.sender);
    assert_eq!(c.get_closed_streams_count(), 1);
}

#[test]
fn test_get_user_closed_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_user_closed_streams_count(&f.sender), 0);

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );

    assert_eq!(c.get_user_closed_streams_count(&f.sender), 0);
    assert_eq!(c.get_user_closed_streams_count(&f.receiver), 0);

    c.cancel_stream(&id, &f.sender);
    assert_eq!(c.get_user_closed_streams_count(&f.sender), 1);
    assert_eq!(c.get_user_closed_streams_count(&f.receiver), 1);
        &365u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );

    // At t=100, linear vesting has unlocked ~27.4% continuously, while
    // milestone vesting is still capped at the 25% checkpoint reached at t=90.
    f.env.ledger().with_mut(|li| li.timestamp = 100);
    let milestone_unlocked = c.get_unlocked_amount(&milestone_id);
    let linear_unlocked = c.get_unlocked_amount(&linear_id);
    assert_eq!(milestone_unlocked, 250_000);
    assert!(linear_unlocked > milestone_unlocked);

    // Both fully unlock by the shared end_time.
    f.env.ledger().with_mut(|li| li.timestamp = 365);
    assert_eq!(c.get_unlocked_amount(&milestone_id), 1_000_000);
    assert_eq!(c.get_unlocked_amount(&linear_id), 1_000_000);
}

#[test]
fn test_milestone_curve_requires_schedule() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_MILESTONE,
            &false,
            &None,
        ),
        Err(Ok(Error::InvalidMilestones))
    );
}

#[test]
fn test_non_milestone_curve_rejects_schedule() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let schedule = standard_schedule(&f.env);

    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &Some(schedule),
        ),
        Err(Ok(Error::InvalidMilestones))
    );
}

#[test]
fn test_milestone_end_time_before_last_milestone_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    // Last milestone at t=365, but end_time only reaches t=200.
    let schedule = standard_schedule(&f.env);

    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &200u64,
            &CURVE_MILESTONE,
            &false,
            &Some(schedule),
        ),
        Err(Ok(Error::InvalidTimeRange))
    );
}
