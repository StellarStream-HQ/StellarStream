#![cfg(test)]
//! Integration tests for complex, multi-step cross-feature workflows.
//!
//! These scenarios chain several features together to model realistic usage:
//! a proposal that becomes a stream and is withdrawn; pausing and resuming a
//! stream around withdrawals; cancelling with pro-rata refunds; soulbound and
//! receipt transfers; topping up; contributor payment requests; batch creation;
//! and cliff/exponential vesting schedules.
//!
//! # Scenarios covered
//!
//! - Multi-signature proposal → stream → withdrawal.
//! - Restriction → unrestriction → stream creation.
//! - Pause/resume effects on vesting and withdrawal.
//! - Cancel with pro-rata refunds to sender and receiver.
//! - Soulbound transfer blocking vs. normal receiver transfer.
//! - Receipt transfer and metadata queries.
//! - Top-up, batch creation, and contributor request workflows.
//! - Access-control revocation and error paths.

use crate::errors::Error;
use crate::rbac::Role;
use crate::types::{CurveType, StreamRequest, StreamState};
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, BytesN, Env, Vec};

/// Deploy the contract, a token (minting 100,000 to both `admin` and
/// `sender`), and initialize `admin` with every role.
///
/// Returns `(env, client, admin, sender, receiver, token)`.
fn setup() -> (
    Env,
    StellarStreamContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &100_000);
    token_admin.mint(&admin, &100_000);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, client, admin, sender, receiver, token)
}

#[test]
fn test_proposal_to_withdraw_workflow() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let proposal_id =
        client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &1, &1000);

    let approver = Address::generate(&env);
    client.approve_proposal(&proposal_id, &approver);

    let stream_id = 0;
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.receiver, receiver);
    assert_eq!(stream.total_amount, 1000);

    env.ledger().with_mut(|li| li.timestamp = 150);
    let withdrawn = client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&receiver), 500);
}

#[test]
fn test_restriction_then_unrestriction_then_stream() {
    let (env, client, admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    client.restrict_address(&admin, &receiver);
    assert!(client.is_address_restricted(&receiver));

    client.unrestrict_address(&admin, &receiver);
    assert!(!client.is_address_restricted(&receiver));

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

    assert_eq!(client.get_stream(&stream_id).receiver, receiver);
}

#[test]
fn test_pause_resume_affects_withdrawal() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &300,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 150);
    client.pause_stream(&stream_id, &sender);

    env.ledger().with_mut(|li| li.timestamp = 200);
    let result = client.try_withdraw(&stream_id, &receiver);
    assert_eq!(result, Err(Ok(Error::StreamPaused)));

    client.resume_stream(&stream_id, &sender);

    env.ledger().with_mut(|li| li.timestamp = 250);
    let withdrawn = client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500);
}

#[test]
fn test_cancel_stream_refunds_pro_rata() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 150);
    client.cancel(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, StreamState::Closed);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&receiver), 500);
    assert_eq!(token_client.balance(&sender), 99_500);
}

#[test]
fn test_soulbound_stream_cannot_transfer_receiver() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &true,
    );

    let new_receiver = Address::generate(&env);
    let result = client.try_transfer_receiver(&stream_id, &sender, &new_receiver);
    assert_eq!(result, Err(Ok(Error::StreamIsSoulbound)));
}

#[test]
fn test_normal_stream_can_transfer_receiver() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    let new_receiver = Address::generate(&env);
    client.transfer_receiver(&stream_id, &sender, &new_receiver);

    assert_eq!(client.get_stream(&stream_id).receiver, new_receiver);
}

#[test]
fn test_receipt_transfer_updates_owner() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    let new_owner = Address::generate(&env);
    client.transfer_receipt(&stream_id, &receiver, &new_owner);

    let receipt = client.get_receipt(&stream_id).unwrap();
    assert_eq!(receipt.owner, new_owner);
    assert_eq!(client.get_stream(&stream_id).receipt_owner, new_owner);
}

#[test]
fn test_top_up_extends_stream() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    client.top_up_stream(&stream_id, &sender, &1000);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 2000);
    assert_eq!(stream.end_time, 300);
}

#[test]
fn test_withdraw_partial_then_more() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 125);
    let first = client.withdraw(&stream_id, &receiver);
    assert_eq!(first, 250);

    env.ledger().with_mut(|li| li.timestamp = 150);
    let second = client.withdraw(&stream_id, &receiver);
    assert_eq!(second, 250);

    assert_eq!(client.get_stream(&stream_id).withdrawn_amount, 500);
}

#[test]
fn test_contributor_request_workflow() {
    let (env, client, admin, _sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let metadata: Option<BytesN<32>> = None;
    let request_id = client.create_request(&receiver, &token, &1000, &100, &metadata);

    let stream_id = client.execute_request(&admin, &request_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.receiver, receiver);
    assert_eq!(stream.sender, admin);
    assert_eq!(stream.total_amount, 1000);
}

#[test]
fn test_multiple_proposals_create_multiple_streams() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let p1 = client.create_proposal(&sender, &receiver, &token, &1000, &100, &200, &1, &1000);
    let p2 = client.create_proposal(&sender, &receiver, &token, &2000, &100, &200, &1, &1000);

    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    client.approve_proposal(&p1, &a1);
    client.approve_proposal(&p2, &a2);

    let stream0 = client.get_stream(&0);
    let stream1 = client.get_stream(&1);
    assert_eq!(stream0.total_amount, 1000);
    assert_eq!(stream1.total_amount, 2000);
}

#[test]
fn test_cancel_sets_stream_closed() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    client.cancel(&stream_id, &sender);

    assert_eq!(client.get_stream(&stream_id).state, StreamState::Closed);
}

#[test]
fn test_withdraw_from_unknown_stream_fails() {
    let (_env, client, _admin, _sender, receiver, _token) = setup();

    let result = client.try_withdraw(&999, &receiver);
    assert_eq!(result, Err(Ok(Error::StreamNotFound)));
}

#[test]
fn test_withdraw_unauthorized_fails() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 150);
    let stranger = Address::generate(&env);
    let result = client.try_withdraw(&stream_id, &stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_cliff_blocks_withdrawal_until_cliff() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &130,
        &200,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 120);
    let before = client.try_withdraw(&stream_id, &receiver);
    assert_eq!(before, Err(Ok(Error::InsufficientBalance)));

    env.ledger().with_mut(|li| li.timestamp = 150);
    let withdrawn = client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500);
}

#[test]
fn test_exponential_curve_stream() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Exponential,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 150);
    let metadata = client.get_receipt_metadata(&stream_id);
    assert_eq!(metadata.unlocked_balance, 250);
    assert_eq!(metadata.locked_balance, 750);
}

#[test]
fn test_role_revocation_removes_privilege() {
    let (env, client, admin, _sender, _receiver, _token) = setup();

    let target = Address::generate(&env);
    client.grant_role(&admin, &target, &Role::SuperAdmin);
    assert!(client.check_role(&target, &Role::SuperAdmin));

    let another = Address::generate(&env);
    client.grant_role(&target, &another, &Role::Guardian);
    assert!(client.check_role(&another, &Role::Guardian));

    client.revoke_role(&admin, &target, &Role::SuperAdmin);
    assert!(!client.check_role(&target, &Role::SuperAdmin));
}

#[test]
fn test_batch_stream_creation() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let r2 = Address::generate(&env);
    let mut requests = Vec::new(&env);
    requests.push_back(StreamRequest {
        receiver,
        amount: 100,
        start_time: 100,
        cliff_time: 100,
        end_time: 200,
        interest_strategy: 0,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: r2,
        amount: 200,
        start_time: 100,
        cliff_time: 100,
        end_time: 200,
        interest_strategy: 0,
        vault_address: None,
        metadata: None,
    });

    let ids = client.create_batch_streams(&sender, &token, &requests);

    assert_eq!(ids.len(), 2);
    assert_eq!(client.get_stream(&ids.get(0).unwrap()).total_amount, 100);
    assert_eq!(client.get_stream(&ids.get(1).unwrap()).total_amount, 200);
}

#[test]
fn test_batch_withdraw_same_token() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let mut requests = Vec::new(&env);
    requests.push_back(StreamRequest {
        receiver: receiver.clone(),
        amount: 1000,
        start_time: 100,
        cliff_time: 100,
        end_time: 200,
        interest_strategy: 0,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: receiver.clone(),
        amount: 2000,
        start_time: 100,
        cliff_time: 100,
        end_time: 200,
        interest_strategy: 0,
        vault_address: None,
        metadata: None,
    });
    let ids = client.create_batch_streams(&sender, &token, &requests);

    // Half-way through both streams' vesting window.
    env.ledger().with_mut(|li| li.timestamp = 150);

    let amounts = client.batch_withdraw(&receiver, &ids);
    assert_eq!(amounts.get(0).unwrap(), 500);
    assert_eq!(amounts.get(1).unwrap(), 1000);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&receiver), 1500);

    assert_eq!(
        client.get_stream(&ids.get(0).unwrap()).withdrawn_amount,
        500
    );
    assert_eq!(
        client.get_stream(&ids.get(1).unwrap()).withdrawn_amount,
        1000
    );
}

#[test]
fn test_batch_withdraw_rejects_stream_not_owned_by_caller() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let owned_id = client.create_stream(
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

    let other_receiver = Address::generate(&env);
    let other_id = client.create_stream(
        &sender,
        &other_receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 150);

    let mut ids = Vec::new(&env);
    ids.push_back(owned_id);
    ids.push_back(other_id);

    let result = client.try_batch_withdraw(&receiver, &ids);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // Fail-fast: the owned stream ahead of the bad one must not have been
    // paid out either, since the whole batch was rejected.
    assert_eq!(client.get_stream(&owned_id).withdrawn_amount, 0);
    assert_eq!(TokenClient::new(&env, &token).balance(&receiver), 0);
}

#[test]
fn test_stream_receipt_metadata_unlocked() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 150);
    let metadata = client.get_receipt_metadata(&stream_id);
    assert_eq!(metadata.unlocked_balance, 500);
    assert_eq!(metadata.locked_balance, 500);
    assert_eq!(metadata.total_amount, 1000);
}

#[test]
fn test_get_stream_remaining_time() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 150);
    assert_eq!(client.get_stream_remaining_time(&stream_id), 50);
}

#[test]
fn test_withdraw_full_balance_at_end() {
    let (env, client, _admin, sender, receiver, token) = setup();
    env.ledger().with_mut(|li| li.timestamp = 100);

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

    env.ledger().with_mut(|li| li.timestamp = 250);
    let withdrawn = client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 1000);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&receiver), 1000);
}
