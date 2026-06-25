#![cfg(test)]

use crate::{types::CurveType, StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

fn setup(env: &Env) -> (StellarStreamContractClient, Address, Address, Address) {
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(env, &contract_id);
    let sender = Address::generate(env);
    let receiver = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(env, &token_id).mint(&sender, &10000);
    (client, sender, receiver, token_id)
}

#[test]
fn test_active_stream_returns_true() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 250);
    assert!(client.is_stream_active(&stream_id));
}

#[test]
fn test_completed_stream_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    // Past end_time
    env.ledger().with_mut(|li| li.timestamp = 600);
    assert!(!client.is_stream_active(&stream_id));
}

#[test]
fn test_cancelled_stream_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.cancel(&stream_id, &sender);

    assert!(!client.is_stream_active(&stream_id));
}

#[test]
fn test_nonexistent_stream_returns_false() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    assert!(!client.is_stream_active(&999_u64));
}

#[test]
fn test_paused_stream_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);

    assert!(!client.is_stream_active(&stream_id));
}
