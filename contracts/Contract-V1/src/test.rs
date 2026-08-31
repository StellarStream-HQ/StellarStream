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

// ============================================================
// Initialization Tests
// ============================================================

#[test]
fn test_initialize_success() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);

    // Initialize the contract
    let result = ctx.client.try_initialize(&admin);
    assert!(result.is_ok());

    // Verify admin was set correctly
    let stored_admin = ctx.client.get_admin();
    assert_eq!(stored_admin, admin);
}

#[test]
fn test_initialize_prevents_double_initialization() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);

    // First initialization should succeed
    let result = ctx.client.try_initialize(&admin);
    assert!(result.is_ok());

    // Second initialization should fail with AlreadyInitialized error
    let second_result = ctx.client.try_initialize(&admin);
    assert!(second_result.is_err());
    assert_eq!(second_result.err(), Some(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_stores_admin_address() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);

    let _ = ctx.client.initialize(&admin);

    // Verify admin address is stored and retrievable
    let stored_admin = ctx.client.get_admin();
    assert_eq!(stored_admin, admin);
}

#[test]
fn test_initialize_grants_all_roles_to_admin() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);

    let _ = ctx.client.initialize(&admin);

    // Verify admin has SuperAdmin role
    let has_super_admin = ctx.client.check_role(&admin, &Role::SuperAdmin);
    assert!(has_super_admin);

    // Verify admin has Guardian role
    let has_guardian = ctx.client.check_role(&admin, &Role::Guardian);
    assert!(has_guardian);

    // Verify admin has FinancialOperator role
    let has_financial_operator = ctx.client.check_role(&admin, &Role::FinancialOperator);
    assert!(has_financial_operator);
}

#[test]
fn test_initialize_requires_auth() {
    let env = Env::default();
    // NOTE: Not calling env.mock_all_auths() to test actual auth
    
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    
    // This should fail because auth is not mocked and admin hasn't actually signed
    let result = client.try_initialize(&admin);
    assert!(result.is_err());
}

#[test]
fn test_initialize_different_admin_after_failed_attempt() {
    let ctx = setup_test();
    let admin1 = Address::generate(&ctx.env);
    let admin2 = Address::generate(&ctx.env);

    // First initialization succeeds
    let _ = ctx.client.initialize(&admin1);

    // Second initialization with different admin should fail
    let result = ctx.client.try_initialize(&admin2);
    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(Error::AlreadyInitialized)));

    // Verify original admin is still set
    let stored_admin = ctx.client.get_admin();
    assert_eq!(stored_admin, admin1);
}

#[test]
fn test_initialize_extends_storage_ttl() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);

    // Initialize the contract
    let _ = ctx.client.initialize(&admin);

    // Note: TTL extension verification in unit tests is limited
    // as we can't directly inspect TTL values in the test environment.
    // This test ensures the function completes without panicking.
    // Full TTL verification requires integration tests on testnet.
    
    // Verify initialization succeeded by checking admin
    let stored_admin = ctx.client.get_admin();
    assert_eq!(stored_admin, admin);
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &365u64,
        &CURVE_MILESTONE,
        &false,
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
        &false,
        &Some(schedule),
    );
    let linear_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
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
            &false,
            &Some(schedule),
        ),
        Err(Ok(Error::InvalidTimeRange))
    );
}
// Count query tests (issue #1474)
// ---------------------------------------------------------------------------

#[test]
fn test_get_active_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_active_streams_count(), 0);

    let id1 = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &false,
        &None,
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
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &false,
        &None,
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
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &false,
        &None,
    );

    assert_eq!(c.get_total_streams_count(), 2);
}

#[test]
fn test_get_user_total_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_user_total_streams_count(&f.sender), 0);

    c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &false,
        &None,
    );

    assert_eq!(c.get_user_total_streams_count(&f.sender), 2);
    assert_eq!(c.get_user_total_streams_count(&f.receiver), 2);
}

#[test]
fn test_get_paused_streams_count() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    assert_eq!(c.get_paused_streams_count(), 0);

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
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
        &false,
        &None,
    );

    assert_eq!(c.get_user_closed_streams_count(&f.sender), 0);
    assert_eq!(c.get_user_closed_streams_count(&f.receiver), 0);

    c.cancel_stream(&id, &f.sender);
    assert_eq!(c.get_user_closed_streams_count(&f.sender), 1);
    assert_eq!(c.get_user_closed_streams_count(&f.receiver), 1);
}
// Stream history tests (issue #1468)
// ---------------------------------------------------------------------------

#[test]
fn test_stream_history_created() {
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
        &false,
        &None,
    );

    let history = c.get_stream_history(&id);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().action, StreamAction::Created);
}

#[test]
fn test_stream_history_pause_resume() {
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
        &false,
        &None,
    );

    c.pause_stream(&id, &f.sender);
    c.resume_stream(&id, &f.sender);

    let history = c.get_stream_history(&id);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().action, StreamAction::Created);
    assert_eq!(history.get(1).unwrap().action, StreamAction::Paused);
    assert_eq!(history.get(2).unwrap().action, StreamAction::Resumed);
}

#[test]
fn test_stream_history_cancel() {
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
        &false,
        &None,
    );

    c.cancel_stream(&id, &f.sender);

    let history = c.get_stream_history(&id);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().action, StreamAction::Created);
    assert_eq!(history.get(1).unwrap().action, StreamAction::Cancelled);
}

#[test]
fn test_stream_history_withdraw() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    f.env.ledger().with_mut(|li| {
        li.timestamp = 100;
    });

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &100u64,
        &1_100u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );

    f.env.ledger().with_mut(|li| {
        li.timestamp = 600;
    });

    c.withdraw(&id, &f.receiver);

    let history = c.get_stream_history(&id);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().action, StreamAction::Created);
    assert!(matches!(
        history.get(1).unwrap().action,
        StreamAction::Withdrawn(_)
    ));
}

#[test]
fn test_stream_history_ordered_by_timestamp() {
    let f = setup();
    let c = client(&f.env, &f.contract);

<<<<<<< HEAD
    f.env.ledger().with_mut(|li| {
        li.timestamp = 100;
    });
=======
    // Initialize contract with admin (grants all roles)
    let _ = ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &100, &treasury);
>>>>>>> 66f9b0a (feat(contract): implement secure contract initialization)

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &100u64,
        &1_100u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );

    f.env.ledger().with_mut(|li| {
        li.timestamp = 200;
    });
    c.pause_stream(&id, &f.sender);

    f.env.ledger().with_mut(|li| {
        li.timestamp = 300;
    });
    c.resume_stream(&id, &f.sender);

    f.env.ledger().with_mut(|li| {
        li.timestamp = 400;
    });
    c.cancel_stream(&id, &f.sender);

    let history = c.get_stream_history(&id);
    assert_eq!(history.len(), 4);

    // Check timestamps are in order
    let ts0 = history.get(0).unwrap().timestamp;
    let ts1 = history.get(1).unwrap().timestamp;
    let ts2 = history.get(2).unwrap().timestamp;
    let ts3 = history.get(3).unwrap().timestamp;
    assert!(ts0 <= ts1);
    assert!(ts1 <= ts2);
    assert!(ts2 <= ts3);
}

#[test]
fn test_stream_history_nonexistent_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let history = c.get_stream_history(&999);
    assert_eq!(history.len(), 0);
}

// ===========================================================================
// Rate calculator tests (issue #1477)
// ===========================================================================

#[test]
fn test_rate_per_second_linear_stream() {
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
        &false,
        &None,
    );
    assert_eq!(c.get_stream_rate_per_second(&id), 1_000i128);
}

#[test]
fn test_rate_per_day() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &86_400i128,
        &0u64,
        &86_400u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
    assert_eq!(c.get_stream_rate_per_second(&id), 1i128);
    assert_eq!(c.get_stream_rate_per_day(&id), 86_400i128);
}

#[test]
fn test_rate_per_month() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &2_592_000i128,
        &0u64,
        &2_592_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
    assert_eq!(c.get_stream_rate_per_second(&id), 1i128);
    assert_eq!(c.get_stream_rate_per_day(&id), 86_400i128);
    assert_eq!(c.get_stream_rate_per_month(&id), 2_592_000i128);
}

#[test]
fn test_rate_with_paused_duration() {
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
        &false,
        &None,
    );
    f.env.ledger().with_mut(|li| { li.timestamp = 100; });
    c.pause_stream(&id, &f.sender);
    f.env.ledger().with_mut(|li| { li.timestamp = 300; });
    c.resume_stream(&id, &f.sender);
    let stream = c.get_stream(&id);
    assert_eq!(stream.paused_duration, 200);
    assert_eq!(c.get_stream_rate_per_second(&id), 1_250i128);
}

#[test]
fn test_rate_closed_stream() {
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
        &false,
        &None,
    );
    c.cancel_stream(&id, &f.sender);
    assert_eq!(c.get_stream_rate_per_second(&id), 0);
    assert_eq!(c.get_stream_rate_per_day(&id), 0);
    assert_eq!(c.get_stream_rate_per_month(&id), 0);
}

#[test]
fn test_rate_not_found() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    assert!(c.try_get_stream_rate_per_second(&999).is_err());
}

#[test]
fn test_rate_consistency_across_units() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &10_000i128,
        &0u64,
        &100u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
    let per_sec = c.get_stream_rate_per_second(&id);
    let per_day = c.get_stream_rate_per_day(&id);
    let per_month = c.get_stream_rate_per_month(&id);
    assert_eq!(per_day, per_sec * 86_400);
    assert_eq!(per_month, per_sec * 2_592_000);
}

#[test]
fn test_rate_short_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &100i128,
        &0u64,
        &1u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
    assert_eq!(c.get_stream_rate_per_second(&id), 100i128);
}

// ===========================================================================
// Stream template tests (issue #1473)
// ===========================================================================

#[test]
fn test_save_and_get_template() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Monthly Payroll"),
        &f.token,
        &2_592_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    assert_eq!(id, 1);
    let tpl = c.get_template(&id);
    assert_eq!(tpl.name, String::from_str(&f.env, "Monthly Payroll"));
    assert_eq!(tpl.token, f.token);
    assert_eq!(tpl.duration, 2_592_000);
    assert_eq!(tpl.curve_type, CURVE_LINEAR);
    assert_eq!(tpl.is_soulbound, false);
}

#[test]
fn test_create_stream_from_template() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let tpl_id = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Quick Stream"),
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    f.env.ledger().with_mut(|li| { li.timestamp = 100; });
    let stream_id = c.create_stream_from_template(
        &f.sender,
        &tpl_id,
        &f.receiver,
        &500_000i128,
        &100u64,
    );
    assert_eq!(stream_id, 1);
    let stream = c.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 500_000i128);
    assert_eq!(stream.start_time, 100);
    assert_eq!(stream.end_time, 1100);
    assert_eq!(stream.state, STATE_ACTIVE);
}

#[test]
<<<<<<< HEAD
fn test_multiple_templates() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id1 = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Template A"),
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
=======
fn test_transfer_receiver() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let old_receiver = Address::generate(&ctx.env);
    let new_receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &old_receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &2,
           &None,
           &None,
    );

    ctx.client.transfer_receiver(&stream_id, &new_receiver);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &new_receiver);
    assert_eq!(withdrawn, 500);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&new_receiver), 500);
}

#[test]
#[should_panic(expected = "Unauthorized: You are not the receiver of this stream")]
fn test_old_receiver_cannot_withdraw_after_transfer() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let old_receiver = Address::generate(&ctx.env);
    let new_receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &old_receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &2,
           &None,
           &None,
    );

    ctx.client.transfer_receiver(&stream_id, &new_receiver);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &old_receiver);
}

#[test]
fn test_batch_stream_creation() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver1 = Address::generate(&ctx.env);
    let receiver2 = Address::generate(&ctx.env);
    let receiver3 = Address::generate(&ctx.env);

    let total_amount = 3000_i128;
    ctx.token.mint(&sender, &total_amount);

    let mut requests = soroban_sdk::Vec::new(&ctx.env);
    requests.push_back(StreamRequest {
        receiver: receiver1.clone(),
        amount: 1000,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: receiver2.clone(),
        amount: 1500,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: receiver3.clone(),
        amount: 500,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });

    let stream_ids = ctx
        .client
        .create_batch_streams(&sender, &ctx.token_id, &requests);

    assert_eq!(stream_ids.len(), 3);
    assert_eq!(stream_ids.get(0).unwrap(), 1);
    assert_eq!(stream_ids.get(1).unwrap(), 2);
    assert_eq!(stream_ids.get(2).unwrap(), 3);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&ctx.contract_id), 3000);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause_blocks_create_stream() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    let _ = ctx.client.initialize(&admin);
    ctx.client.set_pause(&admin, &true);

    ctx.token.mint(&sender, &1000);
    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &2,
           &None,
           &None,
    );
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause_blocks_withdraw() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    let _ = ctx.client.initialize(&admin);
    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &2,
           &None,
           &None,
    );

    ctx.client.set_pause(&admin, &true);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
#[should_panic(expected = "Fee cannot exceed 10%")]
fn test_fee_cap() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let treasury = Address::generate(&ctx.env);

    // Initialize contract with admin (grants all roles)
    let _ = ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &1001, &treasury);
}

#[test]
fn test_update_fee() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let treasury = Address::generate(&ctx.env);

    // Initialize contract with admin (grants all roles)
    let _ = ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &100, &treasury);
    ctx.client.update_fee(&admin, &200);
}

#[test]
#[should_panic(expected = "No funds available to withdraw at this time")]
fn test_cliff_blocks_withdrawal() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &500,
        &1000,
        &2,
           &None,
           &None,
    );

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 250,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
fn test_cliff_unlocks_at_cliff_time() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &500,
        &1000,
        &2,
           &None,
           &None,
    );

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
fn test_unpause_allows_operations() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    let _ = ctx.client.initialize(&admin);
    ctx.client.set_pause(&admin, &true);
    ctx.client.set_pause(&admin, &false);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &2,
        &None,
>>>>>>> 66f9b0a (feat(contract): implement secure contract initialization)
        &None,
    );
    let id2 = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Template B"),
        &f.token,
        &2_000u64,
        &CURVE_EXP,
        &true,
        &None,
    );
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    let ids = c.get_user_templates(&f.sender);
    assert_eq!(ids.len(), 2);
}

#[test]
fn test_template_not_found() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    assert!(c.try_get_template(&999).is_err());
}

#[test]
fn test_max_templates_limit() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    for _i in 0..20u32 {
        let name = soroban_sdk::String::from_str(&f.env, "T");
        c.save_template(
            &f.sender,
            &name,
            &f.token,
            &1_000u64,
            &CURVE_LINEAR,
            &false,
            &None,
        );
    }
    let too_many = soroban_sdk::String::from_str(&f.env, "X");
    assert!(c.try_save_template(
        &f.sender,
        &too_many,
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    ).is_err());
}

#[test]
fn test_update_template() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Old Name"),
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    c.update_template(
        &f.sender,
        &id,
        &String::from_str(&f.env, "New Name"),
        &f.token,
        &2_000u64,
        &CURVE_EXP,
        &true,
        &None,
    );
    let tpl = c.get_template(&id);
    assert_eq!(tpl.name, String::from_str(&f.env, "New Name"));
    assert_eq!(tpl.duration, 2_000);
    assert_eq!(tpl.curve_type, CURVE_EXP);
    assert!(tpl.is_soulbound);
}

#[test]
fn test_delete_template() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "Delete Me"),
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    c.delete_template(&f.sender, &id);
    assert!(c.try_get_template(&id).is_err());
    let ids = c.get_user_templates(&f.sender);
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_not_template_owner() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.save_template(
        &f.sender,
        &String::from_str(&f.env, "My Template"),
        &f.token,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &None,
    );
    assert!(c.try_create_stream_from_template(
        &f.receiver,
        &id,
        &f.sender,
        &100i128,
        &0u64,
    ).is_err());
}
