#![cfg(test)]
//! Integration tests for yield-bearing vault integration.
//!
//! Streams can be backed by an external vault. When a stream is created with a
//! vault address, the principal is deposited into the vault and the stream
//! records the vault address plus the deposited principal. The vault itself
//! implements the standard `VaultInterface` (`deposit`/`withdraw`/`get_value`)
//! exposed in [`crate::vault`].
//!
//! # Scenarios covered
//!
//! - Recording the vault address and deposited principal on a vault-backed stream.
//! - Moving principal out of the stream contract and into the vault.
//! - Accumulating deposits from multiple streams into a shared vault.
//! - Validation failures (zero amount, invalid time range) before any deposit.
//! - The mock vault's deposit/withdraw/value accounting and the direct
//!   `deposit_to_vault` helper.
//!
//! Note: withdrawing principal *back out* of a vault is not yet wired into the
//! stream contract's `withdraw`/`cancel` paths, so those flows are out of scope
//! here and are exercised only through the vault module directly.

use crate::types::{CurveType, StreamOptions, StreamState};
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Vec};

/// A minimal vault that implements the `VaultInterface` contract with 1:1
/// shares and a simple tracked balance.
#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn deposit(env: Env, _from: Address, amount: i128) -> i128 {
        let bal: i128 = env
            .storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or(0);
        env.storage().instance().set(&symbol_short!("bal"), &(bal + amount));
        amount
    }

    pub fn withdraw(env: Env, _to: Address, shares: i128) -> i128 {
        let bal: i128 = env
            .storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or(0);
        env.storage().instance().set(&symbol_short!("bal"), &(bal - shares));
        shares
    }

    pub fn get_value(_env: Env, shares: i128) -> i128 {
        shares
    }

    pub fn get_balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&symbol_short!("bal"))
            .unwrap_or(0)
    }
}

type Setup = (
    Env,
    StellarStreamContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    MockVaultClient<'static>,
);

/// Deploy the stream contract, a token (minting 10,000 to `sender`) and a
/// mock vault. Returns `(env, client, sender, receiver, token, vault, vault_client)`.
fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&sender, &10_000);

    let vault = env.register(MockVault, ());
    let vault_client = MockVaultClient::new(&env, &vault);

    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);

    (env, client, sender, receiver, token, vault, vault_client)
}

fn options_with_vault(vault: Address) -> StreamOptions {
    StreamOptions {
        curve_type: CurveType::Linear,
        is_soulbound: false,
        vault_address: Some(vault),
    }
}

fn create_vault_stream(
    client: &StellarStreamContractClient,
    env: &Env,
    sender: &Address,
    receiver: &Address,
    token: &Address,
    amount: i128,
    vault: &Address,
) -> u64 {
    let milestones = Vec::new(env);
    let options = options_with_vault(vault.clone());
    client.create_stream_with_milestones(
        sender,
        receiver,
        token,
        &amount,
        &100,
        &100,
        &200,
        &milestones,
        &options,
    )
}

#[test]
fn test_create_stream_with_vault_records_vault_address() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let stream_id = create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.vault_address, Some(vault));
}

#[test]
fn test_create_stream_without_vault_has_no_vault() {
    let (_env, client, sender, receiver, token, _vault, _vc) = setup();

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000,
        &100,
        &100,
        &200,
        &CurveType::Linear,
        &false,
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.vault_address, None);
}

#[test]
fn test_vault_stream_deposits_principal_to_vault() {
    let (env, client, sender, receiver, token, vault, vault_client) = setup();
    create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    assert_eq!(vault_client.get_balance(), 1000);
}

#[test]
fn test_vault_stream_records_deposited_principal() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let stream_id = create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.deposited_principal, 1000);
}

#[test]
fn test_vault_stream_moves_tokens_out_of_contract() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&client.address), 0);
}

#[test]
fn test_vault_stream_reduces_sender_balance() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 9000);
}

#[test]
fn test_two_streams_share_vault_accumulate_balance() {
    let (env, client, sender, receiver, token, vault, vault_client) = setup();
    let receiver2 = Address::generate(&env);

    create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);
    create_vault_stream(&client, &env, &sender, &receiver2, &token, 1000, &vault);

    assert_eq!(vault_client.get_balance(), 2000);
}

#[test]
fn test_vault_stream_state_is_active() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let stream_id = create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, StreamState::Active);
}

#[test]
fn test_vault_stream_receipt_is_minted() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let stream_id = create_vault_stream(&client, &env, &sender, &receiver, &token, 1000, &vault);

    let receipt = client.get_receipt(&stream_id).unwrap();
    assert_eq!(receipt.stream_id, stream_id);
    assert_eq!(receipt.owner, receiver);
}

#[test]
fn test_create_vault_stream_with_zero_amount_fails() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let milestones = Vec::new(&env);
    let options = options_with_vault(vault);

    let result = client.try_create_stream_with_milestones(
        &sender,
        &receiver,
        &token,
        &0,
        &100,
        &100,
        &200,
        &milestones,
        &options,
    );

    assert_eq!(result, Err(Ok(crate::errors::Error::InvalidAmount)));
}

#[test]
fn test_create_vault_stream_with_invalid_time_range_fails() {
    let (env, client, sender, receiver, token, vault, _vc) = setup();
    let milestones = Vec::new(&env);
    let options = options_with_vault(vault);

    let result = client.try_create_stream_with_milestones(
        &sender,
        &receiver,
        &token,
        &1000,
        &200,
        &100,
        &200,
        &milestones,
        &options,
    );

    assert_eq!(result, Err(Ok(crate::errors::Error::InvalidTimeRange)));
}

#[test]
fn test_mock_vault_deposit_tracks_balance() {
    let (_env, _client, sender, _receiver, _token, _vault, vault_client) = setup();

    let shares = vault_client.deposit(&sender, &500);
    assert_eq!(shares, 500);
    assert_eq!(vault_client.get_balance(), 500);
}

#[test]
fn test_mock_vault_withdraw_reduces_balance() {
    let (_env, _client, sender, _receiver, _token, _vault, vault_client) = setup();

    vault_client.deposit(&sender, &500);
    let withdrawn = vault_client.withdraw(&sender, &200);

    assert_eq!(withdrawn, 200);
    assert_eq!(vault_client.get_balance(), 300);
}

#[test]
fn test_mock_vault_get_value_is_identity() {
    let (_env, _client, _sender, _receiver, _token, _vault, vault_client) = setup();

    assert_eq!(vault_client.get_value(&750), 750);
}

#[test]
fn test_deposit_to_vault_helper_returns_shares() {
    let (env, client, _sender, _receiver, token, vault, vault_client) = setup();

    // Fund the stream contract directly so the helper can transfer to the vault.
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&client.address, &500);

    let shares = env.as_contract(&client.address, || {
        crate::vault::deposit_to_vault(&env, &vault, &token, 500)
    });

    assert_eq!(shares, Ok(500));
    assert_eq!(vault_client.get_balance(), 500);
}
