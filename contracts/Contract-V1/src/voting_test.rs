#![cfg(test)]
#![cfg(feature = "voting_tests")] // Disabled - requires voting implementation
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (contract_id.clone(), TokenClient::new(env, &contract_id))
}

#[test]
fn test_get_voting_power() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    // Create stream
    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    // At start: 0 voting power
    env.ledger().set(LedgerInfo {
        timestamp: 100,
        protocol_version: 22,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    let power = client.get_voting_power(&stream_id);
    assert_eq!(power, 0);

    // At 50%: 500 voting power
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
    let power = client.get_voting_power(&stream_id);
    assert_eq!(power, 500);

    // At end: 1000 voting power
    env.ledger().set(LedgerInfo {
        timestamp: 200,
        protocol_version: 22,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });
    let power = client.get_voting_power(&stream_id);
    assert_eq!(power, 1000);
}

#[test]
fn test_delegate_voting_power() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let delegate = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    // Delegate voting power
    client.delegate_voting_power(&stream_id, &receiver, &delegate);

    // Verify delegation
    let delegated_to = client.get_voting_delegate(&stream_id);
    assert_eq!(delegated_to, Some(delegate.clone()));
}

#[test]
fn test_get_delegated_voting_power() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let delegate = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &2000);

    // Create two streams
    let stream_id1 = client.create_stream(
        &sender,
        &receiver1,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    let stream_id2 = client.create_stream(
        &sender,
        &receiver2,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    // Both delegate to same address
    client.delegate_voting_power(&stream_id1, &receiver1, &delegate);
    client.delegate_voting_power(&stream_id2, &receiver2, &delegate);

    // Move to 50% completion
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

    // Delegate should have combined voting power
    let total_power = client.get_delegated_voting_power(&delegate);
    assert_eq!(total_power, 1000); // 500 + 500
}

#[test]
fn test_voting_power_after_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    // Move to 50%
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

    // Voting power before withdrawal
    let power_before = client.get_voting_power(&stream_id);
    assert_eq!(power_before, 500);

    // Withdraw
    client.withdraw(&stream_id, &receiver);

    // Voting power after withdrawal should be 0
    let power_after = client.get_voting_power(&stream_id);
    assert_eq!(power_after, 0);
}
