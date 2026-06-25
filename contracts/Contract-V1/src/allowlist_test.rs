#![cfg(test)]
#![cfg(feature = "allowlist_tests")] // Disabled - requires allowlist implementation
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::Address as _,
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
fn test_allowlist_disabled_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    assert!(!client.is_allowlist_enabled());
}

#[test]
fn test_enable_allowlist() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Directly set admin role in storage for testing
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(admin.clone(), crate::types::Role::Admin),
            &true,
        );
    });

    client.set_allowlist_enabled(&admin, &true);

    assert!(client.is_allowlist_enabled());
}

#[test]
fn test_add_token_to_allowlist() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_address, _) = create_token_contract(&env, &admin);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Directly set admin role in storage for testing
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(admin.clone(), crate::types::Role::Admin),
            &true,
        );
    });

    client.add_allowed_token(&admin, &token_address);

    assert!(client.is_token_allowed(&token_address));
}

#[test]
fn test_remove_token_from_allowlist() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_address, _) = create_token_contract(&env, &admin);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Directly set admin role in storage for testing
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(admin.clone(), crate::types::Role::Admin),
            &true,
        );
    });

    client.add_allowed_token(&admin, &token_address);
    assert!(client.is_token_allowed(&token_address));

    client.remove_allowed_token(&admin, &token_address);
    client.set_allowlist_enabled(&admin, &true);
    assert!(!client.is_token_allowed(&token_address));
}

#[test]
fn test_create_stream_with_allowed_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Directly set admin role in storage for testing
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(admin.clone(), crate::types::Role::Admin),
            &true,
        );
    });

    // Setup allowlist
    client.set_allowlist_enabled(&admin, &true);
    client.add_allowed_token(&admin, &token_address);

    // Mint tokens
    token_admin_client.mint(&sender, &1000);

    // Create stream should succeed
    let result = client.try_create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    assert!(result.is_ok());
}

#[test]
fn test_create_stream_with_disallowed_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Directly set admin role in storage for testing
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(admin.clone(), crate::types::Role::Admin),
            &true,
        );
    });

    // Enable allowlist but don't add token
    client.set_allowlist_enabled(&admin, &true);

    // Mint tokens
    token_admin_client.mint(&sender, &1000);

    // Create stream should fail
    let result = client.try_create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    assert!(result.is_err());
    assert_eq!(
        result.err(),
        Some(Ok(crate::errors::Error::TokenNotAllowed))
    );
}

#[test]
fn test_create_stream_allowlist_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Allowlist disabled - any token should work
    token_admin_client.mint(&sender, &1000);

    let result = client.try_create_stream(
        &sender,
        &receiver,
        &token_address,
        &1000,
        &100, &100,
        &200,
        &crate::types::CurveType::Linear,
        &false,
    );

    assert!(result.is_ok());
}
