#![cfg(test)]
#![cfg(feature = "clawback_tests")] // Disabled - requires clawback implementation
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

fn set_compliance_officer_role(env: &Env, contract_id: &Address, officer: &Address) {
    env.as_contract(contract_id, || {
        env.storage().instance().set(
            &crate::types::DataKey::Role(officer.clone(), crate::types::Role::ComplianceOfficer),
            &true,
        );
    });
}

#[test]
fn test_governance_clawback() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let officer = Address::generate(&env);
    let issuer = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    // Set compliance officer role
    set_compliance_officer_role(&env, &contract_id, &officer);

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

    // Execute clawback
    client.governance_clawback(&stream_id, &officer, &issuer, &None);

    // Verify stream is cancelled
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed);

    // Verify issuer received the funds
    let token_client = TokenClient::new(&env, &token_address);
    let issuer_balance = token_client.balance(&issuer);
    assert_eq!(issuer_balance, 1000); // All funds clawed back
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_clawback_requires_compliance_officer_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let non_officer = Address::generate(&env);
    let issuer = Address::generate(&env);

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

    // Non-officer tries to clawback - should panic
    client.governance_clawback(&stream_id, &non_officer, &issuer, &None);
}

#[test]
fn test_clawback_after_partial_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let officer = Address::generate(&env);
    let issuer = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    set_compliance_officer_role(&env, &contract_id, &officer);

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

    // Receiver withdraws 500
    client.withdraw(&stream_id, &receiver);

    // Clawback remaining 500
    client.governance_clawback(&stream_id, &officer, &issuer, &None);

    // Issuer should receive remaining 500
    let token_client = TokenClient::new(&env, &token_address);
    let issuer_balance = token_client.balance(&issuer);
    assert_eq!(issuer_balance, 500);
}
