#![cfg(test)]

use crate::{errors::Error, types::CurveType, StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

#[allow(dead_code)]
struct TestContext {
    env: Env,
    client: StellarStreamContractClient<'static>,
    token: StellarAssetClient<'static>,
    token_id: Address,
}

fn setup_test() -> TestContext {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = StellarAssetClient::new(&env, &token_id.address());

    TestContext {
        env,
        client,
        token,
        token_id: token_id.address(),
    }
}

#[test]
fn test_cliff_zero_duration() {
    // Cliff time matches start time (effectively no cliff)
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);

    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100, // start
        &100, // cliff (no cliff)
        &600, // end
        &CurveType::Linear,
        &false,
    );

    // After 250s elapsed (t=350)
    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 350,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500); // 50% vested
}

#[test]
fn test_cliff_blocks_withdrawal() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);

    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100, // start
        &350, // cliff
        &600, // end
        &CurveType::Linear,
        &false,
    );

    // Before cliff (t=300)
    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 300,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    // Attempt to withdraw should fail with InsufficientBalance (since unlocked is 0)
    let result = ctx.client.try_withdraw(&stream_id, &receiver);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_cliff_unlocks_at_cliff_time() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);

    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100, // start
        &350, // cliff
        &600, // end
        &CurveType::Linear,
        &false,
    );

    // Exactly at cliff (t=350)
    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 350,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500); // 50% vested all at once
}

#[test]
#[should_panic(expected = "Cliff time must be between start and end time")]
fn test_invalid_cliff_time_before_start() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);

    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100, // start
        &50,  // cliff (before start)
        &600, // end
        &CurveType::Linear,
        &false,
    );
}

#[test]
#[should_panic(expected = "Cliff time must be between start and end time")]
fn test_invalid_cliff_time_after_end() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);

    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100, // start
        &650, // cliff (after end)
        &600, // end
        &CurveType::Linear,
        &false,
    );
}
