#![cfg(test)]
//! Comprehensive test suite for the dispute resolution framework.
//!
//! Covers the full dispute lifecycle: raising disputes, arbitrator voting,
//! threshold-based auto-execution, all four resolution types, stream freezing,
//! and error conditions.

use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String, Vec,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (contract_id.clone(), TokenClient::new(env, &contract_id))
}

struct TestCtx {
    env: Env,
    client: StellarStreamContractClient<'static>,
    admin: Address,
    sender: Address,
    receiver: Address,
    arbiter: Address,
    arbiter2: Address,
    stranger: Address,
    token: Address,
}

fn setup() -> TestCtx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let arbiter2 = Address::generate(&env);
    let stranger = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);
    token_admin_client.mint(&sender, &1_000_000);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Add arbitrators
    client.add_arbitrator(&admin, &arbiter);
    client.add_arbitrator(&admin, &arbiter2);

    TestCtx {
        env,
        client,
        admin,
        sender,
        receiver,
        arbiter,
        arbiter2,
        stranger,
        token: token_address,
    }
}

impl TestCtx {
    fn create_stream(&self) -> u64 {
        let milestones = Vec::new(&self.env);
        self.client.create_stream_with_milestones(
            &self.sender,
            &self.receiver,
            &self.token,
            &1000,
            &100,
            &100,
            &200,
            &milestones,
            &crate::types::CurveType::Linear,
            &false,
            &None,
        )
    }
}

#[test]
fn test_add_arbitrator() {
    let ctx = setup();
    let arbitrators = ctx.client.get_arbitrators();
    assert!(arbitrators.contains(ctx.arbiter.clone()));
    assert!(ctx.client.is_arbitrator(&ctx.arbiter));
}

#[test]
fn test_remove_arbitrator() {
    let ctx = setup();
    ctx.client.remove_arbitrator(&ctx.admin, &ctx.arbiter);
    let arbitrators = ctx.client.get_arbitrators();
    assert!(!arbitrators.contains(ctx.arbiter.clone()));
    assert!(!ctx.client.is_arbitrator(&ctx.arbiter));
}

#[test]
fn test_set_arbiter() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);
    let stream = ctx.client.get_stream(&stream_id);
    assert_eq!(stream.arbiter, Some(ctx.arbiter.clone()));
}

#[test]
fn test_freeze_stream() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);
    ctx.client.freeze_stream(&stream_id, &ctx.arbiter);
    let stream = ctx.client.get_stream(&stream_id);
    assert!(stream.is_frozen);
}

#[test]
fn test_unfreeze_stream() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);
    ctx.client.freeze_stream(&stream_id, &ctx.arbiter);
    ctx.client.unfreeze_stream(&stream_id, &ctx.arbiter);
    let stream = ctx.client.get_stream(&stream_id);
    assert!(!stream.is_frozen);
}

#[test]
fn test_raise_dispute_by_sender() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Sender dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
    let dispute = ctx.client.get_dispute(&dispute_id);
    assert!(dispute.is_some());
    let dispute = dispute.unwrap();
    assert_eq!(dispute.stream_id, stream_id);
    assert_eq!(dispute.raised_by, ctx.sender);
    assert!(!dispute.resolved);
    // Stream should be frozen
    let stream = ctx.client.get_stream(&stream_id);
    assert!(stream.is_frozen);
}

#[test]
fn test_raise_dispute_by_receiver() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Receiver dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.receiver,
        &reason,
        &crate::types::DisputeResolution::PayReceiver(500),
    );
    let dispute = ctx.client.get_dispute(&dispute_id).unwrap();
    assert_eq!(dispute.raised_by, ctx.receiver);
}

#[test]
#[should_panic(expected = "Error(Contract, #30)")]
fn test_raise_dispute_by_stranger_fails() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Invalid dispute");
    ctx.client.raise_dispute(
        &stream_id,
        &ctx.stranger,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn test_raise_dispute_unknown_stream_fails() {
    let ctx = setup();
    let reason = String::from_str(&ctx.env, "Invalid stream");
    ctx.client.raise_dispute(
        &999,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
}

#[test]
fn test_vote_on_dispute_auto_executes() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Cancel dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );

    // Vote approve - should auto-execute since required_votes = 1
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);

    let dispute = ctx.client.get_dispute(&dispute_id).unwrap();
    assert!(dispute.resolved);

    // Stream should be closed
    let stream = ctx.client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);
}

#[test]
#[should_panic(expected = "Error(Contract, #31)")]
fn test_vote_by_non_arbitrator_fails() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Test dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.stranger, &true);
}

#[test]
#[should_panic(expected = "Error(Contract, #29)")]
fn test_vote_unknown_dispute_fails() {
    let ctx = setup();
    ctx.client.vote_on_dispute(&999, &ctx.arbiter, &true);
}

#[test]
#[should_panic(expected = "Error(Contract, #34)")]
fn test_double_vote_fails() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Test dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);
    // Second vote should fail
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &false);
}

#[test]
fn test_resolve_dispute_refund_sender() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Refund dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.receiver,
        &reason,
        &crate::types::DisputeResolution::RefundSender(400),
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);

    let token_client = TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(token_client.balance(&ctx.sender), 1_000_000 - 1000 + 400);
}

#[test]
fn test_resolve_dispute_pay_receiver() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Pay receiver dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::PayReceiver(600),
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);

    let token_client = TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(token_client.balance(&ctx.receiver), 600);
}

#[test]
fn test_resolve_dispute_freeze_stream() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Freeze dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::FreezeStream,
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);

    let stream = ctx.client.get_stream(&stream_id);
    assert!(stream.is_frozen);
    assert_eq!(stream.state, crate::types::StreamState::Active);
}

#[test]
fn test_resolve_dispute_cancel_stream() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Cancel dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );
    ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true);

    let stream = ctx.client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);

    let token_client = TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(token_client.balance(&ctx.receiver), 1000);
}

#[test]
fn test_resolve_dispute_legacy() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);
    ctx.client.resolve_dispute(&stream_id, &ctx.arbiter, &6000);

    let stream = ctx.client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);

    let token_client = TokenClient::new(&ctx.env, &ctx.token);
    assert_eq!(token_client.balance(&ctx.receiver), 600);
    assert_eq!(token_client.balance(&ctx.sender), 1_000_000 - 1000 + 400);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_arbiter_cannot_freeze() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);
    ctx.client.freeze_stream(&stream_id, &ctx.stranger);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_sender_cannot_set_arbiter() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.stranger, &ctx.arbiter);
}

#[test]
fn test_withdraw_from_frozen_stream_fails() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    ctx.client.set_arbiter(&stream_id, &ctx.sender, &ctx.arbiter);

    ctx.env.ledger().with_mut(|li| li.timestamp = 150);
    ctx.client.freeze_stream(&stream_id, &ctx.arbiter);

    // Withdraw should fail because stream is frozen (is_frozen = true)
    let result = std::panic::catch_unwind(|| ctx.client.withdraw(&stream_id, &ctx.receiver));
    assert!(result.is_err());
}

#[test]
fn test_dispute_expired() {
    let ctx = setup();
    let stream_id = ctx.create_stream();
    let reason = String::from_str(&ctx.env, "Expired dispute");
    let dispute_id = ctx.client.raise_dispute(
        &stream_id,
        &ctx.sender,
        &reason,
        &crate::types::DisputeResolution::CancelStream,
    );

    // Advance time past the 7-day deadline
    ctx.env
        .ledger()
        .with_mut(|li| li.timestamp = 1_000 + 7 * 24 * 60 * 60 + 1);

    let result = std::panic::catch_unwind(|| {
        ctx.client.vote_on_dispute(&dispute_id, &ctx.arbiter, &true)
    });
    assert!(result.is_err());
}