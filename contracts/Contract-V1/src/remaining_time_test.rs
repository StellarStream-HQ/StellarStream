#![cfg(test)]

use crate::{errors::Error, types::CurveType, StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

#[test]
fn test_remaining_time_counts_down() {
    let env = Env::default();
    env.mock_all_auths();

    // Start ledger at t=0
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    StellarAssetClient::new(&env, &token_id).mint(&sender, &1000);

    // Stream: starts at 100, ends at 600 → total duration 500s
    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &100, &100,
        &600,
        &CurveType::Linear,
        &false,
    );

    // Before stream starts: full duration remaining
    env.ledger().with_mut(|li| li.timestamp = 100);
    let remaining = client.get_stream_remaining_time(&stream_id);
    assert_eq!(remaining, 500);

    // Midway through: half remaining
    env.ledger().with_mut(|li| li.timestamp = 350);
    let remaining = client.get_stream_remaining_time(&stream_id);
    assert_eq!(remaining, 250);

    // One second before end
    env.ledger().with_mut(|li| li.timestamp = 599);
    let remaining = client.get_stream_remaining_time(&stream_id);
    assert_eq!(remaining, 1);

    // At end time: returns 0
    env.ledger().with_mut(|li| li.timestamp = 600);
    let remaining = client.get_stream_remaining_time(&stream_id);
    assert_eq!(remaining, 0);

    // Past end time: still returns 0
    env.ledger().with_mut(|li| li.timestamp = 999);
    let remaining = client.get_stream_remaining_time(&stream_id);
    assert_eq!(remaining, 0);
}

#[test]
fn test_remaining_time_stream_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let result = client.try_get_stream_remaining_time(&999);
    assert_eq!(result, Err(Ok(Error::StreamNotFound)));
}
