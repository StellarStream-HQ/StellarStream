//! Health check and metrics tests (issue #1502).
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::Address;

const HOUR: u64 = SECONDS_PER_HOUR;

/// Create a stream of `amount` running from `start` for `duration` seconds.
fn create(f: &Fixture, amount: i128, start: u64, duration: u64) -> u64 {
    client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &amount,
        &start,
        &(start + duration),
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    )
}

// --------------------------------------------------------------------------
// health_check
// --------------------------------------------------------------------------

/// A fresh contract reports itself live, empty, and at the current version.
#[test]
fn test_health_check_on_fresh_contract() {
    let f = setup();
    let health = client(&f.env, &f.contract).health_check();

    assert!(!health.is_paused);
    assert_eq!(health.active_streams, 0);
    assert_eq!(health.total_tvl.len(), 0);
    assert_eq!(health.last_activity_time, 0);
    assert_eq!(health.version, CONTRACT_VERSION);
}

/// Creating streams moves the active count and per-token TVL.
#[test]
fn test_health_tracks_active_streams_and_tvl() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    f.env.ledger().set_timestamp(1_000);

    create(&f, 10_000, 0, 1_000);
    create(&f, 5_000, 0, 1_000);

    let health = c.health_check();
    assert_eq!(health.active_streams, 2);
    assert_eq!(health.total_tvl.get(f.token.clone()), Some(15_000));
    assert_eq!(
        health.last_activity_time, 1_000,
        "creation counts as activity"
    );
}

/// TVL is tracked per token, not pooled.
#[test]
fn test_tvl_is_per_token() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let other_token = f.env.register(MockToken, ());

    create(&f, 10_000, 0, 1_000);
    c.create_stream(
        &f.sender,
        &f.receiver,
        &other_token,
        &7_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );

    let health = c.health_check();
    assert_eq!(health.total_tvl.get(f.token.clone()), Some(10_000));
    assert_eq!(health.total_tvl.get(other_token), Some(7_000));
}

/// Withdrawing releases the withdrawn portion from TVL.
#[test]
fn test_withdraw_reduces_tvl() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = create(&f, 10_000, 0, 1_000);

    f.env.ledger().set_timestamp(500);
    let withdrawn = c.withdraw(&id, &f.receiver);
    assert_eq!(withdrawn, 5_000);

    let health = c.health_check();
    assert_eq!(health.total_tvl.get(f.token.clone()), Some(5_000));
    assert_eq!(
        health.active_streams, 1,
        "a partially withdrawn stream is still active"
    );
}

/// Cancelling closes the stream and releases everything still owed.
#[test]
fn test_cancel_decrements_active_and_releases_tvl() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = create(&f, 10_000, 0, 1_000);
    create(&f, 4_000, 0, 1_000);

    f.env.ledger().set_timestamp(500);
    c.withdraw(&id, &f.receiver); // 5_000 out, 5_000 still owed
    c.cancel_stream(&id, &f.sender);

    let health = c.health_check();
    assert_eq!(health.active_streams, 1);
    assert_eq!(
        health.total_tvl.get(f.token.clone()),
        Some(4_000),
        "the cancelled stream's remaining 5_000 was released"
    );
}

/// The paused flag is reported.
#[test]
fn test_health_reports_paused_state() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    assert!(!c.health_check().is_paused);

    c.pause_contract(&f.pauser);
    assert!(c.health_check().is_paused);

    c.unpause_contract(&f.pauser);
    assert!(!c.health_check().is_paused);
}

// --------------------------------------------------------------------------
// get_metrics
// --------------------------------------------------------------------------

/// A fresh contract reports zeroes rather than failing or dividing by zero.
#[test]
fn test_metrics_on_fresh_contract() {
    let f = setup();
    let m = client(&f.env, &f.contract).get_metrics();

    assert_eq!(m.streams_created_24h, 0);
    assert_eq!(m.withdrawals_24h, 0);
    assert_eq!(m.avg_stream_duration, 0);
    assert_eq!(m.avg_stream_amount, 0);
    assert_eq!(m.unique_users_24h, 0);
}

/// Creations and withdrawals inside the window are counted.
#[test]
fn test_metrics_count_creations_and_withdrawals() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let a = create(&f, 10_000, 0, 1_000);
    let b = create(&f, 20_000, 0, 1_000);
    f.env.ledger().set_timestamp(500);
    c.withdraw(&a, &f.receiver);
    c.withdraw(&b, &f.receiver);

    let m = c.get_metrics();
    assert_eq!(m.streams_created_24h, 2);
    assert_eq!(m.withdrawals_24h, 2);
}

/// Averages are over streams created in the window.
#[test]
fn test_metrics_average_duration_and_amount() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    create(&f, 10_000, 0, 1_000);
    create(&f, 20_000, 0, 3_000);

    let m = c.get_metrics();
    assert_eq!(m.streams_created_24h, 2);
    assert_eq!(m.avg_stream_duration, 2_000, "(1_000 + 3_000) / 2");
    assert_eq!(m.avg_stream_amount, 15_000, "(10_000 + 20_000) / 2");
}

/// Distinct participants are counted once, not once per operation.
#[test]
fn test_metrics_unique_users() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Three creations by the same sender: one distinct user so far.
    create(&f, 1_000, 0, 1_000);
    create(&f, 1_000, 0, 1_000);
    let id = create(&f, 1_000, 0, 1_000);
    assert_eq!(c.get_metrics().unique_users_24h, 1);

    // A withdrawal brings the receiver in as a second distinct user.
    f.env.ledger().set_timestamp(500);
    c.withdraw(&id, &f.receiver);
    assert_eq!(c.get_metrics().unique_users_24h, 2);
}

/// Activity older than the window stops being counted.
#[test]
fn test_metrics_window_rolls_forward() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    create(&f, 10_000, 0, 1_000);
    assert_eq!(c.get_metrics().streams_created_24h, 1);

    // Still inside the 24h window.
    f.env.ledger().set_timestamp(23 * HOUR);
    assert_eq!(c.get_metrics().streams_created_24h, 1);

    // Past it.
    f.env.ledger().set_timestamp(25 * HOUR);
    let m = c.get_metrics();
    assert_eq!(m.streams_created_24h, 0, "the old bucket left the window");
    assert_eq!(m.unique_users_24h, 0);

    // New activity repopulates the window.
    create(&f, 5_000, 25 * HOUR, 1_000);
    assert_eq!(c.get_metrics().streams_created_24h, 1);
}

/// Activity spread across hours is summed across buckets.
#[test]
fn test_metrics_sum_across_hourly_buckets() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    for hour in 0..5u64 {
        f.env.ledger().set_timestamp(hour * HOUR);
        create(&f, 1_000, hour * HOUR, 1_000);
    }

    let m = c.get_metrics();
    assert_eq!(m.streams_created_24h, 5);
    assert_eq!(m.avg_stream_amount, 1_000);
}

/// The unique-user count saturates instead of growing without bound.
#[test]
fn test_unique_users_is_capped() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // More distinct senders than the contract is willing to track.
    for _ in 0..(MAX_TRACKED_USERS + 10) {
        let sender = Address::generate(&f.env);
        c.create_stream(
            &sender,
            &f.receiver,
            &f.token,
            &1_000i128,
            &0u64,
            &1_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        );
    }

    let m = c.get_metrics();
    assert_eq!(
        m.unique_users_24h, MAX_TRACKED_USERS as u64,
        "the count saturates at the cap"
    );
    assert_eq!(
        m.streams_created_24h,
        (MAX_TRACKED_USERS + 10) as u64,
        "but every creation is still counted"
    );
}

// --------------------------------------------------------------------------
// Read-only guarantee
// --------------------------------------------------------------------------

/// Polling the monitoring endpoints must not perturb what they report.
#[test]
fn test_monitoring_endpoints_are_read_only() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    create(&f, 10_000, 0, 1_000);

    let health_before = c.health_check();
    let metrics_before = c.get_metrics();

    for _ in 0..5 {
        c.health_check();
        c.get_metrics();
    }

    assert_eq!(c.health_check(), health_before);
    assert_eq!(c.get_metrics(), metrics_before);
}
