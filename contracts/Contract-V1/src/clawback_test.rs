#![cfg(test)]
//! Comprehensive tests for the clawback feature.
//!
//! Uses the shared `common` test harness. Streams are created via
//! `create_stream` with `clawback_enabled = true`.

use super::*;
use crate::common::{client, setup};
use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
use soroban_sdk::String;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn set_time(env: &Env, ts: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: ts,
        protocol_version: 22,
        sequence_number: (ts / 5) as u32,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    });
}

fn reason(env: &Env) -> String {
    String::from_str(env, "test reason")
}

/// Create a clawback-enabled stream and advance time past start so something
/// is withdrawable. Returns (stream_id, withdrawn_amount).
fn make_clawback_stream(
    env: &Env,
    c: &StellarStreamContractClient,
    sender: &Address,
    receiver: &Address,
    token: &Address,
) -> (u64, i128) {
    // start=100, end=200, total=1000
    set_time(env, 100);
    let stream_id = c.create_stream(
        sender,
        receiver,
        token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &CURVE_LINEAR,
        &false,
        &true, // clawback_enabled
        &None,
    );

    // Advance to 50% and withdraw so there IS a withdrawn_amount
    set_time(env, 150);
    let withdrawn = c.withdraw(&stream_id, receiver);
    (stream_id, withdrawn)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_request_clawback_basic() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let clawback_id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );

    let req = c.get_clawback_request(&clawback_id).unwrap();
    assert_eq!(req.stream_id, stream_id);
    assert_eq!(req.amount, withdrawn);
    assert_eq!(req.status, ClawbackStatus::Pending);
}

#[test]
fn test_receiver_approval_sets_approved_status() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );

    c.approve_clawback(&id, &f.receiver);
    let req = c.get_clawback_request(&id).unwrap();
    assert_eq!(req.status, ClawbackStatus::Approved);
    assert!(req.approved_by_receiver);
}

#[test]
fn test_governance_approval_path() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let gov1 = Address::generate(&f.env);
    let gov2 = Address::generate(&f.env);

    // Need 2 approvals
    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &2_u32,
        &0_u64,
    );

    c.approve_clawback(&id, &gov1);
    assert_eq!(
        c.get_clawback_request(&id).unwrap().status,
        ClawbackStatus::Pending
    );

    c.approve_clawback(&id, &gov2);
    assert_eq!(
        c.get_clawback_request(&id).unwrap().status,
        ClawbackStatus::Approved
    );
}

#[test]
fn test_execute_clawback_succeeds_when_approved() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );

    c.approve_clawback(&id, &f.receiver);
    c.execute_clawback(&id, &f.sender);
    assert_eq!(
        c.get_clawback_request(&id).unwrap().status,
        ClawbackStatus::Executed
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #46)")]
fn test_execute_without_approval_fails() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );

    // Not approved yet — should panic with ClawbackInsufficientApprovals
    c.execute_clawback(&id, &f.sender);
}

#[test]
#[should_panic(expected = "Error(Contract, #44)")]
fn test_amount_exceeds_withdrawn_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    // Request more than was withdrawn
    c.request_clawback(
        &stream_id,
        &f.sender,
        &(withdrawn + 1),
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
}

#[test]
fn test_multiple_clawbacks_on_same_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id1 = c.request_clawback(
        &stream_id,
        &f.sender,
        &(withdrawn / 2),
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
    let id2 = c.request_clawback(
        &stream_id,
        &f.sender,
        &(withdrawn / 2),
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );

    assert_ne!(id1, id2);
    assert_eq!(
        c.get_clawback_request(&id1).unwrap().status,
        ClawbackStatus::Pending
    );
    assert_eq!(
        c.get_clawback_request(&id2).unwrap().status,
        ClawbackStatus::Pending
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #48)")]
fn test_expired_request_cannot_be_approved() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    // expires_at = 200
    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &200_u64,
    );

    // Advance past expiry
    set_time(&f.env, 201);
    c.approve_clawback(&id, &f.receiver);
}

#[test]
#[should_panic(expected = "Error(Contract, #48)")]
fn test_expired_approved_request_cannot_be_executed() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &300_u64,
    );
    c.approve_clawback(&id, &f.receiver);

    // Advance past expiry
    set_time(&f.env, 301);
    c.execute_clawback(&id, &f.sender);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_clawback_not_enabled_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    set_time(&f.env, 100);
    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &CURVE_LINEAR,
        &false,
        &false, // clawback NOT enabled
        &None,
    );

    set_time(&f.env, 150);
    let withdrawn = c.withdraw(&stream_id, &f.receiver);

    c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #45)")]
fn test_double_execute_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
    c.approve_clawback(&id, &f.receiver);
    c.execute_clawback(&id, &f.sender);
    c.execute_clawback(&id, &f.sender); // should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #47)")]
fn test_double_approve_rejected() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    let id = c.request_clawback(
        &stream_id,
        &f.sender,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
    c.approve_clawback(&id, &f.receiver);
    c.approve_clawback(&id, &f.receiver); // should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_sender_cannot_request_clawback() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let stranger = Address::generate(&f.env);
    let (stream_id, withdrawn) = make_clawback_stream(&f.env, &c, &f.sender, &f.receiver, &f.token);

    c.request_clawback(
        &stream_id,
        &stranger,
        &withdrawn,
        &reason(&f.env),
        &1_u32,
        &0_u64,
    );
}

#[test]
fn test_get_nonexistent_clawback_returns_none() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    assert!(c.get_clawback_request(&9999_u64).is_none());
}
