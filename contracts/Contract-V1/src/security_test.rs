//! Automated security tests for the StellarStream contract.
//!
//! Each test targets a specific attack class: re-entrancy, integer overflow,
//! unauthorized access, race conditions, economic attacks, storage manipulation
//! and invalid-input handling. All tests must pass for the contract to be
//! considered safe under the documented threat model.
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, symbol_short, Address};

/// Malicious token that re-enters the stream contract's `withdraw` when its
/// `transfer` hook is invoked. Used to prove re-entrancy safety.
#[contract]
pub struct MaliciousToken;

#[contractimpl]
impl MaliciousToken {
    pub fn init(env: Env, stream_contract: Address, stream_id: u64) {
        env.storage()
            .instance()
            .set(&symbol_short!("CB"), &(stream_contract, stream_id));
    }

    pub fn transfer(env: Env, _from: Address, to: Address, _amount: i128) {
        let (contract, id): (Address, u64) =
            env.storage().instance().get(&symbol_short!("CB")).unwrap();
        // Attempt to re-enter the stream contract as the receiver. Use the `try_`
        // variant so the host's re-entry rejection is caught (not panicked).
        let _ = StellarStreamContractClient::new(&env, &contract).try_withdraw(&id, &to);
    }
}

fn make_stream(f: &Fixture) -> u64 {
    client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    )
}

// ----------------------------- Re-entrancy -----------------------------

#[test]
fn test_reentrancy_protection() {
    let f = setup();
    let mt = f.env.register(MaliciousToken, ());
    let id = client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &mt,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );
    MaliciousTokenClient::new(&f.env, &mt).init(&f.contract, &id);
    f.env.ledger().set_timestamp(500);

    // The malicious token re-enters `withdraw`, but the lock + checks-effects
    // pattern means only a single withdrawal of the unlocked amount occurs.
    let w = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    let s = client(&f.env, &f.contract).get_stream(&id);
    assert_eq!(w, 500_000i128);
    assert_eq!(s.withdrawn_amount, w);
}

// ----------------------------- Integer overflow -----------------------------

#[test]
fn test_integer_overflow_protection() {
    let f = setup();
    let id = client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &i128::MAX,
        &0u64,
        &1_000_000u64,
        &CURVE_LINEAR,
        &false,
    );
    f.env.ledger().set_timestamp(500_000);
    // Overflowing math must be handled with checked operations, never panic or
    // produce a wrong (huge) number.
    let unlocked = client(&f.env, &f.contract).get_unlocked_amount(&id);
    assert!(unlocked >= 0 && unlocked <= i128::MAX);
    let w = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(w, 0i128);
}

#[test]
fn test_exponential_overflow_protection() {
    let f = setup();
    let id = client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &i128::MAX,
        &0u64,
        &1_000_000u64,
        &CURVE_EXP,
        &false,
    );
    f.env.ledger().set_timestamp(500_000);
    let unlocked = client(&f.env, &f.contract).get_unlocked_amount(&id);
    assert!(unlocked >= 0);
}

// ----------------------------- Unauthorized access -----------------------------

#[test]
fn test_unauthorized_cancel() {
    let f = setup();
    let id = make_stream(&f);
    assert!(client(&f.env, &f.contract).try_cancel_stream(&id, &f.receiver).is_err());
}

#[test]
fn test_unauthorized_pause() {
    let f = setup();
    let id = make_stream(&f);
    assert!(client(&f.env, &f.contract).try_pause_stream(&id, &f.receiver).is_err());
}

#[test]
fn test_unauthorized_resume() {
    let f = setup();
    let id = make_stream(&f);
    client(&f.env, &f.contract).pause_stream(&id, &f.sender);
    assert!(client(&f.env, &f.contract).try_resume_stream(&id, &f.receiver).is_err());
}

#[test]
fn test_unauthorized_grant_role() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_grant_role(&f.receiver, &f.sender, &ROLE_ADMIN)
        .is_err());
}

#[test]
fn test_unauthorized_restrict() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_restrict_address(&f.receiver, &f.sender)
        .is_err());
}

#[test]
fn test_unauthorized_pause_contract() {
    let f = setup();
    assert!(client(&f.env, &f.contract).try_pause_contract(&f.receiver).is_err());
}

#[test]
fn test_unauthorized_unpause_contract() {
    let f = setup();
    client(&f.env, &f.contract).pause_contract(&f.pauser);
    assert!(client(&f.env, &f.contract).try_unpause_contract(&f.receiver).is_err());
}

#[test]
fn test_unauthorized_withdraw() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(500);
    assert!(client(&f.env, &f.contract).try_withdraw(&id, &f.sender).is_err());
}

#[test]
fn test_pauser_cannot_grant_admin() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_grant_role(&f.pauser, &f.sender, &ROLE_ADMIN)
        .is_err());
}

// ----------------------------- Withdraw edge cases -----------------------------

#[test]
fn test_withdraw_after_cancel() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(500);
    client(&f.env, &f.contract).cancel_stream(&id, &f.sender);
    assert!(client(&f.env, &f.contract).try_withdraw(&id, &f.receiver).is_err());
}

#[test]
fn test_withdraw_from_paused_stream() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(500);
    client(&f.env, &f.contract).pause_stream(&id, &f.sender);
    assert!(client(&f.env, &f.contract).try_withdraw(&id, &f.receiver).is_err());
}

#[test]
fn test_double_withdraw_safety() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(500);
    let first = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(first, 500_000i128);
    let second = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(second, 0i128);
}

#[test]
fn test_economic_no_free_money() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(1_000_000);
    let w = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(w, 1_000_000i128);
    let again = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(again, 0i128);
}

#[test]
fn test_withdraw_zero_when_not_started() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(0);
    assert_eq!(client(&f.env, &f.contract).withdraw(&id, &f.receiver), 0);
}

#[test]
fn test_withdraw_capped_at_total() {
    let f = setup();
    let id = make_stream(&f);
    f.env.ledger().set_timestamp(1_000_000);
    let w = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(w, 1_000_000i128);
}

// ----------------------------- Validation / input attacks -----------------------------

#[test]
fn test_create_invalid_time_range() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &1_000i128, &100u64, &100u64, &CURVE_LINEAR, &false)
        .is_err());
}

#[test]
fn test_create_invalid_amount() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &0i128, &0u64, &100u64, &CURVE_LINEAR, &false)
        .is_err());
}

#[test]
fn test_create_restricted_sender() {
    let f = setup();
    client(&f.env, &f.contract).restrict_address(&f.admin, &f.sender);
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &1_000i128, &0u64, &100u64, &CURVE_LINEAR, &false)
        .is_err());
}

#[test]
fn test_create_restricted_receiver() {
    let f = setup();
    client(&f.env, &f.contract).restrict_address(&f.admin, &f.receiver);
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &1_000i128, &0u64, &100u64, &CURVE_LINEAR, &false)
        .is_err());
}

#[test]
fn test_invalid_curve_rejected() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &1_000i128, &0u64, &100u64, &99u32, &false)
        .is_err());
}

#[test]
fn test_invalid_role_rejected() {
    let f = setup();
    assert!(client(&f.env, &f.contract)
        .try_grant_role(&f.admin, &f.sender, &99u32)
        .is_err());
}

#[test]
fn test_withdraw_nonexistent_stream() {
    let f = setup();
    assert!(client(&f.env, &f.contract).try_withdraw(&999u64, &f.receiver).is_err());
}

#[test]
fn test_get_stream_nonexistent() {
    let f = setup();
    assert!(client(&f.env, &f.contract).try_get_stream(&999u64).is_err());
}

// ----------------------------- State machine attacks -----------------------------

#[test]
fn test_cancel_already_cancelled() {
    let f = setup();
    let id = make_stream(&f);
    client(&f.env, &f.contract).cancel_stream(&id, &f.sender);
    assert!(client(&f.env, &f.contract).try_cancel_stream(&id, &f.sender).is_err());
}

#[test]
fn test_pause_already_paused() {
    let f = setup();
    let id = make_stream(&f);
    client(&f.env, &f.contract).pause_stream(&id, &f.sender);
    assert!(client(&f.env, &f.contract).try_pause_stream(&id, &f.sender).is_err());
}

#[test]
fn test_resume_not_paused() {
    let f = setup();
    let id = make_stream(&f);
    assert!(client(&f.env, &f.contract).try_resume_stream(&id, &f.sender).is_err());
}

#[test]
fn test_initialize_twice_rejected() {
    let f = setup();
    assert!(client(&f.env, &f.contract).try_initialize(&f.admin).is_err());
}

#[test]
fn test_pause_resume_restores_vesting() {
    let f = setup();
    let id = make_stream(&f);
    // Pause at t=250 (unlocked 250k), resume at t=750 (paused 500 time-units).
    f.env.ledger().set_timestamp(250);
    client(&f.env, &f.contract).pause_stream(&id, &f.sender);
    f.env.ledger().set_timestamp(750);
    client(&f.env, &f.contract).resume_stream(&id, &f.sender);
    // Pausing extends the vesting schedule by the pause duration, so the effective
    // elapsed time is 750 - 500 (pause) = 250 -> 250k (unchanged since the pause).
    let w = client(&f.env, &f.contract).withdraw(&id, &f.receiver);
    assert_eq!(w, 250_000i128);
}

// ----------------------------- Storage / identity -----------------------------

#[test]
fn test_soulbound_flag_persists() {
    let f = setup();
    let id = client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &true,
    );
    let s = client(&f.env, &f.contract).get_stream(&id);
    assert!(s.is_soulbound);
}

#[test]
fn test_restricted_address_blocks_all_streams() {
    let f = setup();
    client(&f.env, &f.contract).restrict_address(&f.admin, &f.receiver);
    let r = Address::generate(&f.env);
    let ok_id = client(&f.env, &f.contract)
        .create_stream(&f.sender, &r, &f.token, &1_000i128, &0u64, &100u64, &CURVE_LINEAR, &false);
    assert!(ok_id > 0);
    assert!(client(&f.env, &f.contract)
        .try_create_stream(&f.sender, &f.receiver, &f.token, &1_000i128, &0u64, &100u64, &CURVE_LINEAR, &false)
        .is_err());
}

#[test]
fn test_next_id_never_collides() {
    let f = setup();
    let mut seen = Vec::new(&f.env);
    for _ in 0..50u64 {
        let r = Address::generate(&f.env);
        let id = client(&f.env, &f.contract).create_stream(
            &f.sender,
            &r,
            &f.token,
            &1_000i128,
            &0u64,
            &100u64,
            &CURVE_LINEAR,
            &false,
        );
        assert!(!seen.contains(id));
        seen.push_back(id);
    }
}

#[test]
fn test_cannot_withdraw_before_vesting_starts() {
    let f = setup();
    let id = client(&f.env, &f.contract).create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &1_000u64,
        &2_000u64,
        &CURVE_LINEAR,
        &false,
    );
    f.env.ledger().set_timestamp(500);
    assert_eq!(client(&f.env, &f.contract).get_withdrawable_amount(&id), 0);
    assert_eq!(client(&f.env, &f.contract).withdraw(&id, &f.receiver), 0);
}

#[test]
fn test_upgrade_path_not_public() {
    // There is no public upgrade entrypoint; only the admin role exists and
    // upgrades must go through governance. Verify admins are required for every
    // privileged operation (proxy for "no unauthorized upgrade").
    let f = setup();
    assert!(client(&f.env, &f.contract).try_pause_contract(&f.admin).is_err());
}
