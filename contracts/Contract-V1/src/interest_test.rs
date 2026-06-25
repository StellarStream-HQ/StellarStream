#![cfg(test)]

use crate::{interest, types::*, StellarStream, StellarStreamClient};
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Env,
};

fn setup_test_env() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    Address,
    StellarStreamClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy token contract
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Mint tokens to sender
    token_admin_client.mint(&sender, &10000);

    // Deploy streaming contract
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin);
    client.initialize_fee(&admin, &100, &admin); // 1% fee

    (
        env,
        admin,
        sender,
        receiver,
        token_address,
        token_admin,
        client,
    )
}

#[test]
fn test_create_stream_with_interest_strategy() {
    let (_env, _admin, sender, receiver, token_address, _token_admin, client) = setup_test_env();

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100,
        &100,
        &200,
        &INTEREST_TO_RECEIVER, // All interest to receiver
        &None,                 // No vault
        &None,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.interest_strategy, INTEREST_TO_RECEIVER);
    assert_eq!(stream.vault_address, None);
}

#[test]
fn test_create_stream_with_vault() {
    let (env, _admin, sender, receiver, token_address, _token_admin, client) = setup_test_env();

    let vault = Address::generate(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100,
        &100,
        &200,
        &INTEREST_TO_SENDER,
        &Some(vault.clone()),
        &None,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.interest_strategy, INTEREST_TO_SENDER);
    assert_eq!(stream.vault_address, Some(vault));
}

#[test]
fn test_interest_distribution_all_to_sender() {
    let dist = interest::calculate_interest_distribution(1000, INTEREST_TO_SENDER);
    assert_eq!(dist.to_sender, 1000);
    assert_eq!(dist.to_receiver, 0);
    assert_eq!(dist.to_protocol, 0);
    assert_eq!(dist.total_interest, 1000);
}

#[test]
fn test_interest_distribution_all_to_receiver() {
    let dist = interest::calculate_interest_distribution(1000, INTEREST_TO_RECEIVER);
    assert_eq!(dist.to_sender, 0);
    assert_eq!(dist.to_receiver, 1000);
    assert_eq!(dist.to_protocol, 0);
}

#[test]
fn test_interest_distribution_all_to_protocol() {
    let dist = interest::calculate_interest_distribution(1000, INTEREST_TO_PROTOCOL);
    assert_eq!(dist.to_sender, 0);
    assert_eq!(dist.to_receiver, 0);
    assert_eq!(dist.to_protocol, 1000);
}

#[test]
fn test_interest_distribution_50_50_split() {
    let dist = interest::calculate_interest_distribution(1000, 3); // 0b011
    assert_eq!(dist.to_sender, 500);
    assert_eq!(dist.to_receiver, 500);
    assert_eq!(dist.to_protocol, 0);
}

#[test]
fn test_interest_distribution_three_way_split() {
    let dist = interest::calculate_interest_distribution(1000, 7); // 0b111
    assert_eq!(dist.to_sender, 334); // Gets remainder
    assert_eq!(dist.to_receiver, 333);
    assert_eq!(dist.to_protocol, 333);
}

#[test]
fn test_vault_interest_calculation() {
    let interest = interest::calculate_vault_interest(1100, 1000);
    assert_eq!(interest, 100);
}

#[test]
fn test_vault_interest_no_gain() {
    let interest = interest::calculate_vault_interest(1000, 1000);
    assert_eq!(interest, 0);
}

#[test]
fn test_vault_interest_loss() {
    let interest = interest::calculate_vault_interest(900, 1000);
    assert_eq!(interest, 0); // No negative interest
}

#[test]
fn test_get_interest_info_no_vault() {
    let (_env, _admin, sender, receiver, token_address, _token_admin, client) = setup_test_env();

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100,
        &100,
        &200,
        &3,    // 50/50 split
        &None, // No vault
        &None,
    );

    let interest_info = client.get_interest_info(&stream_id);
    // No vault means no interest
    assert_eq!(interest_info.total_interest, 0);
    assert_eq!(interest_info.to_sender, 0);
    assert_eq!(interest_info.to_receiver, 0);
    assert_eq!(interest_info.to_protocol, 0);
}

#[test]
#[should_panic(expected = "Invalid interest strategy")]
fn test_invalid_interest_strategy() {
    let (_env, _admin, sender, receiver, token_address, _token_admin, client) = setup_test_env();

    client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &100,
        &200,
        &99, // Invalid strategy (> 7)
        &None,
        &None,
    );
}

#[test]
fn test_interest_distribution_with_remainder() {
    // Test that remainder is properly distributed
    let dist = interest::calculate_interest_distribution(1001, 3); // 50/50 split
    assert_eq!(dist.to_sender + dist.to_receiver, 1001);
    assert_eq!(dist.to_sender, 501); // Gets the remainder
    assert_eq!(dist.to_receiver, 500);
}
