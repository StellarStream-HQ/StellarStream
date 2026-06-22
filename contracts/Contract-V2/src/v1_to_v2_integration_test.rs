#![cfg(test)]

//! V1-to-V2 Integration Test Suite
//!
//! This module provides comprehensive integration tests for the V1 to V2 migration flow.
//! It verifies that:
//! 1. Streams can be created in V1
//! 2. Migration from V1 to V2 works correctly
//! 3. V1 streams are properly closed after migration
//! 4. V2 streams have correct balances and state
//! 5. Edge cases are handled properly

use super::*;
use crate::types::{PermitArgs, StreamArgs, StreamSplitUpdatedEvent};
use soroban_sdk::{
    contracttype,
    testutils::{Address as _, Ledger},
    token::TokenClient,
    vec, Address, Env, String,
};

// ── Mock V1 Contract ─────────────────────────────────────────────────────────

/// Mock V1 contract that simulates the real V1 contract behavior
/// for integration testing purposes.
mod mock_v1_contract {
    use crate::contracterror::Error;
    use soroban_sdk::{
        contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec,
    };

    #[contracttype]
    #[derive(Clone)]
    pub enum CurveTypeV1 {
        Linear = 0,
        Exponential = 1,
    }

    #[contracttype]
    #[derive(Clone)]
    pub struct MilestoneV1 {
        pub timestamp: u64,
        pub percentage: u32,
    }

    #[contracttype]
    #[derive(Clone)]
    pub struct V1Stream {
        pub sender: Address,
        pub receiver: Address,
        pub token: Address,
        pub total_amount: i128,
        pub start_time: u64,
        pub end_time: u64,
        pub withdrawn: i128,
        pub withdrawn_amount: i128,
        pub cancelled: bool,
        pub receipt_owner: Address,
        pub is_paused: bool,
        pub paused_time: u64,
        pub total_paused_duration: u64,
        pub milestones: Vec<MilestoneV1>,
        pub curve_type: CurveTypeV1,
        pub interest_strategy: u32,
        pub vault_address: Option<Address>,
        pub deposited_principal: i128,
        pub metadata: Option<BytesN<32>>,
        pub is_usd_pegged: bool,
        pub usd_amount: i128,
        pub oracle_address: Address,
        pub oracle_max_staleness: u64,
        pub price_min: i128,
        pub price_max: i128,
        pub is_soulbound: bool,
        pub clawback_enabled: bool,
        pub arbiter: Option<Address>,
        pub is_frozen: bool,
    }

    const STREAM_KEY: soroban_sdk::Symbol = symbol_short!("STREAM");
    const CANCELLED_KEY: soroban_sdk::Symbol = symbol_short!("CANCEL");
    const STREAM_ID_KEY: soroban_sdk::Symbol = symbol_short!("S_ID");

    #[contract]
    pub struct MockV1Contract;

    #[contractimpl]
    impl MockV1Contract {
        /// Initialize the mock V1 contract
        pub fn initialize(env: Env) {
            env.storage().instance().set(&STREAM_ID_KEY, &0u64);
        }

        /// Create a new stream in the mock V1 contract
        pub fn create_stream(
            env: Env,
            sender: Address,
            receiver: Address,
            token: Address,
            total_amount: i128,
            start_time: u64,
            end_time: u64,
        ) -> u64 {
            sender.require_auth();

            let stream_id: u64 = env.storage().instance().get(&STREAM_ID_KEY).unwrap_or(0);
            let next_id = stream_id + 1;

            let stream = V1Stream {
                sender: sender.clone(),
                receiver: receiver.clone(),
                token: token.clone(),
                total_amount,
                start_time,
                end_time,
                withdrawn: 0,
                withdrawn_amount: 0,
                cancelled: false,
                receipt_owner: receiver.clone(),
                is_paused: false,
                paused_time: 0,
                total_paused_duration: 0,
                milestones: Vec::new(&env),
                curve_type: CurveTypeV1::Linear,
                interest_strategy: 0,
                vault_address: None,
                deposited_principal: total_amount,
                metadata: None,
                is_usd_pegged: false,
                usd_amount: 0,
                oracle_address: sender.clone(),
                oracle_max_staleness: 0,
                price_min: 0,
                price_max: 0,
                is_soulbound: false,
                clawback_enabled: false,
                arbiter: None,
                is_frozen: false,
            };

            let key = (STREAM_KEY, next_id);
            env.storage().instance().set(&key, &stream);
            env.storage().instance().set(&STREAM_ID_KEY, &next_id);

            next_id
        }

        /// Get stream details from V1
        pub fn get_stream(env: Env, stream_id: u64) -> V1Stream {
            let key = (STREAM_KEY, stream_id);
            env.storage()
                .instance()
                .get(&key)
                .expect("stream not found")
        }

        /// Cancel a stream in V1 (simulates real V1 cancel behavior)
        pub fn cancel(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
            caller.require_auth();

            let key = (STREAM_KEY, stream_id);
            let mut stream: V1Stream = env
                .storage()
                .instance()
                .get(&key)
                .ok_or(Error::StreamNotFound)?;

            if stream.sender != caller && stream.receiver != caller {
                return Err(Error::UnauthorizedSender);
            }
            if stream.cancelled {
                return Err(Error::AlreadyCancelled);
            }

            let current_time = env.ledger().timestamp();
            let elapsed = if current_time <= stream.start_time {
                0i128
            } else {
                (current_time - stream.start_time) as i128
            };
            let duration = (stream.end_time - stream.start_time) as i128;
            let unlocked = (stream.total_amount * elapsed) / duration;
            let to_receiver = unlocked - stream.withdrawn_amount;
            let to_sender = stream.total_amount - unlocked;

            stream.cancelled = true;
            stream.withdrawn_amount = unlocked;
            env.storage().instance().set(&key, &stream);

            // In a real contract, tokens would be transferred here
            // For testing, we just track the state change

            Ok(())
        }

        /// Cancel stream for migration (returns remaining balance)
        pub fn cancel_stream(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
            caller.require_auth();

            let key = (STREAM_KEY, stream_id);
            let mut stream: V1Stream = env
                .storage()
                .instance()
                .get(&key)
                .ok_or(Error::StreamNotFound)?;

            if stream.receiver != caller {
                return Err(Error::UnauthorizedSender);
            }
            if stream.cancelled {
                return Err(Error::AlreadyCancelled);
            }

            let remaining = stream.total_amount - stream.withdrawn_amount;

            stream.cancelled = true;
            stream.withdrawn_amount = stream.total_amount;
            env.storage().instance().set(&key, &stream);

            Ok(remaining)
        }

        /// Test helper: persist a modified stream record.
        pub fn set_stream(env: Env, stream_id: u64, stream: V1Stream) {
            let key = (STREAM_KEY, stream_id);
            env.storage().instance().set(&key, &stream);
        }

        /// Check if a stream was cancelled
        pub fn was_cancelled(env: Env, stream_id: u64) -> bool {
            let key = (STREAM_KEY, stream_id);
            let stream: V1Stream = env
                .storage()
                .instance()
                .get(&key)
                .expect("stream not found");
            stream.cancelled
        }

        /// Get the remaining balance of a stream
        pub fn get_remaining_balance(env: Env, stream_id: u64) -> i128 {
            let key = (STREAM_KEY, stream_id);
            let stream: V1Stream = env
                .storage()
                .instance()
                .get(&key)
                .expect("stream not found");
            stream.total_amount - stream.withdrawn_amount
        }
    }
}

use mock_v1_contract::{MockV1Contract, MockV1ContractClient, V1Stream};

// ── Helper Functions ──────────────────────────────────────────────────────────

fn create_token<'a>(
    env: &Env,
    admin: &Address,
) -> (
    Address,
    TokenClient<'a>,
    soroban_sdk::token::StellarAssetClient<'a>,
) {
    let addr = env.register_stellar_asset_contract(admin.clone());
    (
        addr.clone(),
        TokenClient::new(env, &addr),
        soroban_sdk::token::StellarAssetClient::new(env, &addr),
    )
}

/// Register the V2 contract, call init(), and return its address + client.
fn setup_v2<'a>(env: &'a Env, admin: &'a Address) -> (Address, ContractClient<'a>) {
    let id = env.register(Contract, ());
    let client = ContractClient::new(env, &id);
    client.init(admin);
    (id, client)
}

/// Register the mock V1 contract and initialize it.
fn setup_v1<'a>(env: &'a Env) -> (Address, MockV1ContractClient<'a>) {
    let id = env.register(MockV1Contract, ());
    let client = MockV1ContractClient::new(env, &id);
    client.initialize();
    (id, client)
}

fn stream_args(
    sender: &Address,
    receiver: &Address,
    token: &Address,
    total_amount: i128,
) -> StreamArgs {
    StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        penalty_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        memo: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        curve_type: 0,
    }
}

// ── Integration Tests ─────────────────────────────────────────────────────────

#[test]
fn test_v1_to_v2_migration_full_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // Set initial time
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, _) = create_token(&env, &token_admin);

    // Setup V1 contract
    let (v1_id, v1_client) = setup_v1(&env);

    // Setup V2 contract
    let (_, v2_client) = setup_v2(&env, &admin);

    // Step 1: Create a stream in V1
    let v1_stream_id = v1_client.create_stream(
        &sender, &receiver, &token_id, &1000i128, // total_amount
        &0u64,     // start_time
        &200u64,   // end_time
    );

    // Verify V1 stream was created
    let v1_stream = v1_client.get_stream(&v1_stream_id);
    assert_eq!(v1_stream.sender, sender);
    assert_eq!(v1_stream.receiver, receiver);
    assert_eq!(v1_stream.token, token_id);
    assert_eq!(v1_stream.total_amount, 1000);
    assert!(!v1_stream.cancelled);

    // Step 2: Migrate the stream from V1 to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);

    // Step 3: Verify V1 stream is closed (cancelled)
    assert!(v1_client.was_cancelled(&v1_stream_id));
    let v1_stream_after = v1_client.get_stream(&v1_stream_id);
    assert!(v1_stream_after.cancelled);

    // Step 4: Verify V2 stream has correct balances
    let v2_stream = v2_client
        .get_stream(&v2_stream_id)
        .expect("V2 stream missing");

    // At t=50 out of 200: elapsed = 50, duration = 200
    // unlocked = 1000 * 50 / 200 = 250
    // remaining = 1000 - 250 = 750
    assert_eq!(v2_stream.total_amount, 750);
    assert_eq!(v2_stream.sender, sender);
    assert_eq!(v2_stream.receiver, receiver);
    assert_eq!(v2_stream.token, token_id);
    assert_eq!(v2_stream.start_time, 50); // migration point = now
    assert_eq!(v2_stream.end_time, 200); // preserved from V1
    assert!(v2_stream.migrated_from_v1);
    assert_eq!(v2_stream.v1_stream_id, v1_stream_id);
    assert!(!v2_stream.cancelled);
}

#[test]
fn test_v1_to_v2_migration_at_different_time_points() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Test migration at 25% elapsed (t=50)
    env.ledger().with_mut(|li| li.timestamp = 50);
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();
    assert_eq!(v2_stream.total_amount, 750); // 1000 - 250

    // Test migration at 50% elapsed (t=100)
    env.ledger().with_mut(|li| li.timestamp = 100);
    let v1_stream_id_2 =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);
    let v2_stream_id_2 = v2_client.migrate_stream(&v1_id, &v1_stream_id_2, &receiver);
    let v2_stream_2 = v2_client.get_stream(&v2_stream_id_2).unwrap();
    assert_eq!(v2_stream_2.total_amount, 500); // 1000 - 500

    // Test migration at 75% elapsed (t=150)
    env.ledger().with_mut(|li| li.timestamp = 150);
    let v1_stream_id_3 =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);
    let v2_stream_id_3 = v2_client.migrate_stream(&v1_id, &v1_stream_id_3, &receiver);
    let v2_stream_3 = v2_client.get_stream(&v2_stream_id_3).unwrap();
    assert_eq!(v2_stream_3.total_amount, 250); // 1000 - 750
}

#[test]
fn test_v1_to_v2_migration_with_partial_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Simulate partial withdrawal in V1 (200 tokens withdrawn)
    let mut v1_stream = v1_client.get_stream(&v1_stream_id);
    v1_stream.withdrawn_amount = 200;
    v1_client.set_stream(&v1_stream_id, &v1_stream);

    // Migrate to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();

    // Current V2 migration logic carries only the remaining unvested portion.
    // At t=100: unlocked = 500, remaining = 1000 - 500 = 500.
    // Previously withdrawn vested funds in V1 do not change the unvested carryover.
    assert_eq!(v2_stream.total_amount, 500);
    let v1_stream_after = v1_client.get_stream(&v1_stream_id);
    assert!(v1_stream_after.cancelled);
}

#[test]
fn test_v1_to_v2_migration_preserves_stream_parameters() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1 with specific parameters
    let v1_stream_id = v1_client.create_stream(
        &sender, &receiver, &token_id, &2000i128, &10u64,  // start_time
        &210u64, // end_time
    );

    // Migrate to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();

    // Verify parameters are preserved correctly
    assert_eq!(v2_stream.sender, sender);
    assert_eq!(v2_stream.receiver, receiver);
    assert_eq!(v2_stream.token, token_id);
    assert_eq!(v2_stream.end_time, 210); // preserved from V1
    assert_eq!(v2_stream.start_time, 50); // migration time
    assert!(v2_stream.migrated_from_v1);
    assert_eq!(v2_stream.v1_stream_id, v1_stream_id);
}

#[test]
fn test_v1_to_v2_migration_fails_for_non_receiver() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Try to migrate with non-receiver (should fail)
    let result = v2_client.try_migrate_stream(&v1_id, &v1_stream_id, &stranger);
    assert!(result.is_err());
}

#[test]
fn test_v1_to_v2_migration_fails_for_cancelled_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1 and cancel it
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);
    v1_client.cancel(&v1_stream_id, &sender);

    // Try to migrate cancelled stream (should fail)
    let result = v2_client.try_migrate_stream(&v1_id, &v1_stream_id, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_v1_to_v2_migration_fails_for_ended_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 250); // past end_time

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1 that has already ended
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Try to migrate ended stream (should fail)
    let result = v2_client.try_migrate_stream(&v1_id, &v1_stream_id, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_v1_to_v2_migration_multiple_streams() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create multiple streams in V1
    let v1_stream_id_1 =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);
    let v1_stream_id_2 =
        v1_client.create_stream(&sender, &receiver, &token_id, &2000i128, &0u64, &200u64);
    let v1_stream_id_3 =
        v1_client.create_stream(&sender, &receiver, &token_id, &500i128, &0u64, &200u64);

    // Migrate all streams
    let v2_stream_id_1 = v2_client.migrate_stream(&v1_id, &v1_stream_id_1, &receiver);
    let v2_stream_id_2 = v2_client.migrate_stream(&v1_id, &v1_stream_id_2, &receiver);
    let v2_stream_id_3 = v2_client.migrate_stream(&v1_id, &v1_stream_id_3, &receiver);

    // Verify all V1 streams are cancelled
    assert!(v1_client.was_cancelled(&v1_stream_id_1));
    assert!(v1_client.was_cancelled(&v1_stream_id_2));
    assert!(v1_client.was_cancelled(&v1_stream_id_3));

    // Verify all V2 streams have correct balances
    let v2_stream_1 = v2_client.get_stream(&v2_stream_id_1).unwrap();
    let v2_stream_2 = v2_client.get_stream(&v2_stream_id_2).unwrap();
    let v2_stream_3 = v2_client.get_stream(&v2_stream_id_3).unwrap();

    // At t=50: 25% elapsed, 75% remaining
    assert_eq!(v2_stream_1.total_amount, 750); // 1000 * 0.75
    assert_eq!(v2_stream_2.total_amount, 1500); // 2000 * 0.75
    assert_eq!(v2_stream_3.total_amount, 375); // 500 * 0.75
}

#[test]
fn test_v1_to_v2_migration_with_different_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Test with small amount
    let v1_stream_id_small =
        v1_client.create_stream(&sender, &receiver, &token_id, &10i128, &0u64, &200u64);
    let v2_stream_id_small = v2_client.migrate_stream(&v1_id, &v1_stream_id_small, &receiver);
    let v2_stream_small = v2_client.get_stream(&v2_stream_id_small).unwrap();
    assert_eq!(v2_stream_small.total_amount, 5); // 10 * 0.5

    // Test with large amount
    let v1_stream_id_large = v1_client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1_000_000i128,
        &0u64,
        &200u64,
    );
    let v2_stream_id_large = v2_client.migrate_stream(&v1_id, &v1_stream_id_large, &receiver);
    let v2_stream_large = v2_client.get_stream(&v2_stream_id_large).unwrap();
    assert_eq!(v2_stream_large.total_amount, 500_000); // 1_000_000 * 0.5
}

#[test]
fn test_v1_to_v2_migration_state_consistency() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 75);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Get V1 stream state before migration
    let v1_stream_before = v1_client.get_stream(&v1_stream_id);
    assert!(!v1_stream_before.cancelled);
    assert_eq!(v1_stream_before.withdrawn_amount, 0);

    // Migrate to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);

    // Verify V1 state after migration
    let v1_stream_after = v1_client.get_stream(&v1_stream_id);
    assert!(v1_stream_after.cancelled);
    // V1's withdrawn_amount should be updated to unlocked amount
    let expected_unlocked = (1000 * 75) / 200; // 375
    assert_eq!(v1_stream_after.withdrawn_amount, expected_unlocked);

    // Verify V2 state
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();
    assert_eq!(v2_stream.total_amount, 1000 - expected_unlocked); // 625
    assert!(!v2_stream.cancelled);
    assert_eq!(v2_stream.withdrawn_amount, 0);
}

#[test]
fn test_v1_to_v2_migration_edge_case_zero_elapsed() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0); // at start time

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Migrate at start time (0% elapsed)
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();

    // At t=0: 0% elapsed, 100% remaining
    assert_eq!(v2_stream.total_amount, 1000);
}

#[test]
fn test_v1_to_v2_migration_edge_case_near_end() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 199); // 1 second before end

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Migrate near end time (99.5% elapsed)
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();

    // At t=199: elapsed = 199, duration = 200
    // unlocked = 1000 * 199 / 200 = 995
    // remaining = 1000 - 995 = 5
    assert_eq!(v2_stream.total_amount, 5);
}

#[test]
fn test_v1_to_v2_migration_withdraw_from_migrated_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Migrate to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);

    // Mint tokens to V2 contract to cover the migrated stream
    asset_client.mint(&v2_client.address, &1000);

    // Advance time to allow more tokens to vest
    env.ledger().with_mut(|li| li.timestamp = 150);

    // Withdraw from V2 stream
    let withdrawn = v2_client.withdraw(&v2_stream_id, &receiver);

    // At t=150: elapsed = 150, duration = 200
    // unlocked = 500 * 150 / 200 = 375 (V2 stream has 500 total)
    // But we started at t=100, so elapsed in V2 = 50
    // unlocked in V2 = 500 * 50 / 100 = 250
    assert_eq!(withdrawn, 250);

    // Verify V2 stream state
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();
    assert_eq!(v2_stream.withdrawn_amount, 250);
}

#[test]
fn test_v1_to_v2_migration_cancel_migrated_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    let (v1_id, v1_client) = setup_v1(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Create stream in V1
    let v1_stream_id =
        v1_client.create_stream(&sender, &receiver, &token_id, &1000i128, &0u64, &200u64);

    // Migrate to V2
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &v1_stream_id, &receiver);

    // Mint tokens to V2 contract to cover the migrated stream
    asset_client.mint(&v2_client.address, &1000);

    let balance_receiver_before = token_client.balance(&receiver);
    let balance_sender_before = token_client.balance(&sender);

    // Cancel V2 stream
    v2_client.cancel(&v2_stream_id, &receiver);

    let balance_receiver_after = token_client.balance(&receiver);
    let balance_sender_after = token_client.balance(&sender);

    assert_eq!(balance_receiver_after - balance_receiver_before, 0);
    assert_eq!(balance_sender_after - balance_sender_before, 500);

    // Verify V2 stream is cancelled
    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();
    assert!(v2_stream.cancelled);
}
