#![cfg(test)]
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::Address as _,
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
fn test_top_up_extends_duration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &2000);

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

    let stream_before = client.get_stream(&stream_id);
    assert_eq!(stream_before.total_amount, 1000);
    assert_eq!(stream_before.end_time, 200);

    client.top_up_stream(&stream_id, &sender, &1000);

    let stream_after = client.get_stream(&stream_id);
    assert_eq!(stream_after.total_amount, 2000);
    assert_eq!(stream_after.end_time, 300);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_only_sender_can_top_up() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let other = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &1000);
    token_admin_client.mint(&other, &500);

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

    client.top_up_stream(&stream_id, &other, &500);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn test_cannot_top_up_cancelled_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &2000);

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

    client.cancel(&stream_id, &sender);
    client.top_up_stream(&stream_id, &sender, &1000);
}

#[test]
fn test_top_up_multiple_times() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let (token_address, _token_client) = create_token_contract(&env, &admin);
    let token_admin_client = StellarAssetClient::new(&env, &token_address);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    token_admin_client.mint(&sender, &3000);

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

    client.top_up_stream(&stream_id, &sender, &1000);
    client.top_up_stream(&stream_id, &sender, &1000);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 3000);
    assert_eq!(stream.end_time, 400);
}
