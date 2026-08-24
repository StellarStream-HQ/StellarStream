#![cfg(test)]
//! Tests for the secure WASM upgrade mechanism and version tracking.
//!
//! `upgrade()` now returns `Result<(), Error>` and tracks a version counter
//! in `DataKey::ContractVersion` (instance storage).  Instance storage
//! persists across WASM swaps, so all stream state and roles survive an
//! upgrade — which is what the tests below verify at the unit-test level.
//!
//! Note: `env.deployer().update_current_contract_wasm(hash)` in the Soroban
//! test harness records the hash without requiring the binary to be present,
//! so all authorization, version-tracking, storage-persistence, and
//! event-emission logic is fully testable in pure unit tests.

use crate::errors::Error;
use crate::rbac::Role;
use crate::types::DataKey;
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{Address, BytesN, Env};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, StellarStreamContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    (env, admin, client)
}

fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

// ── Test 1: successful upgrade ────────────────────────────────────────────────

/// An admin holding SuperAdmin role can call upgrade and gets Ok(()).
#[test]
fn test_upgrade_by_admin_succeeds() {
    let (env, admin, client) = setup();
    let result = client.try_upgrade(&admin, &dummy_hash(&env, 0x01));
    assert!(result.is_ok(), "Admin upgrade should succeed, got {:?}", result);
}

// ── Test 2: non-admin attempt is rejected ─────────────────────────────────────

/// A stranger without SuperAdmin gets Error::Unauthorized.
#[test]
fn test_upgrade_by_non_admin_fails() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_upgrade(&stranger, &dummy_hash(&env, 0x02));
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::Unauthorized);
}

/// Guardian role alone is not sufficient to upgrade.
#[test]
fn test_upgrade_by_guardian_only_fails() {
    let (env, admin, client) = setup();
    let guardian = Address::generate(&env);
    client.grant_role(&admin, &guardian, &Role::Guardian);
    let result = client.try_upgrade(&guardian, &dummy_hash(&env, 0x03));
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().unwrap(), Error::Unauthorized);
}

// ── Test 3: version tracking ──────────────────────────────────────────────────

/// Fresh contract reports version 1 before any upgrade.
#[test]
fn test_get_version_initial_value() {
    let (_env, _admin, client) = setup();
    assert_eq!(client.get_version(), 1, "Fresh contract should be version 1");
}

/// After one upgrade, get_version returns 2.
#[test]
fn test_get_version_increments_after_upgrade() {
    let (env, admin, client) = setup();
    assert_eq!(client.get_version(), 1);
    client.upgrade(&admin, &dummy_hash(&env, 0x10));
    assert_eq!(client.get_version(), 2);
}

/// Version increments correctly over multiple sequential upgrades.
#[test]
fn test_get_version_increments_each_upgrade() {
    let (env, admin, client) = setup();
    client.upgrade(&admin, &dummy_hash(&env, 0x11));
    assert_eq!(client.get_version(), 2);
    client.upgrade(&admin, &dummy_hash(&env, 0x12));
    assert_eq!(client.get_version(), 3);
    client.upgrade(&admin, &dummy_hash(&env, 0x13));
    assert_eq!(client.get_version(), 4);
}

// ── Test 4: storage persistence across upgrade ────────────────────────────────

/// Admin address and role assignments survive a WASM swap.
#[test]
fn test_storage_persists_across_upgrade() {
    let (env, admin, client) = setup();

    // Grant a second SuperAdmin before upgrading
    let second_admin = Address::generate(&env);
    client.grant_role(&admin, &second_admin, &Role::SuperAdmin);

    client.upgrade(&admin, &dummy_hash(&env, 0x20));

    // Both admins and the original admin address must survive
    assert_eq!(client.get_admin(), admin);
    assert!(client.check_role(&admin, &Role::SuperAdmin));
    assert!(client.check_role(&second_admin, &Role::SuperAdmin));
    assert_eq!(client.get_version(), 2);
}

// ── Test 5: same-version / zero-hash behaviour ────────────────────────────────

/// The unit-test harness accepts any 32-byte hash, including all-zeros.
/// This test documents that rejection is enforced at the network level on-chain.
#[test]
fn test_upgrade_with_zero_hash_accepted_in_unit_tests() {
    let (env, admin, client) = setup();
    let zero = BytesN::from_array(&env, &[0u8; 32]);
    // No panic expected in unit tests — network enforcement happens on-chain.
    let _ = client.try_upgrade(&admin, &zero);
}

// ── Test 6: upgrade event is emitted ─────────────────────────────────────────

/// A successful upgrade emits at least one event containing the "upgrade" topic.
#[test]
fn test_upgrade_emits_event() {
    let (env, admin, client) = setup();
    client.upgrade(&admin, &dummy_hash(&env, 0x30));

    let events = env.events().all();
    assert!(!events.is_empty(), "Expected at least one event after upgrade");

    let found = events.iter().any(|(_, topics, _)| {
        format!("{:?}", topics).contains("upgrade")
    });
    assert!(found, "Expected an event with 'upgrade' topic, got: {:?}", events);
}

// ── Bonus: version stored in instance storage ─────────────────────────────────

/// get_version reads from DataKey::ContractVersion — two calls must agree.
#[test]
fn test_version_reads_are_stable() {
    let (env, admin, client) = setup();
    client.upgrade(&admin, &dummy_hash(&env, 0x40));
    assert_eq!(client.get_version(), client.get_version());
    assert_eq!(client.get_version(), 2);
}

/// A newly granted SuperAdmin can also perform upgrades.
#[test]
fn test_new_super_admin_can_upgrade() {
    let (env, admin, client) = setup();
    let new_admin = Address::generate(&env);
    client.grant_role(&admin, &new_admin, &Role::SuperAdmin);
    let result = client.try_upgrade(&new_admin, &dummy_hash(&env, 0x50));
    assert!(result.is_ok());
    assert_eq!(client.get_version(), 2);
}
