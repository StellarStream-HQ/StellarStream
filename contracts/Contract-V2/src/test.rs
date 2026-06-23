#![cfg(test)]

use super::*;
use crate::types::{PendingRateUpdate, PermitArgs, SimulationReport, StreamArgs, SwapStreamArgs};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::TokenClient,
    vec, Address, Env, String,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        penalty_bps: 0,
        memo: None,
        curve_type: 0,
    }
}

#[test]
fn test_packed_stream_metadata_round_trip() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = Address::generate(&env);

    let stream = StreamV2 {
        sender,
        receiver: receiver.clone(),
        beneficiary: receiver,
        token,
        total_amount: 123,
        start_time: 1,
        end_time: 2,
        cliff_time: 1,
        withdrawn_amount: 3,
        cancelled: false,
        migrated_from_v1: true,
        v1_stream_id: 9,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: true,
        is_pending: true,
        is_recurrent: true,
        cycle_duration: 10,
        cancellation_type: 7,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        penalty_bps: 0,
        curve_type: 0,
    };
    let packed = crate::storage::pack_stream_metadata(&stream);
    let (
        status,
        penalty_bps,
        curve_type,
        migrated_from_v1,
        yield_enabled,
        is_recurrent,
        cancellation_type,
    ) = crate::storage::unpack_stream_metadata(packed);

    assert_eq!(status, 2);
    assert_eq!(penalty_bps, 0);
    assert_eq!(curve_type, 0);
    assert!(migrated_from_v1);
    assert!(yield_enabled);
    assert!(is_recurrent);
    assert_eq!(cancellation_type, 7);
}

// ── Init tests ───────────────────────────────────────────────────────────────

#[test]
fn test_init_sets_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    assert_eq!(client.admin(), admin);
}

#[test]
fn test_init_cannot_be_called_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let result = client.try_init(&admin);
    assert!(result.is_err());
}

#[test]
fn test_version_returns_v2() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    assert_eq!(client.version(), 2);
}

#[test]
fn test_metadata_returns_official_spec_uri() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    assert_eq!(
        client.metadata(),
        soroban_sdk::Bytes::from_slice(&env, &crate::CONTRACT_METADATA_HASH)
    );
}

// ── Migration bridge tests ────────────────────────────────────────────────────
//
// These tests use a *mock* V1 contract registered in the same test environment
// so we can control its state without a real V1 WASM.  The mock implements
// only get_stream() and cancel() — the two functions migrate_stream() calls.

/// Registers a minimal mock of the V1 contract that returns a controllable
/// stream and records whether cancel() was called.
mod mock_v1 {
    use soroban_sdk::{
        contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec,
    };

    // Re-declare just enough of V1's types for the mock.
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

    const STREAM_KEY: soroban_sdk::Symbol = symbol_short!("MOCK_S");
    const CANCELLED_KEY: soroban_sdk::Symbol = symbol_short!("MOCK_C");

    #[contract]
    pub struct MockV1;

    #[contractimpl]
    impl MockV1 {
        /// Seed the mock with a stream.
        pub fn seed_stream(env: Env, stream: V1Stream) {
            env.storage().instance().set(&STREAM_KEY, &stream);
        }

        /// V1's public get_stream interface.
        pub fn get_stream(env: Env, _stream_id: u64) -> V1Stream {
            env.storage()
                .instance()
                .get(&STREAM_KEY)
                .expect("mock: stream not seeded")
        }

        /// V1's public cancel interface.
        /// In the real V1 this transfers tokens; in the mock we just record
        /// that it was called so the test can assert on it.
        pub fn cancel(env: Env, _stream_id: u64, _caller: Address) {
            env.storage().instance().set(&CANCELLED_KEY, &true);
        }

        /// Helper so tests can assert cancel() was called.
        pub fn was_cancelled(env: Env) -> bool {
            env.storage()
                .instance()
                .get(&CANCELLED_KEY)
                .unwrap_or(false)
        }
    }
}

use mock_v1::{CurveTypeV1, MockV1, MockV1Client, V1Stream};

/// Build a basic V1Stream value for use in tests.
fn make_v1_stream(env: &Env, sender: &Address, receiver: &Address, token: &Address) -> V1Stream {
    V1Stream {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount: 1000,
        start_time: 0,
        end_time: 200,
        withdrawn: 0,
        withdrawn_amount: 0,
        cancelled: false,
        receipt_owner: receiver.clone(),
        is_paused: false,
        paused_time: 0,
        total_paused_duration: 0,
        milestones: soroban_sdk::vec![env],
        curve_type: CurveTypeV1::Linear,
        interest_strategy: 0,
        vault_address: None,
        deposited_principal: 1000,
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
    }
}

#[test]
fn test_migrate_stream_creates_v2_stream() {
    let env = Env::default();
    env.mock_all_auths();
    // Stream runs from t=0 to t=200; migrate at t=100 (halfway)
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    // Register mock V1 and seed it with a stream.
    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    // Set up V2.
    let (_, v2_client) = setup_v2(&env, &admin);

    let v2_stream_id = v2_client.migrate_stream(&v1_id, &0u64, &receiver);

    // V2 stream should have been created with ID 0.
    assert_eq!(v2_stream_id, 0);

    let v2_stream = v2_client.get_stream(&v2_stream_id).expect("stream missing");

    // At t=100 out of 200: unlocked = 1000 * 100/200 = 500, remaining = 500
    assert_eq!(v2_stream.total_amount, 500);
    assert_eq!(v2_stream.sender, sender);
    assert_eq!(v2_stream.receiver, receiver);
    assert_eq!(v2_stream.token, token_id);
    assert_eq!(v2_stream.start_time, 100); // migration point = now
    assert_eq!(v2_stream.end_time, 200); // preserved from V1
    assert!(v2_stream.migrated_from_v1);
    assert_eq!(v2_stream.v1_stream_id, 0);
}

#[test]
fn test_migrate_stream_calls_v1_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.migrate_stream(&v1_id, &0u64, &receiver);

    // V1::cancel() must have been called.
    assert!(v1_client.was_cancelled());
}

#[test]
fn test_migrate_stream_fails_if_not_receiver() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let stranger = Address::generate(&env); // not the receiver
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, v2_client) = setup_v2(&env, &admin);

    let result = v2_client.try_migrate_stream(&v1_id, &0u64, &stranger);
    assert!(result.is_err());
}

#[test]
fn test_migrate_stream_fails_if_already_cancelled() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let mut stream = make_v1_stream(&env, &sender, &receiver, &token_id);
    stream.cancelled = true; // already cancelled

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&stream);

    let (_, v2_client) = setup_v2(&env, &admin);

    let result = v2_client.try_migrate_stream(&v1_id, &0u64, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_migrate_stream_fails_if_stream_ended() {
    let env = Env::default();
    env.mock_all_auths();
    // Set time past the stream end_time (200)
    env.ledger().with_mut(|li| li.timestamp = 250);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, v2_client) = setup_v2(&env, &admin);

    let result = v2_client.try_migrate_stream(&v1_id, &0u64, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_migrate_stream_remaining_balance_correct_at_25_percent() {
    let env = Env::default();
    env.mock_all_auths();
    // Migrate at t=50: 50/200 = 25% elapsed → unlocked=250, remaining=750
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, v2_client) = setup_v2(&env, &admin);
    let v2_stream_id = v2_client.migrate_stream(&v1_id, &0u64, &receiver);

    let v2_stream = v2_client.get_stream(&v2_stream_id).unwrap();
    assert_eq!(v2_stream.total_amount, 750); // 1000 - 250
}

#[test]
fn test_permit_stream_fails_with_wrong_nonce() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Generate a dummy keypair (32-byte pubkey, 64-byte sig)
    let pubkey = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let bad_sig = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);

    // Nonce 99 != stored nonce 0 — should fail with InvalidNonce
    let result = v2_client.try_create_stream_with_signature(
        &PermitArgs {
            sender_pubkey: pubkey.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 1000i128,
            start_time: 0u64,
            cliff_time: 0u64,
            end_time: 200u64,
            nonce: 99u64, // wrong
            deadline: 9999u64,
            step_duration: 0,
            multiplier_bps: 0,
            vault_address: None,
            yield_enabled: false,
        },
        &bad_sig,
    );
    assert!(result.is_err());
}

#[test]
fn test_permit_stream_fails_if_deadline_passed() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 500); // now = 500

    let admin = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    let pubkey = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let bad_sig = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);

    // deadline = 100, now = 500 — expired
    let result = v2_client.try_create_stream_with_signature(
        &PermitArgs {
            sender_pubkey: pubkey.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 1000i128,
            start_time: 0u64,
            cliff_time: 0u64,
            end_time: 200u64,
            nonce: 0u64,
            deadline: 100u64, // expired
            step_duration: 0,
            multiplier_bps: 0,
            vault_address: None,
            yield_enabled: false,
        },
        &bad_sig,
    );
    assert!(result.is_err());
}

// ── Emergency Pause tests ───────────────────────────────────────────────────

#[test]
fn test_pause_unpause_admin_only() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    // Initial state: not paused
    assert!(!client.is_paused());

    // 1. Fails without auth mocking (auth failure)
    let result = client.try_pause();
    assert!(result.is_err());

    // 2. Succeeds with mock_all_auths
    env.mock_all_auths();
    client.pause();
    assert!(client.is_paused());

    // 3. Unpause works
    client.unpause();
    assert!(!client.is_paused());
}

#[test]
fn test_migrate_stream_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 50);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, client) = setup_v2(&env, &admin);

    // Pause the contract
    client.pause();

    // Migration should fail
    let result = client.try_migrate_stream(&v1_id, &0u64, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_permit_stream_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);
    let (_, client) = setup_v2(&env, &admin);

    client.pause();

    let pubkey = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    let bad_sig = soroban_sdk::BytesN::from_array(&env, &[0u8; 64]);

    let result = client.try_create_stream_with_signature(
        &PermitArgs {
            sender_pubkey: pubkey.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 1000i128,
            start_time: 0u64,
            cliff_time: 0u64,
            end_time: 200u64,
            nonce: 0u64,
            deadline: 9999u64,
            step_duration: 0,
            multiplier_bps: 0,
            vault_address: None,
            yield_enabled: false,
        },
        &bad_sig,
    );
    assert!(result.is_err());
}

// ── Issue #404 — Bulk TTL tests ───────────────────────────────────────────────

#[test]
fn test_bump_active_streams_ttl_returns_count_of_existing() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Mint and approve tokens so migrate_stream can pull them
    let v1_id = {
        let id = env.register(MockV1, ());
        let mock = MockV1Client::new(&env, &id);
        mock.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));
        id
    };

    // Create two streams via migration
    let sid0 = v2_client.migrate_stream(&v1_id, &0u64, &receiver);
    // Re-seed for second migration
    {
        let mock = MockV1Client::new(&env, &v1_id);
        mock.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));
    }
    let sid1 = v2_client.migrate_stream(&v1_id, &1u64, &receiver);

    // Bump TTL for both existing + one non-existent ID
    let ids = soroban_sdk::vec![&env, sid0, sid1, 999u64];
    let extended = v2_client.bump_active_streams_ttl(&ids);

    assert_eq!(extended, 2u32); // 999 is skipped
}

#[test]
fn test_bump_active_streams_ttl_skips_nonexistent() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    let ids = soroban_sdk::vec![&env, 42u64, 100u64, 999u64];
    let extended = v2_client.bump_active_streams_ttl(&ids);

    assert_eq!(extended, 0u32);
}

// ── Issue #400 — Multi-sig admin tests ───────────────────────────────────────

#[test]
fn test_init_creates_single_admin_with_threshold_one() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    assert_eq!(client.get_threshold(), 1u32);
    assert_eq!(client.get_admins().len(), 1u32);
    assert_eq!(client.get_admins().get(0).unwrap(), admin);
}

#[test]
fn test_set_admins_replaces_list_and_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);
    let new_admins = soroban_sdk::vec![&env, a1.clone(), a2.clone(), a3.clone()];
    let op = crate::types::Operation::SetAdmins(new_admins, 2);

    client.schedule_op(&op);

    // Advance time by 48 hours and 1 second
    env.ledger().set_timestamp(48 * 60 * 60 + 1);

    client.execute_op(&op);

    assert_eq!(client.get_threshold(), 2u32);
    assert_eq!(client.get_admins().len(), 3u32);
}

// ── transfer_admin tests ──────────────────────────────────────────────────────

#[test]
fn test_transfer_admin_changes_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    assert_eq!(client.admin(), new_admin);
}

#[test]
fn test_transfer_admin_old_admin_loses_access() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    // After transfer, the admin list contains only new_admin.
    assert_eq!(client.get_admins().len(), 1u32);
    assert_eq!(client.get_admins().get(0).unwrap(), new_admin);
}

#[test]
fn test_transfer_admin_requires_current_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let new_admin = Address::generate(&env);

    // No auth mocked at all — should panic/error because admin hasn't authorised.
    let result = client.try_transfer_admin(&new_admin);
    assert!(result.is_err());
}

// ── Issue #396 — Dust threshold tests ────────────────────────────────────────

#[test]
fn test_get_min_value_returns_default() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, v2_client) = setup_v2(&env, &admin);
    let token = Address::generate(&env);

    // Default is 10 XLM = 100_000_000 stroops
    assert_eq!(v2_client.get_min_value(&token), 100_000_000i128);
}

#[test]
fn test_admin_can_manage_asset_whitelist() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    assert!(!v2_client.is_asset_whitelisted(&token));

    v2_client.add_to_whitelist(&token);
    assert!(v2_client.is_asset_whitelisted(&token));

    v2_client.remove_from_whitelist(&token);
    assert!(!v2_client.is_asset_whitelisted(&token));
}

#[test]
fn test_create_stream_fails_for_non_whitelisted_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);

    asset_client.mint(&sender, &100_000_000);

    let result =
        v2_client.try_create_stream(&stream_args(&sender, &receiver, &token_id, 100_000_000));
    assert_eq!(result, Err(Ok(Error::AssetNotWhitelisted)));
}

// ── Analytics / Protocol Health tests ────────────────────────────────────────

#[test]
fn test_get_v2_protocol_health_updates_correctly() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 100);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let v1_id = env.register(MockV1, ());
    let v1_client = MockV1Client::new(&env, &v1_id);
    v1_client.seed_stream(&make_v1_stream(&env, &sender, &receiver, &token_id));

    let (_, v2_client) = setup_v2(&env, &admin);

    // Initial health should be zero.
    let health = v2_client.get_v2_protocol_health();
    assert_eq!(health.total_v2_tvl, 0);
    assert_eq!(health.active_v2_users, 0);
    assert_eq!(health.total_v2_streams, 0);

    // Migrate first stream (500 TVL, 2 unique users).
    v2_client.migrate_stream(&v1_id, &0u64, &receiver);

    let health = v2_client.get_v2_protocol_health();
    assert_eq!(health.total_v2_tvl, 500);
    assert_eq!(health.active_v2_users, 2);
    assert_eq!(health.total_v2_streams, 1);
}

// ── Cliff and Withdraw/Cancel tests ───────────────────────────────────────────

#[test]
fn test_cliff_period_locks_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Mint tokens to sender
    asset_client.mint(&sender, &100_000_000);

    // Create a stream with a cliff.
    // Start: 100, Cliff: 150, End: 200. Amount: 100,000,000.
    let start_time = 100;
    let cliff_time = 150;
    let end_time = 200;
    let total_amount = 100_000_000;

    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount,
        start_time,
        cliff_time,
        end_time,
        step_duration: 0,
        multiplier_bps: 0,
        penalty_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // 1. Before cliff (t=140): unlocked should be zero
    env.ledger().with_mut(|li| li.timestamp = 140);
    let result = v2_client.try_withdraw(&sid, &receiver);
    assert!(result.is_err()); // Nothing to withdraw / Error::NothingToMigrate for now

    // 2. At cliff (t=150): unlocked should jump to accumulated amount
    // accumulated = 100,000,000 * (150-100)/(200-100) = 100,000,000 * 50/100 = 50,000,000
    env.ledger().with_mut(|li| li.timestamp = 150);
    v2_client.withdraw(&sid, &receiver);
    // At t=150: 100,000,000 * (150-100)/(200-100) = 50,000,000
    assert_eq!(token_client.balance(&receiver), 50_000_000);

    // 3. After cliff (t=175): 100,000,000 * (175-100)/(200-100) = 75,000,000 total unlocked.
    // 75,000,000 - 50,000,000 (already withdrawn) = 25,000,000 available.
    env.ledger().with_mut(|li| li.timestamp = 175);
    v2_client.withdraw(&sid, &receiver);
    assert_eq!(token_client.balance(&receiver), 75_000_000);
}

#[test]
fn test_v2_cancel_splits_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    // Create stream: t=0 to t=100. amount=100,000,000. no cliff.
    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
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
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Cancel at t=30.
    // Unlocked = 100,000,000 * 30/100 = 30,000,000.
    // to_receiver = 30,000,000, to_sender = 100,000,000 - 30,000,000 = 70,000,000.
    env.ledger().with_mut(|li| li.timestamp = 30);
    v2_client.cancel(&sid, &sender);

    assert_eq!(token_client.balance(&receiver), 30_000_000);
    assert_eq!(token_client.balance(&sender), 70_000_000);
}

// ── Escalating Rates (Issue #363) tests ─────────────────────────────────────

#[test]
fn test_geometric_rate_unlock_math() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    // Step-up stream:
    // Total: 100,000,000
    // Duration: 100s (e.g. t=0 to t=100)
    // Step: 50s
    // Multiplier: 100% increase (10000 bps)
    // N = 100/50 = 2 steps
    // q = 1 + 1 = 2
    // S_2 = (2^2 - 1)/(2 - 1) = 3
    // Unlocked should be:
    // t=0: 0
    // t=25: 1000 * [ (2^0 - 1)*50 + 2^0 * 25 * 1 ] / [ 3 * 50 / 1 ] = 1000 * 25 / 150 = 166.66
    // Wait, let's use the formula from code:
    // numerator = 1000 * [ (1-1)*50 + 1 * 25 * 10000/10000 ] = 1000 * 25 = 25000
    // denominator = 4*1e9/1e9 - 1 = 3? No, power_scale returns 1e9 * q^n.
    // denominator = 1e9 * 2^2 - 1e9 = 3e9.
    // numerator = 1000 * [ (1e9 - 1e9)*50 + 1e9 * 25 * 1 ] = 1000 * 25e9 = 25000e9.
    // unlocked = 25000e9 / 3e9 = 8333.
    // Wait, my manual calculation is wrong.
    // Initial rate R0: A = R0 * D * S_N => 1000 = R0 * 50 * (1 + 2) = R0 * 150 => R0 = 1000 / 150 = 6.666
    // t=25: 6.666 * 25 = 166.66
    // t=50 (End of step 0): 6.666 * 50 = 333.33
    // t=75 (Middle of step 1): 333.33 + (6.666 * 2) * 25 = 333.33 + 333.33 = 666.66
    // t=100 (End of stream): 333.33 + (6.666 * 2) * 50 = 333.33 + 666.66 = 1000

    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 50,
        multiplier_bps: 10000,
        penalty_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // t=25
    env.ledger().with_mut(|li| li.timestamp = 25);
    v2_client.withdraw(&sid, &receiver);
    assert!(token_client.balance(&receiver) >= 16_666_000);

    // t=50
    env.ledger().with_mut(|li| li.timestamp = 50);
    v2_client.withdraw(&sid, &receiver);
    assert!(token_client.balance(&receiver) >= 33_333_000);

    // t=75
    env.ledger().with_mut(|li| li.timestamp = 75);
    v2_client.withdraw(&sid, &receiver);
    assert!(token_client.balance(&receiver) >= 66_666_000);

    // t=100
    env.ledger().with_mut(|li| li.timestamp = 100);
    v2_client.withdraw(&sid, &receiver);
    assert_eq!(token_client.balance(&receiver), 100_000_000);
}

#[test]
fn test_create_batch_streams_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    // Mint tokens to sender
    asset_client.mint(&sender, &1_000_000_000);

    let (v2_address, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Create batch of 2 streams
    let streams = soroban_sdk::vec![
        &env,
        StreamArgs {
            sender: sender.clone(),
            receiver: receiver1.clone(),
            token: token_id.clone(),
            total_amount: 100_000_000,
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
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            ..Default::default()
        },
        StreamArgs {
            sender: sender.clone(),
            receiver: receiver2.clone(),
            token: token_id.clone(),
            total_amount: 200_000_000,
            start_time: 0,
            cliff_time: 0,
            end_time: 200,
            step_duration: 0,
            multiplier_bps: 0,
            penalty_bps: 0,
            vault_address: None,
            yield_enabled: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            affiliate: None,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            ..Default::default()
        },
    ];

    let stream_ids = v2_client.create_batch_streams(&streams);

    // Should return 2 stream IDs
    assert_eq!(stream_ids.len(), 2);
    assert_eq!(stream_ids.get(0).unwrap(), 0);
    assert_eq!(stream_ids.get(1).unwrap(), 1);

    // Check streams were created
    let stream1 = v2_client.get_stream(&0).unwrap();
    assert_eq!(stream1.sender, sender);
    assert_eq!(stream1.receiver, receiver1);
    assert_eq!(stream1.total_amount, 100_000_000);

    let stream2 = v2_client.get_stream(&1).unwrap();
    assert_eq!(stream2.sender, sender);
    assert_eq!(stream2.receiver, receiver2);
    assert_eq!(stream2.total_amount, 200_000_000);

    // Check tokens were transferred
    assert_eq!(token_client.balance(&sender), 700_000_000); // 1e9 - 3e8
    assert_eq!(token_client.balance(&v2_address), 300_000_000);
}

#[test]
fn test_create_batch_streams_max_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, _) = create_token(&env, &token_admin);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Create 11 streams (exceeds limit)
    let mut streams = Vec::new(&env);
    for _i in 0..11 {
        streams.push_back(StreamArgs {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 10_000_000,
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
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            ..Default::default()
        });
    }

    let result = v2_client.try_create_batch_streams(&streams);
    assert_eq!(result, Err(Ok(Error::BatchTooLarge)));
}

#[test]
fn test_create_batch_streams_atomic_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    // Mint insufficient tokens
    asset_client.mint(&sender, &200_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Create batch with total amount exceeding balance (100M + 110M = 210M > 200M)
    let streams = soroban_sdk::vec![
        &env,
        StreamArgs {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 100_000_000,
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
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            ..Default::default()
        },
        StreamArgs {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token_id.clone(),
            total_amount: 110_000_000,
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
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            ..Default::default()
        },
    ];

    // Should fail atomically (insufficient balance)
    let result = v2_client.try_create_batch_streams(&streams);
    assert!(result.is_err());

    // No streams should be created
    assert!(v2_client.get_stream(&0).is_none());
    assert!(v2_client.get_stream(&1).is_none());

    // Balance should be unchanged
    assert_eq!(token_client.balance(&sender), 200_000_000);
}

#[test]
fn test_create_stream_deducts_protocol_fee_to_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (contract_id, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_treasury(&treasury);
    v2_client.set_fee_bps(&10u32);

    let sid = v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, 100_000_000));

    let stream = v2_client.get_stream(&sid).unwrap();
    assert_eq!(stream.total_amount, 99_900_000);
    assert_eq!(v2_client.get_pending_fees(&treasury, &token_id), 100_000);
    assert_eq!(token_client.balance(&sender), 900_000_000);
    assert_eq!(token_client.balance(&contract_id), 100_000_000);
}

#[test]
fn test_create_stream_with_fee_requires_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_fee_bps(&10u32);

    let result =
        v2_client.try_create_stream(&stream_args(&sender, &receiver, &token_id, 100_000_000));
    assert_eq!(result, Err(Ok(Error::NoTreasury)));
}

#[test]
fn test_gas_buffer_deposit_withdraw_and_query() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&admin, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);

    // Initial buffer is empty.
    assert_eq!(v2_client.get_gas_buffer_balance(&admin), 0);

    // Deposit 100M stroops into sender's buffer.
    let deposit_amount = 100_000_000;
    v2_client.deposit_gas_buffer(&admin, &deposit_amount);
    assert_eq!(v2_client.get_gas_buffer_balance(&admin), deposit_amount);

    // Withdraw 40M to beneficiary.
    v2_client.withdraw_gas_buffer(&admin, &40_000_000, &beneficiary);
    assert_eq!(v2_client.get_gas_buffer_balance(&admin), 60_000_000);
    assert_eq!(token_client.balance(&beneficiary), 40_000_000);
}

#[test]
fn test_split_multi_asset_requires_gas_buffer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);

    let recipients = soroban_sdk::vec![
        &env,
        crate::types::MultiAssetRecipient {
            address: receiver1.clone(),
            asset: token_id.clone(),
            amount: 100_000_000,
        },
        crate::types::MultiAssetRecipient {
            address: receiver2.clone(),
            asset: token_id.clone(),
            amount: 100_000_000,
        },
    ];

    // Without gas buffer, split should fail.
    let result = v2_client.try_split_multi_asset(&sender, &recipients);
    assert_eq!(result, Err(Ok(Error::InsufficientGasBuffer)));

    // Fund sender buffer and retry.
    asset_client.mint(&sender, &100_000_000);
    v2_client.deposit_gas_buffer(&sender, &GAS_FEE_PER_SPLIT_STROOPS);

    v2_client.split_multi_asset(&sender, &recipients);

    assert_eq!(token_client.balance(&receiver1), 100_000_000);
    assert_eq!(token_client.balance(&receiver2), 100_000_000);
    assert_eq!(v2_client.get_gas_buffer_balance(&sender), 0);
}

#[test]
fn test_split_funds_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);

    // Deposit exactly one execution's gas buffer fee.
    v2_client.deposit_gas_buffer(&sender, &GAS_FEE_PER_SPLIT_STROOPS);

    let recipients = soroban_sdk::vec![
        &env,
        crate::types::Recipient {
            address: receiver1.clone(),
            amount: 100_000_000,
        },
        crate::types::Recipient {
            address: receiver2.clone(),
            amount: 100_000_000,
        },
    ];

    v2_client.split_funds(&sender, &token_id, &recipients);

    assert_eq!(token_client.balance(&receiver1), 100_000_000);
    assert_eq!(token_client.balance(&receiver2), 100_000_000);
    assert_eq!(v2_client.get_gas_buffer_balance(&sender), 0);
}

#[test]
fn test_split_funds_fails_atomically_on_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    // Mint only enough for the gas-buffer deposit + the first recipient.
    asset_client.mint(&sender, &(GAS_FEE_PER_SPLIT_STROOPS + 100_000_000));

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);

    // Deposit exactly one execution's gas buffer fee.
    v2_client.deposit_gas_buffer(&sender, &GAS_FEE_PER_SPLIT_STROOPS);

    let recipients = soroban_sdk::vec![
        &env,
        crate::types::Recipient {
            address: receiver1.clone(),
            amount: 100_000_000,
        },
        crate::types::Recipient {
            address: receiver2.clone(),
            amount: 1,
        },
    ];

    let sender_balance_before = token_client.balance(&sender);

    // Should fail atomically (insufficient balance on second transfer).
    let result = v2_client.try_split_funds(&sender, &token_id, &recipients);
    assert!(result.is_err());

    // No recipients should receive tokens.
    assert_eq!(token_client.balance(&receiver1), 0);
    assert_eq!(token_client.balance(&receiver2), 0);

    // Sender balance should be unchanged from immediately before the call.
    assert_eq!(token_client.balance(&sender), sender_balance_before);
}

#[test]
fn test_split_multi_asset_fails_on_non_token_asset() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);
    v2_client.deposit_gas_buffer(&sender, &GAS_FEE_PER_SPLIT_STROOPS);

    let bad_asset = Address::generate(&env); // not an asset contract

    let recipients = soroban_sdk::vec![
        &env,
        crate::types::MultiAssetRecipient {
            address: receiver.clone(),
            asset: bad_asset,
            amount: 100_000_000
        },
    ];

    let result = v2_client.try_split_multi_asset(&sender, &recipients);
    assert_eq!(result, Err(Ok(Error::AssetInterfaceNotSupported)));
}

#[test]
fn test_split_multi_asset_fails_on_too_many_recipients() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &10_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.set_fee_token(&token_id);

    let mut recipients = soroban_sdk::vec!(&env);
    for i in 0..121 {
        recipients.push_back(crate::types::MultiAssetRecipient {
            address: Address::generate(&env),
            asset: token_id.clone(),
            amount: 1_000_000,
        });
    }

    let result = v2_client.try_split_multi_asset(&sender, &recipients);
    assert_eq!(result, Err(Ok(Error::BatchTooLarge)));
}

#[test]
fn test_withdraw_treasury_transfers_pending_fees() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_treasury(&treasury);
    v2_client.set_fee_bps(&10u32);
    v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, 200_000_000));

    let withdrawn = v2_client.withdraw_treasury(&token_id);
    assert_eq!(withdrawn, 200_000);
    assert_eq!(v2_client.get_pending_fees(&treasury, &token_id), 0);
    assert_eq!(token_client.balance(&treasury), 200_000);
}

// ── Governance: Stream-Weighted Voting Power tests ───────────────────────────

#[test]
fn test_get_active_volume_single_stream_as_receiver() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    // Create stream: 100M tokens
    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Receiver should have 100M locked
    let volume = v2_client.get_active_volume(&receiver);
    assert_eq!(volume, 100_000_000);
}

#[test]
fn test_get_active_volume_single_stream_as_sender() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Sender should also have 100M locked (their commitment)
    let volume = v2_client.get_active_volume(&sender);
    assert_eq!(volume, 100_000_000);
}

#[test]
fn test_get_active_volume_multiple_streams() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &600_000_000);

    // Create 3 streams
    let _sid1 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    let _sid2 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 200_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    let _sid3 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 300_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Receiver should have total of 600M locked
    let volume = v2_client.get_active_volume(&receiver);
    assert_eq!(volume, 600_000_000);
}

#[test]
fn test_get_active_volume_after_partial_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    // Create stream: 100M tokens, 0 to 100
    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // At t=50, 50M unlocked
    env.ledger().with_mut(|li| li.timestamp = 50);
    v2_client.withdraw(&sid, &receiver);

    // After withdrawing 50M, 50M should remain locked
    let volume = v2_client.get_active_volume(&receiver);
    assert_eq!(volume, 50_000_000);
}

#[test]
fn test_get_active_volume_excludes_cancelled_streams() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &200_000_000);

    // Create 2 streams
    let sid1 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    let sid2 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Cancel first stream
    env.ledger().with_mut(|li| li.timestamp = 50);
    v2_client.cancel(&sid1, &sender);

    // Only sid2 should count (100M), sid1 is cancelled
    let volume = v2_client.get_active_volume(&receiver);
    assert_eq!(volume, 100_000_000);
}

#[test]
fn test_get_active_volume_unrelated_user_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &100_000_000);

    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 100_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Stranger has no involvement in the stream
    let volume = v2_client.get_active_volume(&stranger);
    assert_eq!(volume, 0);
}

#[test]
fn test_get_active_volume_empty_stream_list() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (_, v2_client) = setup_v2(&env, &admin);

    // Empty list should return 0
    let volume = v2_client.get_active_volume(&user);
    assert_eq!(volume, 0);
}

#[test]
fn test_get_active_volume_mixed_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let other1 = Address::generate(&env);
    let _other2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&user, &200_000_000);
    asset_client.mint(&other1, &200_000_000);

    // User as sender
    let _sid1 = v2_client.create_stream(&StreamArgs {
        sender: user.clone(),
        receiver: other1.clone(),
        token: token_id.clone(),
        total_amount: 200_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // User as receiver
    let _sid2 = v2_client.create_stream(&StreamArgs {
        sender: other1.clone(),
        receiver: user.clone(),
        token: token_id.clone(),
        total_amount: 200_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // User should have both streams counted: 200M + 200M = 400M
    let volume = v2_client.get_active_volume(&user);
    assert_eq!(volume, 400_000_000);
}

#[test]
fn test_rebalance_after_clawback() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver1 = Address::generate(&env);
    let receiver2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    asset_client.mint(&sender, &1000_000_000);

    // Create 2 streams of 500M each. Total remaining: 1000M
    let _sid1 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver1.clone(),
        token: token_id.clone(),
        total_amount: 500_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    let _sid2 = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver2.clone(),
        token: token_id.clone(),
        total_amount: 500_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });

    // Verify integrity before clawback
    let (balance, sum) = v2_client.check_balance_integrity(&token_id);
    assert_eq!(balance, 1000_000_000);
    assert_eq!(sum, 1000_000_000);

    // Simulate clawback of 500M from the contract address
    // We achieve this by transferring tokens OUT of the contract in the test environment
    env.mock_all_auths();
    token_client.transfer(&v2_client.address, &admin, &500_000_000);

    // Verify deficit
    let (balance, sum) = v2_client.check_balance_integrity(&token_id);
    assert_eq!(balance, 500_000_000);
    assert_eq!(sum, 1000_000_000);

    // Rebalance
    v2_client.rebalance_after_clawback(&token_id);

    // Verify proportional reduction (factor = 50%)
    let stream1 = v2_client.get_stream(&0).unwrap();
    let stream2 = v2_client.get_stream(&1).unwrap();

    assert_eq!(stream1.total_amount, 250_000_000);
    assert_eq!(stream2.total_amount, 250_000_000);

    // Final integrity check
    let (balance, sum) = v2_client.check_balance_integrity(&token_id);
    assert_eq!(balance, 500_000_000);
    assert_eq!(sum, 500_000_000);
}

// ── DeFi: Yield-Bearing Vault tests ──────────────────────────────────────────

#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn set_token(env: Env, token: Address, v2_addr: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
        env.storage()
            .instance()
            .set(&symbol_short!("v2_addr"), &v2_addr);
    }

    pub fn deposit(env: Env, amount: i128) {
        // In a real vault, we'd take tokens. Here we just mock, and transfer in the test to avoid auth issues.
    }

    pub fn withdraw(env: Env, amount: i128) -> i128 {
        let is_paused = env
            .storage()
            .instance()
            .get::<Symbol, bool>(&symbol_short!("paused"))
            .unwrap_or(false);
        if is_paused {
            panic!("Vault is paused");
        }
        let token: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let v2_addr: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("v2_addr"))
            .unwrap();
        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
        let interest = amount / 10;
        token_client.transfer(
            &env.current_contract_address(),
            &v2_addr,
            &(amount + interest),
        );
        amount
    }

    pub fn set_paused(env: Env, paused: bool) {
        env.storage()
            .instance()
            .set(&symbol_short!("paused"), &paused);
    }

    /// Returns a fixed 10% simulated yield on the principal.
    pub fn get_accrued_interest(_env: Env, principal: i128) -> i128 {
        principal / 10
    }
}

#[test]
fn test_yield_bearing_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);
    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    // Register Mock Vault
    let vault_id = env.register_contract(None, MockVault);
    let vault_client = MockVaultClient::new(&env, &vault_id);
    vault_client.set_token(&token_id, &v2_client.address);

    asset_client.mint(&sender, &1000_000_000);
    asset_client.mint(&vault_id, &100_000_000);

    // Create yield-bearing stream
    let sid = v2_client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 500_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: Some(vault_id.clone()),
        yield_enabled: true,
        is_recurrent: false,
        cycle_duration: 0,
        cancellation_type: 0,
        affiliate: None,
        yield_recipient: 0,
        split_address: None,
        split_bps: 0,
        ..Default::default()
    });
    token_client.transfer(&v2_client.address, &vault_id, &500_000_000);

    soroban_sdk::log!(
        &env,
        "Contract balance: {}",
        token_client.balance(&v2_client.address)
    );
    soroban_sdk::log!(&env, "Vault balance: {}", token_client.balance(&vault_id));
    soroban_sdk::log!(&env, "Sender balance: {}", token_client.balance(&sender));

    // Advance time to t=500 (50% unlocked)
    env.ledger().set_timestamp(500);

    // Withdraw. Should call vault.
    v2_client.withdraw(&0, &receiver);

    // Check balance
    assert_eq!(token_client.balance(&receiver), 250_000_000);

    // Simulate Vault Pause
    vault_client.set_paused(&true);

    // Try to withdraw remaining 250M. Should return 0 and set is_pending.
    env.ledger().set_timestamp(1000);
    let result = v2_client.withdraw(&0, &receiver);

    assert_eq!(result, 0);

    // Verify stream is pending
    let stream = v2_client.get_stream(&0).unwrap();
    assert!(stream.is_pending);

    // Unpause and retry
    vault_client.set_paused(&false);
    v2_client.withdraw(&0, &receiver);

    assert_eq!(token_client.balance(&receiver), 500_000_000);
}

// ── Issue #934: Decommission Logic ───────────────────────────────────────────

#[test]
fn test_decommission_blocks_create_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    client.decommission_contract();

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, _, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);

    let result = client.try_create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 500_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });
    assert!(result.is_err());
}

#[test]
fn test_decommission_withdraw_allowed_within_claim_window() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(&env);
    let (contract_id, client) = setup_v2(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, token_client, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);
    client.add_to_whitelist(&token_id);

    client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 1_000_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 2000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });

    // Decommission at t=1000 → claim_deadline = 1000 + 90*24*3600
    client.decommission_contract();

    // Advance to t=1500 (still within 90-day window)
    env.ledger().set_timestamp(1500);
    let withdrawn = client.withdraw(&0, &receiver);
    assert!(withdrawn > 0);
    assert!(token_client.balance(&receiver) > 0);
}

#[test]
fn test_decommission_withdraw_blocked_after_claim_window() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, _, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);
    client.add_to_whitelist(&token_id);

    client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 1_000_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 100_000_000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });

    client.decommission_contract();

    // Jump past the 90-day claim window (90 * 24 * 3600 = 7_776_000 seconds)
    env.ledger().set_timestamp(1000 + 7_776_001);
    let result = client.try_withdraw(&0, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_decommission_only_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    // Calling without init (no admin) should fail — but here admin is set.
    // Verify state is Active before decommission.
    assert_eq!(
        client.get_contract_state(),
        crate::types::ContractState::Active
    );
    client.decommission_contract();
    assert_eq!(
        client.get_contract_state(),
        crate::types::ContractState::Terminated
    );
}

// ── Issue #937: Sanctions Oracle ─────────────────────────────────────────────

/// Minimal mock oracle contract for testing.
mod mock_oracle {
    use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

    #[contract]
    pub struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn is_sanctioned(env: Env, address: Address) -> bool {
            // Treat any address stored under key "BLOCKED" as sanctioned.
            let blocked: Vec<Address> = env
                .storage()
                .instance()
                .get(&soroban_sdk::symbol_short!("BLOCKED"))
                .unwrap_or(Vec::new(&env));
            blocked.contains(&address)
        }

        pub fn block(env: Env, address: Address) {
            let mut blocked: Vec<Address> = env
                .storage()
                .instance()
                .get(&soroban_sdk::symbol_short!("BLOCKED"))
                .unwrap_or(Vec::new(&env));
            blocked.push_back(address);
            env.storage()
                .instance()
                .set(&soroban_sdk::symbol_short!("BLOCKED"), &blocked);
        }
    }
}

#[test]
fn test_sanctions_oracle_blocks_cancel_to_sanctioned_receiver() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, _, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);
    client.add_to_whitelist(&token_id);

    client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 1_000_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });

    // Deploy and configure oracle
    let oracle_id = env.register(mock_oracle::MockOracle, ());
    let oracle_client = mock_oracle::MockOracleClient::new(&env, &oracle_id);
    oracle_client.block(&receiver);

    client.set_oracle_address(&oracle_id);

    // Cancel should fail because receiver is sanctioned
    let result = client.try_cancel(&0, &sender);
    assert!(result.is_err());
}

#[test]
fn test_sanctions_oracle_blocks_withdraw_to_sanctioned_beneficiary() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, _, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);
    client.add_to_whitelist(&token_id);

    client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 1_000_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });

    let oracle_id = env.register(mock_oracle::MockOracle, ());
    let oracle_client = mock_oracle::MockOracleClient::new(&env, &oracle_id);
    oracle_client.block(&receiver);

    client.set_oracle_address(&oracle_id);

    let result = client.try_withdraw(&0, &receiver);
    assert!(result.is_err());
}

#[test]
fn test_sanctions_oracle_no_oracle_set_allows_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(500);

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let (token_id, token_client, sac) = create_token(&env, &admin);
    sac.mint(&sender, &1_000_000_000);
    client.add_to_whitelist(&token_id);

    client.create_stream(&StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: 1_000_000_000,
        start_time: 0,
        cliff_time: 0,
        end_time: 1000,
        step_duration: 0,
        multiplier_bps: 0,
        vault_address: None,
        yield_enabled: false,
        ..Default::default()
    });

    // No oracle set — withdraw should succeed normally
    let withdrawn = client.withdraw(&0, &receiver);
    assert!(withdrawn > 0);
    assert!(token_client.balance(&receiver) > 0);
}

// ── Issue #938 — Variable-Fee Tiered Logic tests ────────────────────────────

#[test]
fn test_set_get_fee_tiers_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let tiers = vec![
        &env,
        FeeTier {
            threshold: 100_000_000, // 100M stroops
            fee_bps: 100,           // 1%
        },
        FeeTier {
            threshold: 1_000_000_000, // 1B stroops
            fee_bps: 50,              // 0.5%
        },
    ];

    client.set_fee_tiers(&tiers);

    let fetched_tiers = client.get_fee_tiers();
    assert_eq!(fetched_tiers.len(), 2);
    assert_eq!(fetched_tiers.get(0).unwrap(), tiers.get(0).unwrap());
    assert_eq!(fetched_tiers.get(1).unwrap(), tiers.get(1).unwrap());
}

#[test]
fn test_set_fee_tiers_admin_only() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let tiers = vec![
        &env,
        FeeTier {
            threshold: 100_000_000,
            fee_bps: 100,
        },
    ];

    // Attempt to set tiers without admin auth (should fail)
    let result = client.try_set_fee_tiers(&tiers);
    assert!(result.is_err());

    // Mock non_admin auth, still fails
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    env.mock_auths(&[MockAuth {
        address: &non_admin,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "set_fee_tiers",
            args: (tiers.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = client.try_set_fee_tiers(&tiers);
    assert!(result.is_err());
}

#[test]
fn test_set_fee_tiers_fee_too_high() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    // Attempt to set a tier with fee_bps > MAX_FEE_BPS (500)
    let tiers = vec![
        &env,
        FeeTier {
            threshold: 100_000_000,
            fee_bps: MAX_FEE_BPS + 1, // 501 BPS
        },
    ];

    let result = client.try_set_fee_tiers(&tiers);
    assert_eq!(result, Err(Ok(Error::FeeTooHigh)));
}

#[test]
fn test_get_fee_tiers_empty() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let (_, client) = setup_v2(&env, &admin);

    let fetched_tiers = client.get_fee_tiers();
    assert!(fetched_tiers.is_empty());
}

#[test]
fn test_create_stream_with_tiered_fee_no_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (contract_id, v2_client) = setup_v2(&env, &admin);
    v2_client.set_treasury(&treasury);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_fee_bps(&200u32); // Default fee 2%

    let tiers = vec![
        &env,
        FeeTier {
            threshold: 500_000_000, // 500M stroops
            fee_bps: 100,           // 1%
        },
    ];
    v2_client.set_fee_tiers(&tiers);

    // Amount below threshold (100M < 500M), should apply default 2% fee
    let total_amount = 100_000_000;
    let expected_fee = (total_amount * 200) / 10_000; // 2% of 100M = 2M
    let expected_stream_amount = total_amount - expected_fee;

    let sid = v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, total_amount));
    let stream = v2_client.get_stream(&sid).unwrap();

    assert_eq!(stream.total_amount, expected_stream_amount);
    assert_eq!(
        v2_client.get_pending_fees(&treasury, &token_id),
        expected_fee
    );
}

#[test]
fn test_create_stream_with_tiered_fee_discount_applied() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &2_000_000_000);

    let (contract_id, v2_client) = setup_v2(&env, &admin);
    v2_client.set_treasury(&treasury);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_fee_bps(&200u32); // Default fee 2%

    let tiers = vec![
        &env,
        FeeTier {
            threshold: 500_000_000, // 500M stroops
            fee_bps: 100,           // 1%
        },
        FeeTier {
            threshold: 1_000_000_000, // 1B stroops
            fee_bps: 50,              // 0.5%
        },
    ];
    v2_client.set_fee_tiers(&tiers);

    // Amount above second threshold (1.5B > 1B), should apply 0.5% fee
    let total_amount = 1_500_000_000;
    let expected_fee = (total_amount * 50) / 10_000; // 0.5% of 1.5B = 7.5M
    let expected_stream_amount = total_amount - expected_fee;

    let sid = v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, total_amount));
    let stream = v2_client.get_stream(&sid).unwrap();

    assert_eq!(stream.total_amount, expected_stream_amount);
    assert_eq!(
        v2_client.get_pending_fees(&treasury, &token_id),
        expected_fee
    );
}

#[test]
fn test_create_stream_with_tiered_fee_exact_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &1_000_000_000);

    let (contract_id, v2_client) = setup_v2(&env, &admin);
    v2_client.set_treasury(&treasury);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_fee_bps(&200u32); // Default fee 2%

    let tiers = vec![
        &env,
        FeeTier {
            threshold: 500_000_000, // 500M stroops
            fee_bps: 100,           // 1%
        },
    ];
    v2_client.set_fee_tiers(&tiers);

    // Amount exactly at threshold (500M), should apply 1% fee
    let total_amount = 500_000_000;
    let expected_fee = (total_amount * 100) / 10_000; // 1% of 500M = 5M
    let expected_stream_amount = total_amount - expected_fee;

    let sid = v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, total_amount));
    let stream = v2_client.get_stream(&sid).unwrap();

    assert_eq!(stream.total_amount, expected_stream_amount);
    assert_eq!(
        v2_client.get_pending_fees(&treasury, &token_id),
        expected_fee
    );
}

#[test]
fn test_create_stream_with_tiered_fee_no_tiers_set() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, token_client, asset_client) = create_token(&env, &token_admin);

    asset_client.mint(&sender, &2_000_000_000);

    let (contract_id, v2_client) = setup_v2(&env, &admin);
    v2_client.set_treasury(&treasury);
    v2_client.add_to_whitelist(&token_id);
    v2_client.set_fee_bps(&200u32); // Default fee 2%

    // No tiers set, should apply default 2% fee regardless of amount
    let total_amount = 1_500_000_000;
    let expected_fee = (total_amount * 200) / 10_000; // 2% of 1.5B = 30M
    let expected_stream_amount = total_amount - expected_fee;

    let sid = v2_client.create_stream(&stream_args(&sender, &receiver, &token_id, total_amount));
    let stream = v2_client.get_stream(&sid).unwrap();

    assert_eq!(stream.total_amount, expected_stream_amount);
    assert_eq!(
        v2_client.get_pending_fees(&treasury, &token_id),
        expected_fee
    );
}

#[test]
fn test_create_stream_overflow_total_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    let overflow_amount = MAX_STREAM_AMOUNT + 1;
    asset_client.mint(&sender, &overflow_amount);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    let stream_args = StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: overflow_amount,
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
    };

    let result = v2_client.try_create_stream(&stream_args);
    assert_eq!(result, Err(Ok(Error::AmountOverflow)));
}

#[test]
fn test_create_stream_overflow_flow_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    let duration = 10;
    let overflow_amount = MAX_FLOW_RATE * duration + 1;
    asset_client.mint(&sender, &overflow_amount);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    let stream_args = StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
        total_amount: overflow_amount,
        start_time: 0,
        cliff_time: 0,
        end_time: duration as u64,
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
    };

    let result = v2_client.try_create_stream(&stream_args);
    assert_eq!(result, Err(Ok(Error::AmountOverflow)));
}

#[test]
fn test_propose_rate_overflow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _, asset_client) = create_token(&env, &token_admin);

    let total_amount = 100_000_000;
    asset_client.mint(&sender, &total_amount);

    let (_, v2_client) = setup_v2(&env, &admin);
    v2_client.add_to_whitelist(&token_id);

    let stream_args = StreamArgs {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token_id.clone(),
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
    };

    let sid = v2_client.create_stream(&stream_args);

    let overflow_rate = MAX_FLOW_RATE + 1;
    let result = v2_client.try_propose_rate(&sid, &overflow_rate);
    assert_eq!(result, Err(Ok(Error::AmountOverflow)));
}
