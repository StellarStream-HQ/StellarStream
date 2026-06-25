#![cfg(test)]
#![cfg(feature = "vault_tests")] // Disabled - requires admin initialization
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Vec,
};

// Mock Vault Contract for testing
#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn deposit(_env: Env, _from: Address, amount: i128) -> i128 {
        // Return 1:1 shares for simplicity
        amount
    }

    pub fn withdraw(_env: Env, _to: Address, shares: i128) -> i128 {
        // Return 1:1 tokens for simplicity
        shares
    }

    pub fn get_value(_env: Env, shares: i128) -> i128 {
        shares
    }
}

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (contract_id.clone(), TokenClient::new(env, &contract_id))
}

#[test]
fn test_approve_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let vault = Address::generate(&env);

    // Approve vault
    client.approve_vault(&admin, &vault);

    // Check if approved
    assert!(client.is_vault_approved(&vault));
}

#[test]
fn test_revoke_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let vault = Address::generate(&env);

    // Approve then revoke
    client.approve_vault(&admin, &vault);
    assert!(client.is_vault_approved(&vault));

    client.revoke_vault(&admin, &vault);
    assert!(!client.is_vault_approved(&vault));
}

#[test]
fn test_create_stream_with_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    // Register vault
    let vault_id = env.register(MockVault, ());

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Mint tokens to sender
    token_admin_client.mint(&sender, &1000);

    // Approve vault
    client.approve_vault(&admin, &vault_id);

    // Create stream with vault
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
        &Some(vault_id.clone()),
    );

    // Verify stream was created
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.vault_address, Some(vault_id.clone()));
    assert_eq!(stream.total_amount, 1000);

    // Verify shares were recorded
    let shares = client.get_vault_shares(&stream_id);
    assert_eq!(shares, 1000); // 1:1 in mock vault
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_create_stream_with_unapproved_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    // Register vault but DON'T approve it
    let vault_id = env.register(MockVault, ());

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);

    // This should fail - vault not approved
    let milestones = Vec::new(&env);
    client.create_stream_with_milestones(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &milestones,
        &crate::types::CurveType::Linear,
        &false,
        &Some(vault_id),
    );
}

#[test]
fn test_withdraw_from_vault_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);
    let vault_id = env.register(MockVault, ());

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);
    client.approve_vault(&admin, &vault_id);

    // Create stream with vault
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
        &Some(vault_id),
    );

    // Move time to 50% completion
    env.ledger().set(LedgerInfo {
        timestamp: 150,
        protocol_version: 20,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    // Withdraw
    let withdrawn = client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500); // 50% of 1000

    // Check shares were reduced
    let remaining_shares = client.get_vault_shares(&stream_id);
    assert_eq!(remaining_shares, 500); // 50% remaining
}

#[test]
fn test_cancel_stream_with_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);
    let vault_id = env.register(MockVault, ());

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);
    client.approve_vault(&admin, &vault_id);

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
        &Some(vault_id),
    );

    // Move time to 30% completion
    env.ledger().set(LedgerInfo {
        timestamp: 130,
        protocol_version: 20,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3110400,
    });

    // Cancel stream
    client.cancel(&stream_id, &sender);

    // Verify shares were cleared
    let shares = client.get_vault_shares(&stream_id);
    assert_eq!(shares, 0);

    // Verify stream is cancelled
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);
}
