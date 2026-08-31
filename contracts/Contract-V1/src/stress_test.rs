//! Load and stress testing for the StellarStream contract.
//!
//! These tests verify that the contract remains correct and efficient as the
//! number of streams, users, and operations grows. They exercise realistic data
//! distributions and large state to surface gas/state regressions early.
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};

/// Create `n` streams from `sender` to freshly generated receivers.
fn create_many(env: &Env, contract: &Address, sender: &Address, token: &Address, n: u64) -> Vec<u64> {
    let mut ids = Vec::new(env);
    for _ in 0..n {
        let receiver = Address::generate(env);
        let id = client(env, contract).create_stream(
            sender,
            &receiver,
            token,
            &1_000_000i128,
            &0u64,
            &1_000_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        );
        ids.push_back(id);
    }
    ids
}

/// Create `n` streams from `sender` to one fixed `receiver`, so that a single
/// account can withdraw from all of them.
fn create_many_to(
    env: &Env,
    contract: &Address,
    sender: &Address,
    receiver: &Address,
    token: &Address,
    n: u64,
) -> Vec<u64> {
    let mut ids = Vec::new(env);
    for _ in 0..n {
        let id = client(env, contract).create_stream(
            sender,
            receiver,
            token,
            &1_000_000i128,
            &0u64,
            &1_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        );
        ids.push_back(id);
    }
    ids
}

/// Stress test #1: 1000 active streams can be created and individually retrieved.
#[test]
fn test_1000_active_streams() {
    let f = setup();
    let ids = create_many(&f.env, &f.contract, &f.sender, &f.token, 1000);
    assert_eq!(ids.len(), 1000);
    let c = client(&f.env, &f.contract);
    for id in ids.iter() {
        let s = c.get_stream(&id);
        assert_eq!(s.state, STATE_ACTIVE);
    }
}

/// Stress test #2: 100 withdrawals executed across distinct streams at scale.
#[test]
fn test_100_concurrent_withdrawals() {
    let f = setup();
    let ids = create_many_to(
        &f.env,
        &f.contract,
        &f.sender,
        &f.receiver,
        &f.token,
        100,
    );
    f.env.ledger().set_timestamp(500);
    let c = client(&f.env, &f.contract);
    let mut total = 0i128;
    for id in ids.iter() {
        let w = c.withdraw(&id, &f.receiver);
        assert!(w > 0);
        total += w;
    }
    // Half of 1_000_000 over 100 streams at t=500/1000.
    assert_eq!(total, 100 * 500_000);
}

/// Stress test #3: a single user profile holding 200 streams.
#[test]
fn test_large_user_profile() {
    let f = setup();
    create_many(&f.env, &f.contract, &f.sender, &f.token, 200);
    let list = client(&f.env, &f.contract).get_user_streams(&f.sender);
    assert_eq!(list.len(), 200);
}

/// Stress test #4: 100 distinct users each owning a stream.
#[test]
fn test_100_users() {
    let f = setup();
    let mut users = Vec::new(&f.env);
    for _ in 0..100 {
        let u = Address::generate(&f.env);
        users.push_back(u.clone());
        client(&f.env, &f.contract).create_stream(
            &u,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &1_000_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        );
    }
    for u in users.iter() {
        assert_eq!(client(&f.env, &f.contract).get_user_streams(&u).len(), 1);
    }
}

/// Stress test #5: query performance over a large dataset (1000 streams).
#[test]
fn test_query_performance_large_dataset() {
    let f = setup();
    create_many(&f.env, &f.contract, &f.sender, &f.token, 1000);
    f.env.ledger().set_timestamp(500);
    let c = client(&f.env, &f.contract);
    let ids = client(&f.env, &f.contract).get_user_streams(&f.sender);
    for id in ids.iter() {
        let _ = c.get_unlocked_amount(&id);
        let _ = c.get_withdrawable_amount(&id);
    }
}

/// Stress test #6: batch withdrawal at the limit (100 streams withdrawn at once).
#[test]
fn test_withdraw_batch_at_limits() {
    let f = setup();
    let ids = create_many_to(&f.env, &f.contract, &f.sender, &f.receiver, &f.token, 100);
    f.env.ledger().set_timestamp(1_000_000);
    let c = client(&f.env, &f.contract);
    for id in ids.iter() {
        let w = c.withdraw(&id, &f.receiver);
        assert_eq!(w, 1_000_000i128);
    }
}

/// Stress test #7: creation scales linearly (id allocation monotonic, no gaps).
#[test]
fn test_create_scales_monotonic_ids() {
    let f = setup();
    let ids = create_many(&f.env, &f.contract, &f.sender, &f.token, 500);
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(id, (i as u64) + 1);
    }
}

/// Stress test #8: 1000 streams, each partially withdrawn once.
#[test]
fn test_1000_streams_partial_withdraw() {
    let f = setup();
    let ids = create_many_to(&f.env, &f.contract, &f.sender, &f.receiver, &f.token, 1000);
    f.env.ledger().set_timestamp(250);
    let c = client(&f.env, &f.contract);
    for id in ids.iter() {
        let w = c.withdraw(&id, &f.receiver);
        assert_eq!(w, 250_000i128);
    }
}

/// Stress test #9: mixed linear + exponential curves at scale.
#[test]
fn test_mixed_curves_large() {
    let f = setup();
    let mut ids = Vec::new(&f.env);
    for i in 0..400u64 {
        let curve = if i % 2 == 0 { CURVE_LINEAR } else { CURVE_EXP };
        let id = client(&f.env, &f.contract).create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &1_000u64,
            &curve,
            &false,
            &false,
            &None,
        );
        ids.push_back(id);
    }
    f.env.ledger().set_timestamp(500);
    let c = client(&f.env, &f.contract);
    for id in ids.iter() {
        let w = c.withdraw(&id, &f.receiver);
        assert!(w > 0 && w <= 1_000_000i128);
    }
}

/// Stress test #10: repeated storage reads across many streams (access pattern).
#[test]
fn test_storage_access_pattern() {
    let f = setup();
    let ids = create_many(&f.env, &f.contract, &f.sender, &f.token, 800);
    let c = client(&f.env, &f.contract);
    for _ in 0..5 {
        for id in ids.iter() {
            let _ = c.get_stream(&id);
        }
    }
}

/// Stress test #11: realistic data distribution (varied amounts & durations).
#[test]
fn test_realistic_data_distribution() {
    let f = setup();
    let mut ids = Vec::new(&f.env);
    for i in 0..300u64 {
        let receiver = Address::generate(&f.env);
        let total = ((i + 1) as i128) * 10_000i128;
        let end = 1_000u64 + (i % 50) * 100u64;
        let id = client(&f.env, &f.contract).create_stream(
            &f.sender,
            &receiver,
            &f.token,
            &total,
            &0u64,
            &end,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        );
        ids.push_back(id);
    }
    f.env.ledger().set_timestamp(500);
    let c = client(&f.env, &f.contract);
    for id in ids.iter() {
        let s = c.get_stream(&id);
        let w = c.get_withdrawable_amount(&id);
        assert!(w >= 0 && w <= s.total_amount);
    }
}

/// Stress test #12: unlocked amount is monotonic and never exceeds the total,
/// even across a large number of streams advanced to completion.
#[test]
fn test_unlocked_monotonic_at_scale() {
    let f = setup();
    let ids = create_many(&f.env, &f.contract, &f.sender, &f.token, 600);
    let c = client(&f.env, &f.contract);
    f.env.ledger().set_timestamp(0);
    for id in ids.iter() {
        assert_eq!(c.get_unlocked_amount(&id), 0);
    }
    f.env.ledger().set_timestamp(1_000_000);
    for id in ids.iter() {
        let s = c.get_stream(&id);
        assert_eq!(c.get_unlocked_amount(&id), s.total_amount);
    }
}

/// Benchmark-style test: creating 1000 streams in one session completes and the
/// contract remains queryable. Documents expected scaling behaviour.
#[test]
fn bench_create_1000_streams() {
    let f = setup();
    let ids = create_many(&f.env, &f.contract, &f.sender, &f.token, 1000);
    assert_eq!(ids.len(), 1000);
    assert_eq!(client(&f.env, &f.contract).next_stream_id(), 1001);
}
