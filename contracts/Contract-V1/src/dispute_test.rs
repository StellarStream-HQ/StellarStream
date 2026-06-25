#![cfg(test)]
#![cfg(feature = "dispute_tests")] // Disabled - requires dispute resolution implementation
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Vec,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (contract_id.clone(), TokenClient::new(env, &contract_id))
}

#[test]
fn test_freeze_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let milestones = Vec::new(&env);
    let stream_id = client.create_stream_with_milestones(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &milestones,
        &crate::types::CurveType::Linear,
        &false,
        &None,
    );

    client.set_arbiter(&stream_id, &sender, &arbiter);
    client.freeze_stream(&stream_id, &arbiter);

    let stream = client.get_stream(&stream_id);
    assert!(stream.is_frozen);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_withdraw_from_frozen_stream_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let milestones = Vec::new(&env);
    let stream_id = client.create_stream_with_milestones(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &milestones,
        &crate::types::CurveType::Linear,
        &false,
        &None,
    );

    client.set_arbiter(&stream_id, &sender, &arbiter);

    env.ledger().set(LedgerInfo {
        timestamp: 150,
        protocol_version: 22,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    client.freeze_stream(&stream_id, &arbiter);
    client.withdraw(&stream_id, &receiver);
}

#[test]
fn test_resolve_dispute() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let arbiter = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let milestones = Vec::new(&env);
    let stream_id = client.create_stream_with_milestones(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &milestones,
        &crate::types::CurveType::Linear,
        &false,
        &None,
    );

    client.set_arbiter(&stream_id, &sender, &arbiter);
    client.resolve_dispute(&stream_id, &arbiter, &6000);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);

    let token_client = TokenClient::new(&env, &token_address);
    assert_eq!(token_client.balance(&receiver), 600);
    assert_eq!(token_client.balance(&sender), 400);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_arbiter_cannot_freeze() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let non_arbiter = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let milestones = Vec::new(&env);
    let stream_id = client.create_stream_with_milestones(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &milestones,
        &crate::types::CurveType::Linear,
        &false,
        &None,
    );

    client.set_arbiter(&stream_id, &sender, &arbiter);
    client.freeze_stream(&stream_id, &non_arbiter);
}
