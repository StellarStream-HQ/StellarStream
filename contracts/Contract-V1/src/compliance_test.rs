#![cfg(test)]
//! Integration tests for OFAC-style compliance (the restricted-address list).
//!
//! The contract maintains a restricted-address list (a compliance denylist).
//! A `SuperAdmin` may restrict and unrestrict addresses, and restricted
//! addresses cannot receive new streams, be the receiver of a proposal, or
//! receive a transferred stream receipt.
//!
//! # Scenarios covered
//!
//! - Restricting and unrestricting addresses (SuperAdmin only).
//! - List idempotency, isolation and correct removal semantics.
//! - Enforcement at stream creation, proposal creation and receipt transfer.
//! - Re-enabling a previously restricted receiver after unrestriction.

use crate::types::CurveType;
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

/// Deploy the contract and initialize it with a SuperAdmin.
fn setup() -> (Env, StellarStreamContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, client, admin)
}

/// Create a token contract and mint `amount` tokens to `recipient`.
fn create_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = StellarAssetClient::new(env, &token);
    token_admin.mint(recipient, &amount);
    token
}

#[test]
fn test_restricted_list_starts_empty() {
    let (_env, client, _admin) = setup();

    assert_eq!(client.get_restricted_addresses().len(), 0);
}

#[test]
fn test_admin_can_restrict_address() {
    let (env, client, admin) = setup();
    let target = Address::generate(&env);

    client.restrict_address(&admin, &target);

    assert!(client.is_address_restricted(&target));
}

#[test]
fn test_admin_can_unrestrict_address() {
    let (env, client, admin) = setup();
    let target = Address::generate(&env);

    client.restrict_address(&admin, &target);
    assert!(client.is_address_restricted(&target));

    client.unrestrict_address(&admin, &target);

    assert!(!client.is_address_restricted(&target));
}

#[test]
fn test_restrict_multiple_addresses() {
    let (env, client, admin) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    client.restrict_address(&admin, &a);
    client.restrict_address(&admin, &b);
    client.restrict_address(&admin, &c);

    assert_eq!(client.get_restricted_addresses().len(), 3);
    assert!(client.is_address_restricted(&a));
    assert!(client.is_address_restricted(&b));
    assert!(client.is_address_restricted(&c));
}

#[test]
fn test_restrict_same_address_is_idempotent() {
    let (env, client, admin) = setup();
    let target = Address::generate(&env);

    client.restrict_address(&admin, &target);
    client.restrict_address(&admin, &target);

    assert_eq!(client.get_restricted_addresses().len(), 1);
    assert!(client.is_address_restricted(&target));
}

#[test]
fn test_unrestrict_removes_only_target() {
    let (env, client, admin) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.restrict_address(&admin, &a);
    client.restrict_address(&admin, &b);
    client.unrestrict_address(&admin, &a);

    assert!(!client.is_address_restricted(&a));
    assert!(client.is_address_restricted(&b));
    assert_eq!(client.get_restricted_addresses().len(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_admin_cannot_restrict() {
    let (env, client, _admin) = setup();
    let non_admin = Address::generate(&env);
    let target = Address::generate(&env);

    client.restrict_address(&non_admin, &target);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_admin_cannot_unrestrict() {
    let (env, client, admin) = setup();
    let non_admin = Address::generate(&env);
    let target = Address::generate(&env);

    client.restrict_address(&admin, &target);
    client.unrestrict_address(&non_admin, &target);
}

#[test]
fn test_is_address_restricted_unknown_returns_false() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);

    assert!(!client.is_address_restricted(&stranger));
}

#[test]
fn test_unrestrict_unknown_address_is_noop() {
    let (env, client, admin) = setup();
    let stranger = Address::generate(&env);

    client.unrestrict_address(&admin, &stranger);

    assert_eq!(client.get_restricted_addresses().len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_cannot_create_stream_to_restricted_receiver() {
    let (env, client, admin) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = create_token(&env, &admin, &sender, 1000);

    client.restrict_address(&admin, &receiver);

    client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_cannot_create_proposal_to_restricted_receiver() {
    let (env, client, admin) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = create_token(&env, &admin, &sender, 1000);

    client.restrict_address(&admin, &receiver);

    client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_cannot_transfer_receipt_to_restricted_address() {
    let (env, client, admin) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let restricted = Address::generate(&env);
    let token = create_token(&env, &admin, &sender, 1000);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );

    client.restrict_address(&admin, &restricted);

    client.transfer_receipt(&stream_id, &receiver, &restricted);
}

#[test]
fn test_stream_creation_allowed_after_unrestriction() {
    let (env, client, admin) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = create_token(&env, &admin, &sender, 1000);

    client.restrict_address(&admin, &receiver);
    client.unrestrict_address(&admin, &receiver);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.receiver, receiver);
}

#[test]
fn test_restricting_one_address_does_not_block_others() {
    let (env, client, admin) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let sender = Address::generate(&env);
    let good_receiver = Address::generate(&env);
    let restricted = Address::generate(&env);
    let token = create_token(&env, &admin, &sender, 2000);

    client.restrict_address(&admin, &restricted);

    let stream_id = client.create_stream(
        &sender,
        &good_receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.receiver, good_receiver);
}
