#![cfg(test)]

use crate::{mock_vault::MockVault, types::*, StellarStreamContract};
use soroban_sdk::{testutils::{Address as _, Ledger}, token, Address, Env};

fn setup_integration_test() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
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
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    // Mint tokens to sender
    token_client.mint(&sender, &100000);

    (
        env,
        admin,
        sender,
        receiver,
        token_address,
    )
}

#[test]
fn test_vault_deposit_and_balance_check() {
    let (env, admin, sender, _receiver, token_address) = setup_integration_test();

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Deposit directly to vault
    let balance = vault_client.deposit(&sender, &token_address, &5000);
    assert!(balance.is_ok());
    assert_eq!(balance.unwrap(), 5000);

    // Check balance
    let stored_balance = vault_client.get_balance(&sender);
    assert_eq!(stored_balance, 5000);

    // Withdraw
    let result = vault_client.withdraw(&sender, &token_address, &2000);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 3000);
}

#[test]
fn test_vault_paused_withdrawals() {
    let (env, admin, sender, _receiver, token_address) = setup_integration_test();

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Deposit to vault
    let _balance = vault_client.deposit(&sender, &token_address, &5000);

    // Pause withdrawals
    let pause_result = vault_client.pause_withdrawals(&admin);
    assert!(pause_result.is_ok());
    assert!(vault_client.is_paused());

    // Try to withdraw - should fail
    let result = vault_client.withdraw(&sender, &token_address, &1000);
    assert!(result.is_err());

    // Resume withdrawals
    let resume_result = vault_client.resume_withdrawals(&admin);
    assert!(resume_result.is_ok());
    assert!(!vault_client.is_paused());

    // Now withdrawal should succeed
    let result = vault_client.withdraw(&sender, &token_address, &1000);
    assert!(result.is_ok());
}

#[test]
fn test_stream_survives_vault_pause() {
    let (env, admin, sender, receiver, token_address) = setup_integration_test();

    // Deploy streaming contract
    let stream_contract_id = env.register(StellarStreamContract, ());
    let stream_client = soroban_sdk::Client::new(&env, &stream_contract_id);

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Create stream
    let stream_id = stream_client.create_stream(
        &sender,
        &receiver,
        &token_address,
        &10000,
        &100, &100,
        &300,
        &CurveType::Linear,
        &false,
    );

    // Advance time to middle of stream
    env.ledger().with_mut(|li| li.timestamp = 200);

    // Pause vault withdrawals
    let _pause_result = vault_client.pause_withdrawals(&admin);

    // Stream should still be queryable and functional
    let stream = stream_client.get_stream(&stream_id);
    assert_ne!(stream.state, crate::types::StreamState::Closed);
    assert_eq!(stream.total_amount, 10000);

    // The stream contract should handle vault failures gracefully
    // This test verifies the stream doesn't get corrupted when external vault is paused
}

#[test]
fn test_vault_yield_generation() {
    let (env, admin, sender, _receiver, token_address) = setup_integration_test();

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Deposit to vault
    let _balance = vault_client.deposit(&sender, &token_address, &10000);

    // Initial balance
    let initial_balance = vault_client.get_balance(&sender);
    assert_eq!(initial_balance, 10000);

    // Set 5% yield (500 basis points)
    let _yield_result = vault_client.set_yield_rate(&admin, &500);

    // Check balance with yield
    let balance_with_yield = vault_client.get_balance(&sender);
    assert_eq!(balance_with_yield, 10500); // 10000 + 5%

    // Verify interest calculation
    let interest = crate::interest::calculate_vault_interest(balance_with_yield, initial_balance);
    assert_eq!(interest, 500);
}

#[test]
fn test_vault_interest_distribution() {
    let (env, admin, sender, _receiver, token_address) = setup_integration_test();

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Deposit principal
    let principal = 10000i128;
    let _balance = vault_client.deposit(&sender, &token_address, &principal);

    // Generate 10% yield
    let _yield_result = vault_client.set_yield_rate(&admin, &1000);

    // Get balance with yield
    let current_value = vault_client.get_balance(&sender);
    assert_eq!(current_value, 11000);

    // Calculate interest
    let interest = crate::interest::calculate_vault_interest(current_value, principal);
    assert_eq!(interest, 1000);

    // Test different distribution strategies
    let dist_to_receiver = crate::interest::calculate_interest_distribution(
        interest,
        INTEREST_TO_RECEIVER,
    );
    assert_eq!(dist_to_receiver.to_receiver, 1000);
    assert_eq!(dist_to_receiver.to_sender, 0);

    let dist_split = crate::interest::calculate_interest_distribution(interest, 3); // 50/50
    assert_eq!(dist_split.to_sender, 500);
    assert_eq!(dist_split.to_receiver, 500);
}

#[test]
fn test_vault_insufficient_balance() {
    let (env, admin, sender, _receiver, token_address) = setup_integration_test();

    // Deploy mock vault
    let vault_id = env.register(MockVault, ());
    let vault_client = soroban_sdk::Client::new(&env, &vault_id);
    vault_client.initialize(&admin);

    // Deposit
    let _balance = vault_client.deposit(&sender, &token_address, &1000);

    // Try to withdraw more than balance
    let result = vault_client.withdraw(&sender, &token_address, &2000);
    assert!(result.is_err());
}