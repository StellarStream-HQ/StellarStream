#![cfg(test)]
//! Tests for the recurring stream feature.
//!
//! # Scenarios covered
//!  1. test_single_recurrence
//!  2. test_multiple_recurrences
//!  3. test_max_occurrences_reached
//!  4. test_insufficient_balance_stops_renewal
//!  5. test_manual_stop
//!  6. test_independent_withdrawals
//!  7. test_infinite_recurrence
//!  8. test_cancellation_does_not_stop_recurrence
//!  9. test_different_period_parameters
//! 10. test_recurring_stream_created_event
//! 11. test_non_sender_cannot_stop (bonus)
//! 12. test_renewal_before_period_end_rejected (bonus)

use crate::errors::Error;
use crate::{StellarStreamContract, StellarStreamContractClient};
use crate::rbac::Role;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

const MINT: i128 = 10_000_000;
const PERIOD: u64 = 1_000;
const AMOUNT: i128 = 1_000;

struct Ctx {
    env: Env,
    client: StellarStreamContractClient<'static>,
    admin: Address,
    sender: Address,
    receiver: Address,
    token: Address,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&sender, &MINT);

    Ctx { env, client, admin, sender, receiver, token }
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|li| li.timestamp = t);
}

// ── 1. Single recurrence ──────────────────────────────────────────────────────

#[test]
fn test_single_recurrence() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &2,
    );

    set_time(&ctx.env, 2_001);
    let new_id = ctx.client.renew_stream(&root_id);

    assert_ne!(new_id, root_id);
    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(cfg.occurrences_completed, 1);
    assert_eq!(cfg.current_stream_id, new_id);

    let s = ctx.client.get_stream(&new_id).unwrap();
    assert_eq!(s.total_amount, AMOUNT);
    assert_eq!(s.sender, ctx.sender);
    assert_eq!(s.receiver, ctx.receiver);
}

// ── 2. Multiple recurrences — counter increments ──────────────────────────────

#[test]
fn test_multiple_recurrences() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    for i in 1u64..=3 {
        set_time(&ctx.env, 1_000 + PERIOD * i + 1);
        ctx.client.renew_stream(&root_id);
    }

    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(cfg.occurrences_completed, 3);
    assert!(cfg.enabled);
}

// ── 3. Max occurrences reached ────────────────────────────────────────────────

#[test]
fn test_max_occurrences_reached() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &2,
    );

    set_time(&ctx.env, 2_001);
    ctx.client.renew_stream(&root_id);
    set_time(&ctx.env, 3_001);
    ctx.client.renew_stream(&root_id);

    // Third attempt must fail
    set_time(&ctx.env, 4_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::MaxOccurrencesReached);

    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(!cfg.enabled);
}

// ── 4. Insufficient balance stops renewal ────────────────────────────────────

#[test]
fn test_insufficient_balance_stops_renewal() {
    let ctx = setup();

    // Mint only enough for one period
    let poor_sender = Address::generate(&ctx.env);
    StellarAssetClient::new(&ctx.env, &ctx.token).mint(&poor_sender, &AMOUNT);

    let root_id = ctx.client.create_recurring_stream(
        &poor_sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    // After the first period the sender has 0 tokens
    set_time(&ctx.env, 2_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::InsufficientRenewalBalance);
}

// ── 5. Manual stop prevents renewal ──────────────────────────────────────────

#[test]
fn test_manual_stop() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    ctx.client.stop_recurring_stream(&root_id, &ctx.sender);

    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(!cfg.enabled);

    set_time(&ctx.env, 2_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::RecurringStopped);
}

// ── 6. Independent withdrawals per period ────────────────────────────────────

#[test]
fn test_independent_withdrawals() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    // Withdraw from period 1
    set_time(&ctx.env, 2_001);
    let w1 = ctx.client.withdraw(&root_id, &ctx.receiver);
    assert_eq!(w1, AMOUNT);

    // Renew and withdraw from period 2
    let p2 = ctx.client.renew_stream(&root_id);
    set_time(&ctx.env, 3_001 + PERIOD);
    let w2 = ctx.client.withdraw(&p2, &ctx.receiver);
    assert_eq!(w2, AMOUNT);
}

// ── 7. Infinite recurrence (max_occurrences = 0) ─────────────────────────────

#[test]
fn test_infinite_recurrence() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    for i in 1u64..=5 {
        set_time(&ctx.env, 1_000 + PERIOD * i + 1);
        let result = ctx.client.try_renew_stream(&root_id);
        assert!(result.is_ok(), "renewal {} should succeed", i);
    }

    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(cfg.occurrences_completed, 5);
    assert!(cfg.enabled);
}

// ── 8. Cancelling current stream doesn't stop recurrence ─────────────────────

#[test]
fn test_cancellation_does_not_stop_recurrence() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    // Cancel the current period early
    ctx.client.cancel(&root_id, &ctx.sender);

    // Config should still be enabled
    let cfg = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(cfg.enabled, "Recurrence should remain enabled after cancel");

    // Advance past the original period end; renewal should succeed
    set_time(&ctx.env, 2_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_ok(), "Renewal should succeed after cancel: {:?}", result);
}

// ── 9. Different period parameters ───────────────────────────────────────────

#[test]
fn test_different_period_parameters() {
    let ctx = setup();

    let big: i128 = 50_000;
    let short: u64 = 100;

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &big, &short, &3,
    );

    let s = ctx.client.get_stream(&root_id).unwrap();
    assert_eq!(s.total_amount, big);
    assert_eq!(s.end_time - s.start_time, short);

    set_time(&ctx.env, 1_101);
    let next = ctx.client.renew_stream(&root_id);
    let s2 = ctx.client.get_stream(&next).unwrap();
    assert_eq!(s2.total_amount, big);
    assert_eq!(s2.end_time - s2.start_time, short);
}

// ── 10. Creation emits event ──────────────────────────────────────────────────

#[test]
fn test_recurring_stream_created_event() {
    let ctx = setup();

    ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &5,
    );

    let events = ctx.env.events().all();
    assert!(!events.is_empty());

    let found = events.iter().any(|(_, topics, _)| {
        format!("{:?}", topics).contains("recur")
    });
    assert!(found, "Expected 'recur' event, got: {:?}", events);
}

// ── 11. Non-sender cannot stop ────────────────────────────────────────────────

#[test]
fn test_non_sender_cannot_stop() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_stop_recurring_stream(&root_id, &stranger);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::Unauthorized);
}

// ── 12. Renewal before period end is rejected ────────────────────────────────

#[test]
fn test_renewal_before_period_end_rejected() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender, &ctx.receiver, &ctx.token,
        &AMOUNT, &PERIOD, &0,
    );

    // Still within the first period (period ends at t=2000)
    set_time(&ctx.env, 1_500);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::StreamNotActive);
}
