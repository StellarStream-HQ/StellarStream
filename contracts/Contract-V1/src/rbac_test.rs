#![cfg(test)]
//! Integration tests for StellarStream role-based access control (RBAC).
//!
//! These tests exercise the three roles exposed by the stream contract:
//!
//! - `SuperAdmin` — manages role assignments and the OFAC restricted-address list.
//! - `Guardian` — reserved for emergency pause/freeze controls.
//! - `FinancialOperator` — reserved for fee/treasury parameter controls.
//!
//! # Scenarios covered
//!
//! - Initialization grants the deploying admin every role.
//! - Only `SuperAdmin` accounts may grant or revoke roles. Accounts holding only
//!   `Guardian` or `FinancialOperator` (and complete strangers) are rejected.
//! - Role membership is independent, idempotent and revocable.
//! - Multiple addresses may share a role and a single address may hold several.
//! - Role changes emit events and are reflected by `check_role` queries.

use crate::rbac::Role;
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{Address, Env};

/// Deploy the contract and initialize it with a freshly generated admin that
/// receives every role.
fn setup() -> (Env, Address, StellarStreamContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    (env, admin, client)
}

#[test]
fn test_initialize_grants_admin_all_roles() {
    let (_env, admin, client) = setup();

    assert!(client.check_role(&admin, &Role::SuperAdmin));
    assert!(client.check_role(&admin, &Role::Guardian));
    assert!(client.check_role(&admin, &Role::FinancialOperator));
}

#[test]
fn test_initialize_records_admin_address() {
    let (_env, admin, client) = setup();

    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_admin_can_grant_super_admin() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::SuperAdmin);

    assert!(client.check_role(&target, &Role::SuperAdmin));
}

#[test]
fn test_admin_can_grant_guardian() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);

    assert!(client.check_role(&target, &Role::Guardian));
}

#[test]
fn test_admin_can_grant_financial_operator() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::FinancialOperator);

    assert!(client.check_role(&target, &Role::FinancialOperator));
}

#[test]
fn test_admin_can_revoke_role() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);
    assert!(client.check_role(&target, &Role::Guardian));

    client.revoke_role(&admin, &target, &Role::Guardian);

    assert!(!client.check_role(&target, &Role::Guardian));
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_admin_cannot_grant_role() {
    let (env, _admin, client) = setup();
    let non_admin = Address::generate(&env);
    let target = Address::generate(&env);

    client.grant_role(&non_admin, &target, &Role::Guardian);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_admin_cannot_revoke_role() {
    let (env, admin, client) = setup();
    let non_admin = Address::generate(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);
    client.revoke_role(&non_admin, &target, &Role::Guardian);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_guardian_cannot_grant_roles() {
    let (env, admin, client) = setup();
    let guardian = Address::generate(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &guardian, &Role::Guardian);
    client.grant_role(&guardian, &target, &Role::SuperAdmin);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_financial_operator_cannot_grant_roles() {
    let (env, admin, client) = setup();
    let operator = Address::generate(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &operator, &Role::FinancialOperator);
    client.grant_role(&operator, &target, &Role::Guardian);
}

#[test]
fn test_address_can_hold_multiple_roles() {
    let (env, admin, client) = setup();
    let multi = Address::generate(&env);

    client.grant_role(&admin, &multi, &Role::Guardian);
    client.grant_role(&admin, &multi, &Role::FinancialOperator);

    assert!(client.check_role(&multi, &Role::Guardian));
    assert!(client.check_role(&multi, &Role::FinancialOperator));
    assert!(!client.check_role(&multi, &Role::SuperAdmin));
}

#[test]
fn test_multiple_addresses_can_hold_same_role() {
    let (env, admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.grant_role(&admin, &a, &Role::Guardian);
    client.grant_role(&admin, &b, &Role::Guardian);

    assert!(client.check_role(&a, &Role::Guardian));
    assert!(client.check_role(&b, &Role::Guardian));
}

#[test]
fn test_roles_are_independent() {
    let (env, admin, client) = setup();
    let guardian = Address::generate(&env);
    let operator = Address::generate(&env);

    client.grant_role(&admin, &guardian, &Role::Guardian);
    client.grant_role(&admin, &operator, &Role::FinancialOperator);

    assert!(client.check_role(&guardian, &Role::Guardian));
    assert!(!client.check_role(&guardian, &Role::FinancialOperator));
    assert!(!client.check_role(&guardian, &Role::SuperAdmin));

    assert!(client.check_role(&operator, &Role::FinancialOperator));
    assert!(!client.check_role(&operator, &Role::Guardian));
}

#[test]
fn test_check_role_unknown_address_returns_false() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);

    assert!(!client.check_role(&stranger, &Role::SuperAdmin));
    assert!(!client.check_role(&stranger, &Role::Guardian));
    assert!(!client.check_role(&stranger, &Role::FinancialOperator));
}

#[test]
fn test_check_role_wrong_role_returns_false() {
    let (env, admin, client) = setup();
    let guardian = Address::generate(&env);

    client.grant_role(&admin, &guardian, &Role::Guardian);

    assert!(client.check_role(&guardian, &Role::Guardian));
    assert!(!client.check_role(&guardian, &Role::SuperAdmin));
    assert!(!client.check_role(&guardian, &Role::FinancialOperator));
}

#[test]
fn test_revoked_role_no_longer_reports() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);
    client.revoke_role(&admin, &target, &Role::Guardian);

    assert!(!client.check_role(&target, &Role::Guardian));
}

#[test]
fn test_grant_role_is_idempotent() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);
    client.grant_role(&admin, &target, &Role::Guardian);

    assert!(client.check_role(&target, &Role::Guardian));
}

#[test]
fn test_new_super_admin_can_manage_roles() {
    let (env, admin, client) = setup();
    let new_admin = Address::generate(&env);
    let target = Address::generate(&env);

    client.grant_role(&admin, &new_admin, &Role::SuperAdmin);
    client.grant_role(&new_admin, &target, &Role::Guardian);

    assert!(client.check_role(&target, &Role::Guardian));
}

#[test]
fn test_revoke_does_not_affect_other_roles() {
    let (env, admin, client) = setup();
    let multi = Address::generate(&env);

    client.grant_role(&admin, &multi, &Role::Guardian);
    client.grant_role(&admin, &multi, &Role::FinancialOperator);

    client.revoke_role(&admin, &multi, &Role::Guardian);

    assert!(!client.check_role(&multi, &Role::Guardian));
    assert!(client.check_role(&multi, &Role::FinancialOperator));
}

#[test]
fn test_grant_role_emits_event() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);

    assert!(!env.events().all().is_empty());
}

#[test]
fn test_revoke_role_emits_event() {
    let (env, admin, client) = setup();
    let target = Address::generate(&env);

    client.grant_role(&admin, &target, &Role::Guardian);
    client.revoke_role(&admin, &target, &Role::Guardian);

    assert!(!env.events().all().is_empty());
}
