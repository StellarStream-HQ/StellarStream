#![cfg(test)]
//! Integration tests for OFAC-style compliance (the restricted-address list).
//!
//! Uses the shared `common` test harness. Admin operations use `grant_role` /
//! `restrict_address` / `unrestrict_address` as exposed by the contract.

use super::*;
use crate::common::{client, setup};
use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_restricted_list_starts_empty() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    assert!(!c.is_address_restricted(&f.receiver));
}

#[test]
fn test_admin_can_restrict_address() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);
    assert!(c.is_address_restricted(&f.receiver));
}

#[test]
fn test_admin_can_unrestrict_address() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);
    c.unrestrict_address(&f.admin, &f.receiver);
    assert!(!c.is_address_restricted(&f.receiver));
}

#[test]
fn test_restrict_multiple_addresses() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let addr2 = soroban_sdk::Address::generate(&f.env);
    c.restrict_address(&f.admin, &f.receiver);
    c.restrict_address(&f.admin, &addr2);
    assert!(c.is_address_restricted(&f.receiver));
    assert!(c.is_address_restricted(&addr2));
}

#[test]
fn test_restrict_same_address_is_idempotent() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);
    c.restrict_address(&f.admin, &f.receiver); // no-op
    assert!(c.is_address_restricted(&f.receiver));
}

#[test]
fn test_unrestrict_removes_only_target() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let addr2 = soroban_sdk::Address::generate(&f.env);
    c.restrict_address(&f.admin, &f.receiver);
    c.restrict_address(&f.admin, &addr2);
    c.unrestrict_address(&f.admin, &f.receiver);
    assert!(!c.is_address_restricted(&f.receiver));
    assert!(c.is_address_restricted(&addr2));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_non_admin_cannot_restrict() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let stranger = soroban_sdk::Address::generate(&f.env);
    c.restrict_address(&stranger, &f.receiver);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_non_admin_cannot_unrestrict() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let stranger = soroban_sdk::Address::generate(&f.env);
    c.unrestrict_address(&stranger, &f.receiver);
}

#[test]
fn test_is_address_restricted_unknown_returns_false() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let unknown = soroban_sdk::Address::generate(&f.env);
    assert!(!c.is_address_restricted(&unknown));
}

#[test]
fn test_unrestrict_unknown_address_is_noop() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let unknown = soroban_sdk::Address::generate(&f.env);
    // Should not panic
    c.unrestrict_address(&f.admin, &unknown);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_cannot_create_stream_to_restricted_receiver() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);

    set_time(&f.env, 100);
    c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_cannot_create_proposal_to_restricted_receiver() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);

    set_time(&f.env, 100);
    c.create_proposal(
        &f.sender,
        &f.receiver,
        &f.token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &1_u32,
        &1000_u64,
    );
}

#[test]
fn test_stream_creation_allowed_after_unrestriction() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);
    c.unrestrict_address(&f.admin, &f.receiver);

    set_time(&f.env, 100);
    let _result = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
}

#[test]
fn test_restricting_one_address_does_not_block_others() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let other_receiver = soroban_sdk::Address::generate(&f.env);
    c.restrict_address(&f.admin, &f.receiver);

    set_time(&f.env, 100);
    // Creating a stream to a different, unrestricted receiver should succeed
    let _result = c.create_stream(
        &f.sender,
        &other_receiver,
        &f.token,
        &1000_i128,
        &100_u64,
        &200_u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
}
