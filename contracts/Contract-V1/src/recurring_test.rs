#![cfg(test)]
//! Tests for the recurring stream feature.
//!
//! # Scenarios covered
//!
//!  1. `test_single_recurrence`               — create + renew once, verify new stream
//!  2. `test_multiple_recurrences`             — renew multiple times, counter increments
//!  3. `test_max_occurrences_reached`          — renew exactly N times, N+1 returns error
//!  4. `test_insufficient_balance_stops`       — sender runs out of tokens mid-chain
//!  5. `test_manual_stop`                      — stop_recurring_stream disables renewal
//!  6. `test_independent_withdrawals`          — each period's stream supports independent
//!                                               withdrawal by the receiver
//!  7. `test_infinite_recurrence`              — max_occurrences=0 renews indefinitely
//!  8. `test_cancellation_does_not_stop_recurrence` — cancelling current stream doesn't
//!                                               affect the recurrence config
//!  9. `test_different_period_parameters`      — various period durations & amounts
//! 10. `test_recurring_stream_created_event`   — creation emits the right event
//!
//! The test harness mints `MINT` tokens to `sender` and deploys the contract.
//! Time is advanced with `set_time(env, t)`.

use crate::errors::Error;
use crate::types::CurveType;
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

// ──────────────────────────────────────────────
// Shared constants
// ──────────────────────────────────────────────

const MINT: i128 = 10_000_000; // tokens available to sender
const PERIOD: u64 = 1_000; // 1000 seconds per period
const AMOUNT: i128 = 1_000; // 1000 tokens per period

// ──────────────────────────────────────────────
// Test context
// ──────────────────────────────────────────────

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
    // Start at t = 1000 so all stream times are positive
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Mint tokens to sender
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&sender, &MINT);

    Ctx { env, client, admin, sender, receiver, token }
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|li| li.timestamp = t);
}

// ──────────────────────────────────────────────
// Test 1: Single recurrence
// ──────────────────────────────────────────────

/// Create a recurring stream and renew it once. Verify a new stream ID is
/// returned, the occurrences counter increments, and the new stream is live.
#[test]
fn test_single_recurrence() {
    let ctx = setup();

    // t=1000: create recurring stream (period 1000s, 1 occurrence max)
    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &2, // max 2 occurrences (first period counts as 0, so 2 renewals)
    );

    // Advance past end of first period (t=2001)
    set_time(&ctx.env, 2_001);

    let new_id = ctx.client.renew_stream(&root_id);

    assert_ne!(new_id, root_id, "Renewed stream must have a different ID");

    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(config.occurrences_completed, 1);
    assert_eq!(config.current_stream_id, new_id);

    // New stream should be retrievable
    let new_stream = ctx.client.get_stream(&new_id).unwrap();
    assert_eq!(new_stream.total_amount, AMOUNT);
    assert_eq!(new_stream.sender, ctx.sender);
    assert_eq!(new_stream.receiver, ctx.receiver);
}

// ──────────────────────────────────────────────
// Test 2: Multiple recurrences — counter increments
// ──────────────────────────────────────────────

/// Renew 3 times; each renewal increments `occurrences_completed`.
#[test]
fn test_multiple_recurrences() {
    let ctx = setup();

    // Start at t=1000, unlimited recurrences
    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0, // unlimited
    );

    // Renew three times, advancing time past each period end
    for i in 1u32..=3 {
        set_time(&ctx.env, 1_000 + (PERIOD * i as u64) + 1);
        ctx.client.renew_stream(&root_id);
    }

    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(config.occurrences_completed, 3);
    assert!(config.enabled);
}

// ──────────────────────────────────────────────
// Test 3: Max occurrences reached returns error
// ──────────────────────────────────────────────

/// With max_occurrences=2, the second renewal succeeds and a third attempt
/// returns `Error::MaxOccurrencesReached`.
#[test]
fn test_max_occurrences_reached() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &2, // only 2 renewals
    );

    // First renewal
    set_time(&ctx.env, 2_001);
    ctx.client.renew_stream(&root_id);

    // Second renewal
    set_time(&ctx.env, 3_001);
    ctx.client.renew_stream(&root_id);

    // Third attempt must fail
    set_time(&ctx.env, 4_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        Error::MaxOccurrencesReached,
    );

    // Config should have been auto-disabled
    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(!config.enabled);
}

// ──────────────────────────────────────────────
// Test 4: Insufficient balance stops renewal
// ──────────────────────────────────────────────

/// If the sender runs out of tokens the renewal is rejected with
/// `Error::InsufficientRenewalBalance`.
#[test]
fn test_insufficient_balance_stops_renewal() {
    let ctx = setup();

    // Use an amount larger than available balance for this test
    // Mint only a tiny amount to the sender on a fresh token
    let poor_sender = Address::generate(&ctx.env);
    // Mint exactly 1 AMOUNT so the first period is fine but the second fails
    StellarAssetClient::new(&ctx.env, &ctx.token).mint(&poor_sender, &AMOUNT);

    let root_id = ctx.client.create_recurring_stream(
        &poor_sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0, // unlimited
    );

    // Advance past first period
    set_time(&ctx.env, 2_001);

    // Sender now has 0 tokens — renewal should fail
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        Error::InsufficientRenewalBalance,
    );
}

// ──────────────────────────────────────────────
// Test 5: Manual stop prevents further renewal
// ──────────────────────────────────────────────

/// After `stop_recurring_stream`, any call to `renew_stream` returns
/// `Error::RecurringStopped`. The current period stream is unaffected.
#[test]
fn test_manual_stop() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    // Stop the recurring stream
    ctx.client.stop_recurring_stream(&root_id, &ctx.sender);

    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(!config.enabled);

    // Advance time and attempt renewal — must fail
    set_time(&ctx.env, 2_001);
    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        Error::RecurringStopped,
    );

    // Original stream should still be retrievable and closed (time passed)
    let stream = ctx.client.get_stream(&root_id).unwrap();
    assert_eq!(stream.total_amount, AMOUNT);
}

// ──────────────────────────────────────────────
// Test 6: Independent withdrawals per period
// ──────────────────────────────────────────────

/// Each period's stream allows the receiver to withdraw independently.
/// Withdrawing from period-1 does not affect period-2.
#[test]
fn test_independent_withdrawals() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    // Advance to end of first period — receiver can withdraw all
    set_time(&ctx.env, 2_001);
    let withdrawn = ctx.client.withdraw(&root_id, &ctx.receiver);
    assert_eq!(withdrawn, AMOUNT);

    // Renew to period 2
    let period2_id = ctx.client.renew_stream(&root_id);

    // Advance to end of period 2 — receiver can withdraw from period 2
    set_time(&ctx.env, 3_001 + PERIOD);
    let withdrawn2 = ctx.client.withdraw(&period2_id, &ctx.receiver);
    assert_eq!(withdrawn2, AMOUNT);
}

// ──────────────────────────────────────────────
// Test 7: Infinite recurrence (max_occurrences = 0)
// ──────────────────────────────────────────────

/// With `max_occurrences = 0` the stream keeps renewing and never returns
/// `MaxOccurrencesReached`.
#[test]
fn test_infinite_recurrence() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    // Renew 10 times — all should succeed
    for i in 1u64..=10 {
        set_time(&ctx.env, 1_000 + PERIOD * i + 1);
        let result = ctx.client.try_renew_stream(&root_id);
        assert!(
            result.is_ok(),
            "Renewal {} of unlimited stream should succeed",
            i
        );
    }

    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert_eq!(config.occurrences_completed, 10);
    assert!(config.enabled, "Infinite stream should still be enabled");
}

// ──────────────────────────────────────────────
// Test 8: Cancelling current stream doesn't stop recurrence
// ──────────────────────────────────────────────

/// Cancelling the current-period stream via `cancel` does NOT disable the
/// recurrence config. The next renewal will still work once the period ends.
#[test]
fn test_cancellation_does_not_stop_recurrence() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    // Cancel the current-period stream early
    ctx.client.cancel(&root_id, &ctx.sender);

    // Recurrence config should still be enabled
    let config = ctx.client.get_recurrence_config(&root_id).unwrap();
    assert!(config.enabled, "Recurrence should remain enabled after cancel");

    // Advance past the original period end and renew
    set_time(&ctx.env, 2_001);
    let result = ctx.client.try_renew_stream(&root_id);
    // Renewal creates a new stream from the current time — should succeed
    // (Note: current_stream is cancelled/closed, end_time has passed)
    assert!(
        result.is_ok(),
        "Renewal should succeed even if current stream was cancelled: {:?}",
        result
    );
}

// ──────────────────────────────────────────────
// Test 9: Different period parameters
// ──────────────────────────────────────────────

/// Verify that different `amount_per_period` and `period_duration` values
/// are respected in the created streams.
#[test]
fn test_different_period_parameters() {
    let ctx = setup();

    let large_amount: i128 = 50_000;
    let short_period: u64 = 100; // 100 seconds

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &large_amount,
        &short_period,
        &3,
    );

    let stream = ctx.client.get_stream(&root_id).unwrap();
    assert_eq!(stream.total_amount, large_amount);
    // Period is 100s from now (t=1000), so end_time = 1100
    assert_eq!(stream.end_time - stream.start_time, short_period);

    // Renew and verify new stream has same parameters
    set_time(&ctx.env, 1_101); // past end of first period
    let next_id = ctx.client.renew_stream(&root_id);
    let next_stream = ctx.client.get_stream(&next_id).unwrap();
    assert_eq!(next_stream.total_amount, large_amount);
    assert_eq!(next_stream.end_time - next_stream.start_time, short_period);
}

// ──────────────────────────────────────────────
// Test 10: Creation emits the recurring stream event
// ──────────────────────────────────────────────

/// `create_recurring_stream` must emit a `RecurringStreamCreatedEvent`
/// (or at minimum one event with the `recur` topic).
#[test]
fn test_recurring_stream_created_event() {
    let ctx = setup();

    ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &5,
    );

    let events = ctx.env.events().all();
    assert!(
        !events.is_empty(),
        "At least one event should be emitted on recurring stream creation"
    );

    // Look for an event whose topics include the "recur" symbol
    let found = events.iter().any(|(_, topics, _)| {
        let s = format!("{:?}", topics);
        s.contains("recur")
    });

    assert!(
        found,
        "Expected an event with topic 'recur' but got: {:?}",
        events
    );
}

// ──────────────────────────────────────────────
// Bonus: Non-sender cannot stop recurring stream
// ──────────────────────────────────────────────

/// Only the original `sender` may call `stop_recurring_stream`.
/// A stranger gets `Error::Unauthorized`.
#[test]
fn test_non_sender_cannot_stop() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_stop_recurring_stream(&root_id, &stranger);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::Unauthorized);
}

// ──────────────────────────────────────────────
// Bonus: Renewal before period end is rejected
// ──────────────────────────────────────────────

/// Calling `renew_stream` before the current period ends returns
/// `Error::StreamNotActive`.
#[test]
fn test_renewal_before_period_end_rejected() {
    let ctx = setup();

    let root_id = ctx.client.create_recurring_stream(
        &ctx.sender,
        &ctx.receiver,
        &ctx.token,
        &AMOUNT,
        &PERIOD,
        &0,
    );

    // Still within the first period (t=1500, period ends at t=2000)
    set_time(&ctx.env, 1_500);

    let result = ctx.client.try_renew_stream(&root_id);
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::StreamNotActive);
}
