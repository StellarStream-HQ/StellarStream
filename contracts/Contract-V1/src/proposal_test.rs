#![cfg(test)]
//! Integration tests for multi-signature treasury proposals.
//!
//! A proposal lets a sender request treasury tokens that are only released once
//! a configured number of approvers sign off. Once the approval threshold is
//! reached the proposal auto-executes: tokens are moved from the proposer into
//! the contract and a new stream is minted for the receiver.
//!
//! # Scenarios covered
//!
//! - Proposal creation validation (time range, amount, approval threshold,
//!   deadline, and OFAC-restricted receivers).
//! - Single-approval and M-of-N multi-signature execution.
//! - Duplicate approvals, approvals after execution, expired proposals, and
//!   approvals for unknown proposal IDs.
//! - State transitions from `Pending` to `Executed` and the resulting stream.
//! - Event emission for proposal creation and approval.

use crate::errors::Error;
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

/// Deploy the contract and a token, minting a large balance to `sender`.
///
/// Returns `(env, client, sender, receiver, token)`.
fn setup() -> (
    Env,
    StellarStreamContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &1_000_000);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    (env, client, sender, receiver, token)
}

#[test]
fn test_create_proposal_assigns_id() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    assert_eq!(proposal_id, 0);
}

#[test]
fn test_create_proposal_stores_fields() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &3, &1000);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert_eq!(proposal.sender, sender);
    assert_eq!(proposal.receiver, receiver);
    assert_eq!(proposal.token, token);
    assert_eq!(proposal.total_amount, 1000);
    assert_eq!(proposal.start_time, 100);
    assert_eq!(proposal.end_time, 200);
    assert_eq!(proposal.required_approvals, 3);
    assert_eq!(proposal.deadline, 1000);
    assert!(!proposal.executed);
    assert_eq!(proposal.approvers.len(), 0);
}

#[test]
fn test_create_proposal_rejects_invalid_time_range() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let result = client.try_create_proposal(&sender, &receiver, &token, &1000, &200, &100, &2, &1000);

    assert_eq!(result, Err(Ok(Error::InvalidTimeRange)));
}

#[test]
fn test_create_proposal_rejects_zero_amount() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let result = client.try_create_proposal(&sender, &receiver, &token, &0, &100, &200, &2, &1000);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_create_proposal_rejects_negative_amount() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let result =
        client.try_create_proposal(&sender, &receiver, &token, &-1000, &100, &200, &2, &1000);

    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_create_proposal_rejects_zero_required_approvals() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let result = client.try_create_proposal(&sender, &receiver, &token, &1000, &100, &200, &0, &1000);

    assert_eq!(result, Err(Ok(Error::InvalidApprovalThreshold)));
}

#[test]
fn test_create_proposal_rejects_expired_deadline() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    // Deadline equals the current timestamp and is therefore already expired.
    let result = client.try_create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &100);

    assert_eq!(result, Err(Ok(Error::ProposalExpired)));
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_create_proposal_to_restricted_receiver_fails() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.restrict_address(&admin, &receiver);

    client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);
}

#[test]
fn test_single_approval_executes_proposal() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &1, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert!(proposal.executed);
    assert_eq!(proposal.approvers.len(), 1);
}

#[test]
fn test_approval_records_approver_without_executing() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert!(!proposal.executed);
    assert_eq!(proposal.approvers.len(), 1);
    assert_eq!(proposal.approvers.get(0).unwrap(), approver);
}

#[test]
fn test_two_of_two_multisig_executes() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    let approver1 = Address::generate(&env);
    let approver2 = Address::generate(&env);

    client.approve_proposal(&proposal_id, &approver1);
    assert!(!client.get_proposal(&proposal_id).unwrap().executed);

    client.approve_proposal(&proposal_id, &approver2);
    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert!(proposal.executed);
    assert_eq!(proposal.approvers.len(), 2);
}

#[test]
fn test_three_of_five_multisig_executes() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &3, &1000);

    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);

    client.approve_proposal(&proposal_id, &a1);
    client.approve_proposal(&proposal_id, &a2);
    assert!(!client.get_proposal(&proposal_id).unwrap().executed);

    client.approve_proposal(&proposal_id, &a3);
    let proposal = client.get_proposal(&proposal_id).unwrap();
    assert!(proposal.executed);
    assert_eq!(proposal.approvers.len(), 3);
}

#[test]
fn test_approve_unknown_proposal_fails() {
    let (env, client, _sender, _receiver, _token) = setup();
    let approver = Address::generate(&env);

    let result = client.try_approve_proposal(&999, &approver);

    assert_eq!(result, Err(Ok(Error::ProposalNotFound)));
}

#[test]
fn test_duplicate_approval_fails() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    let result = client.try_approve_proposal(&proposal_id, &approver);

    assert_eq!(result, Err(Ok(Error::AlreadyApproved)));
}

#[test]
fn test_approve_after_execution_fails() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &1, &1000);

    let approver1 = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver1);

    let approver2 = Address::generate(&env);
    let result = client.try_approve_proposal(&proposal_id, &approver2);

    assert_eq!(result, Err(Ok(Error::ProposalAlreadyExecuted)));
}

#[test]
fn test_approve_after_deadline_fails() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &150);

    env.ledger().with_mut(|li| li.timestamp = 200);

    let approver = Address::generate(&env);
    let result = client.try_approve_proposal(&proposal_id, &approver);

    assert_eq!(result, Err(Ok(Error::ProposalExpired)));
}

#[test]
fn test_executed_proposal_creates_stream() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &1, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    let stream = client.get_stream(&0);
    assert_eq!(stream.sender, sender);
    assert_eq!(stream.receiver, receiver);
    assert_eq!(stream.token, token);
    assert_eq!(stream.total_amount, 1000);
    assert_eq!(stream.start_time, 100);
    assert_eq!(stream.end_time, 200);
}

#[test]
fn test_create_proposal_emits_event() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    assert!(!env.events().all().is_empty());
}

#[test]
fn test_approve_proposal_emits_event() {
    let (env, client, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &2, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    assert!(!env.events().all().is_empty());
}
