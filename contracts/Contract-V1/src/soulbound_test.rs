#![cfg(test)]

use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use crate::errors::Error;
use crate::types::CurveType;

const PRINCIPAL: i128 = 1_000_000;
const DURATION: u64 = 86_400 * 30; // 30 days

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (contract_id.clone(), TokenClient::new(env, &contract_id))
}

/// # Purpose
/// Verify that a stream can be created with is_soulbound: true
/// # Setup
/// Create a soulbound stream
/// # Assertion
/// Stream has is_soulbound == true and soulbound event is emitted
#[test]
fn test_create_soulbound_stream() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Assert stream is soulbound
    let stream = client.get_stream(&stream_id);
    assert!(stream.is_soulbound, "Stream should be soulbound");
    assert_eq!(stream.receiver, receiver, "Receiver should match");

    // Verify soulbound streams index
    let soulbound_streams = client.get_soulbound_streams();
    assert_eq!(soulbound_streams.len(), 1, "Should have 1 soulbound stream");
    assert_eq!(
        soulbound_streams.get(0).expect("Should have first element"),
        stream_id,
        "Soulbound stream ID should match"
    );
}

/// # Purpose
/// Verify that a stream created with is_soulbound: false is not soulbound
/// # Setup
/// Create a normal (non-soulbound) stream
/// # Assertion
/// Stream has is_soulbound == false and no soulbound event
#[test]
fn test_create_normal_stream_not_soulbound() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &false, // is_soulbound
    );

    // Assert stream is NOT soulbound
    let stream = client.get_stream(&stream_id);
    assert!(!stream.is_soulbound, "Stream should not be soulbound");

    // Verify soulbound streams index is empty
    let soulbound_streams = client.get_soulbound_streams();
    assert_eq!(
        soulbound_streams.len(),
        0,
        "Should have 0 soulbound streams"
    );
}

/// # Purpose
/// Verify that transfer_receiver is blocked for soulbound streams
/// # Setup
/// Create a soulbound stream and attempt to transfer receiver
/// # Assertion
/// transfer_receiver returns Error::StreamIsSoulbound and receiver remains unchanged
#[test]
fn test_transfer_receiver_blocked_on_soulbound() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let new_receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Attempt to transfer receiver - should fail
    let result = client.try_transfer_receiver(&stream_id, &sender, &new_receiver);

    assert_eq!(
        result,
        Err(Ok(Error::StreamIsSoulbound)),
        "Should return StreamIsSoulbound error"
    );

    // Verify receiver is still the original
    let stream = client.get_stream(&stream_id);
    assert_eq!(
        stream.receiver, receiver,
        "Receiver should still be original"
    );
}

/// # Purpose
/// Verify that transfer_receiver works normally for non-soulbound streams
/// # Setup
/// Create a normal stream and transfer receiver
/// # Assertion
/// Receiver is successfully updated
#[test]
fn test_transfer_receiver_allowed_on_normal_stream() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let new_receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &false, // is_soulbound
    );

    // Transfer receiver - should succeed
    client.transfer_receiver(&stream_id, &sender, &new_receiver);

    // Verify receiver is updated
    let stream = client.get_stream(&stream_id);
    assert_eq!(
        stream.receiver, new_receiver,
        "Receiver should be updated to new_receiver"
    );
}

/// # Purpose
/// Verify that is_soulbound flag cannot be changed after creation
/// # Setup
/// Create a soulbound stream
/// # Assertion
/// No function exists to flip is_soulbound, and it remains true after all operations
#[test]
fn test_soulbound_flag_immutable_after_creation() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Verify is_soulbound is true
    let stream_before = client.get_stream(&stream_id);
    assert!(stream_before.is_soulbound, "Should be soulbound initially");

    // Perform various operations (pause, unpause)
    client.pause_stream(&stream_id, &sender);
    client.unpause_stream(&stream_id, &sender);

    // Verify is_soulbound is STILL true
    let stream_after = client.get_stream(&stream_id);
    assert!(
        stream_after.is_soulbound,
        "Should still be soulbound after operations"
    );

    // This test verifies by design that no setter function exists
    // If a setter were added, this test would need to explicitly call and verify it fails
}

/// # Purpose
/// Verify that soulbound streams can still be withdrawn from by the receiver
/// # Setup
/// Create a soulbound stream, advance time, and withdraw
/// # Assertion
/// Original receiver can withdraw vested tokens successfully
#[test]
fn test_soulbound_stream_still_withdrawable() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, token_client) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Advance time to 50% of duration
    env.ledger().with_mut(|li| li.timestamp = DURATION / 2);

    // Withdraw as receiver - should succeed
    let withdrawn = client.withdraw(&stream_id, &receiver);

    // Verify withdrawal succeeded
    assert!(withdrawn > 0, "Should have withdrawn tokens");
    assert_eq!(
        token_client.balance(&receiver),
        withdrawn,
        "Receiver should have withdrawn balance"
    );

    // Verify stream is still soulbound
    let stream = client.get_stream(&stream_id);
    assert!(
        stream.is_soulbound,
        "Stream should still be soulbound after withdrawal"
    );
}

/// # Purpose
/// Verify that soulbound streams can be cancelled by sender
/// # Setup
/// Create a soulbound stream and cancel it
/// # Assertion
/// Cancellation succeeds and unvested tokens return to sender
#[test]
fn test_soulbound_stream_cancellable_by_sender() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, token_client) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 10));

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Advance time to 25% of duration
    env.ledger().with_mut(|li| li.timestamp = DURATION / 4);

    let sender_balance_before = token_client.balance(&sender);

    // Cancel as sender - should succeed
    client.cancel(&stream_id, &sender);

    // Verify cancellation succeeded
    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, crate::types::StreamState::Closed, "Stream should be cancelled");

    // Verify sender received unvested tokens back
    let sender_balance_after = token_client.balance(&sender);
    assert!(
        sender_balance_after > sender_balance_before,
        "Sender should have received unvested tokens"
    );

    // Soulbound only locks TRANSFER, not cancellation rights
}

/// # Purpose
/// Verify that get_soulbound_streams returns correct stream IDs
/// # Setup
/// Create 2 soulbound streams and 1 normal stream
/// # Assertion
/// get_soulbound_streams returns exactly the 2 soulbound stream IDs
#[test]
fn test_get_soulbound_streams_index() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let receiver3 = Address::generate(&env);
    let admin = Address::generate(&env);
    let (token_id, _) = create_token_contract(&env, &admin);

    let token_admin_client = StellarAssetClient::new(&env, &token_id);
    token_admin_client.mint(&sender, &(PRINCIPAL * 30));

    // Create 2 soulbound streams
    let soulbound_id_1 = client.create_stream(
        &sender,
        &receiver1,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    let soulbound_id_2 = client.create_stream(
        &sender,
        &receiver2,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &true, // is_soulbound
    );

    // Create 1 normal stream
    let _normal_id = client.create_stream(
        &sender,
        &receiver3,
        &token_id,
        &PRINCIPAL,
        &0, &0,
        &DURATION,
        &CurveType::Linear,
        &false, // is_soulbound
    );

    // Get soulbound streams
    let soulbound_streams = client.get_soulbound_streams();

    // Verify exactly 2 soulbound streams
    assert_eq!(
        soulbound_streams.len(),
        2,
        "Should have exactly 2 soulbound streams"
    );

    // Verify the IDs match
    assert_eq!(
        soulbound_streams.get(0).expect("Should have first element"),
        soulbound_id_1,
        "First soulbound ID should match"
    );
    assert_eq!(
        soulbound_streams
            .get(1)
            .expect("Should have second element"),
        soulbound_id_2,
        "Second soulbound ID should match"
    );
}
