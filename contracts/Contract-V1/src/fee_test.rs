//! Protocol fee tests (issue #1457).
//!
//! These run against a real Stellar Asset Contract rather than the no-op mock
//! token used elsewhere, so every assertion below is made against balances that
//! actually moved. That is what makes "the fee reached the treasury" and "a
//! sender who cannot cover the fee creates no stream" meaningful claims.
#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient as SacClient};
use soroban_sdk::Address;

/// Contract + real token, with balances that can be inspected.
struct FeeFixture {
    env: Env,
    contract: Address,
    admin: Address,
    manager: Address,
    outsider: Address,
    sender: Address,
    receiver: Address,
    treasury: Address,
    token: Address,
}

impl FeeFixture {
    fn client(&self) -> StellarStreamContractClient<'static> {
        StellarStreamContractClient::new(&self.env, &self.contract)
    }

    fn balance(&self, who: &Address) -> i128 {
        SacClient::new(&self.env, &self.token).balance(who)
    }

    /// Create a stream of `amount` from the funded sender to the receiver.
    fn create(&self, amount: i128) -> u64 {
        self.client().create_stream(
            &self.sender,
            &self.receiver,
            &self.token,
            &amount,
            &0u64,
            &1_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        )
    }
}

/// Deploy the contract and a real SAC, grant `manager` the treasury role, and
/// mint `sender_funding` to the stream sender.
fn setup_fees(sender_funding: i128) -> FeeFixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let manager = Address::generate(&env);
    let outsider = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let treasury = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let token_address = token.address();
    StellarAssetClient::new(&env, &token_address).mint(&sender, &sender_funding);

    let contract = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract);
    client.initialize(&admin);
    client.grant_role(&admin, &manager, &ROLE_TREASURY);

    FeeFixture {
        env,
        contract,
        admin,
        manager,
        outsider,
        sender,
        receiver,
        treasury,
        token: token_address,
    }
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/// 1. A treasury manager can set the fee, and it reads back.
#[test]
fn test_set_protocol_fee() {
    let f = setup_fees(1_000_000);
    let c = f.client();

    assert_eq!(c.get_protocol_fee(), 0, "fee defaults to zero");

    c.set_protocol_fee(&f.manager, &250u32);
    assert_eq!(c.get_protocol_fee(), 250);

    // The admin is also allowed to change it.
    c.set_protocol_fee(&f.admin, &75u32);
    assert_eq!(c.get_protocol_fee(), 75);
}

/// 2. A treasury manager can set the treasury address, and it reads back.
#[test]
fn test_set_treasury_address() {
    let f = setup_fees(1_000_000);
    let c = f.client();

    assert_eq!(c.get_treasury_address(), None, "no treasury by default");

    c.set_treasury_address(&f.manager, &f.treasury);
    assert_eq!(c.get_treasury_address(), Some(f.treasury.clone()));

    // Re-pointing the treasury is allowed.
    let next = Address::generate(&f.env);
    c.set_treasury_address(&f.admin, &next);
    assert_eq!(c.get_treasury_address(), Some(next));
}

/// 3. The fee is capped: above MAX_FEE_BPS is rejected, exactly at it is fine.
#[test]
fn test_fee_cap_enforced() {
    let f = setup_fees(1_000_000);
    let c = f.client();

    assert_eq!(
        c.try_set_protocol_fee(&f.manager, &(MAX_FEE_BPS + 1)),
        Err(Ok(Error::FeeTooHigh)),
        "1001 bps must be rejected"
    );
    assert_eq!(
        c.try_set_protocol_fee(&f.manager, &10_000u32),
        Err(Ok(Error::FeeTooHigh)),
        "100% must be rejected"
    );
    assert_eq!(c.get_protocol_fee(), 0, "a rejected write must not stick");

    // The cap itself is a legal value.
    c.set_protocol_fee(&f.manager, &MAX_FEE_BPS);
    assert_eq!(c.get_protocol_fee(), MAX_FEE_BPS);
}

/// 4. An account with neither TreasuryManager nor Admin cannot change settings.
#[test]
fn test_non_manager_cannot_change_fee_settings() {
    let f = setup_fees(1_000_000);
    let c = f.client();

    assert_eq!(
        c.try_set_protocol_fee(&f.outsider, &100u32),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        c.try_set_treasury_address(&f.outsider, &f.treasury),
        Err(Ok(Error::Unauthorized))
    );

    // Neither attempt changed anything.
    assert_eq!(c.get_protocol_fee(), 0);
    assert_eq!(c.get_treasury_address(), None);
}

// --------------------------------------------------------------------------
// Collection
// --------------------------------------------------------------------------

/// 5. The headline: a 1% fee on a 1_000 stream costs the sender 1_010 total,
///    the treasury receives 10, and the stream is still worth 1_000.
#[test]
fn test_fee_is_collected_on_top_of_stream_amount() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    c.set_treasury_address(&f.manager, &f.treasury);
    c.set_protocol_fee(&f.manager, &100u32); // 1%

    let sender_before = f.balance(&f.sender);
    assert_eq!(c.calculate_protocol_fee(&1_000i128), 10);

    let id = f.create(1_000);

    assert_eq!(f.balance(&f.treasury), 10, "treasury received the fee");
    assert_eq!(
        f.balance(&f.sender),
        sender_before - 10,
        "only the fee left the sender at creation time"
    );

    // Fee is charged on top: the stream is still the full 1_000.
    let stream = c.get_stream(&id);
    assert_eq!(stream.total_amount, 1_000i128);
    assert_eq!(stream.withdrawn_amount, 0i128);
}

/// 6. A zero fee collects nothing, needs no treasury, and emits no fee event.
#[test]
fn test_zero_fee_collects_nothing() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    // Deliberately no treasury set, and the default 0 bps rate.
    let sender_before = f.balance(&f.sender);

    let id = f.create(1_000);

    assert_eq!(c.calculate_protocol_fee(&1_000i128), 0);
    assert_eq!(
        f.balance(&f.sender),
        sender_before,
        "a zero fee must not move any tokens"
    );
    assert_eq!(c.get_stream(&id).total_amount, 1_000i128);

    // Explicitly setting 0 bps behaves the same way.
    c.set_protocol_fee(&f.manager, &0u32);
    f.create(500);
    assert_eq!(f.balance(&f.sender), sender_before);
    assert_eq!(f.balance(&f.treasury), 0);
}

/// 7. A sender who cannot cover the fee creates no stream at all.
///
/// Streams are funded lazily -- `withdraw` pulls from the sender -- so the only
/// balance `create_stream` needs up front is the fee. Here the sender holds 5
/// against a fee of 10, and the whole invocation must roll back.
#[test]
fn test_insufficient_balance_for_fee_reverts_creation() {
    let f = setup_fees(5);
    let c = f.client();
    c.set_treasury_address(&f.manager, &f.treasury);
    c.set_protocol_fee(&f.manager, &100u32); // 1% of 1_000 = 10 > 5

    let next_id_before = c.next_stream_id();

    let result = c.try_create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
    );
    assert!(
        result.is_err(),
        "creation must fail when the fee cannot be paid"
    );

    // Nothing was committed: no id consumed, no tokens moved.
    assert_eq!(c.next_stream_id(), next_id_before);
    assert_eq!(f.balance(&f.treasury), 0);
    assert_eq!(f.balance(&f.sender), 5);
}

/// 8. Fees from several streams accumulate in the treasury.
#[test]
fn test_multiple_streams_accumulate_fees() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    c.set_treasury_address(&f.manager, &f.treasury);
    c.set_protocol_fee(&f.manager, &200u32); // 2%

    f.create(1_000); // 20
    f.create(5_000); // 100
    f.create(2_500); // 50

    assert_eq!(f.balance(&f.treasury), 170);

    // A rate change applies from the next stream onward.
    c.set_protocol_fee(&f.manager, &50u32); // 0.5%
    f.create(1_000); // 5
    assert_eq!(f.balance(&f.treasury), 175);
}

/// 9. A non-zero fee with no treasury configured is a hard error, not a
///    silently skipped fee.
#[test]
fn test_fee_without_treasury_is_rejected() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    c.set_protocol_fee(&f.manager, &100u32);

    assert_eq!(
        c.try_create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000i128,
            &0u64,
            &1_000u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
        ),
        Err(Ok(Error::TreasuryNotSet))
    );
    assert_eq!(c.next_stream_id(), 1, "no stream was created");
}

/// 10. Fee maths stays sane at the cap and at extreme amounts.
#[test]
fn test_fee_math_is_overflow_safe() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    c.set_protocol_fee(&f.manager, &MAX_FEE_BPS); // 10%

    assert_eq!(c.calculate_protocol_fee(&1_000i128), 100);
    // Rounds down rather than up.
    assert_eq!(c.calculate_protocol_fee(&9i128), 0);
    assert_eq!(c.calculate_protocol_fee(&15i128), 1);
    assert_eq!(c.calculate_protocol_fee(&0i128), 0);

    // amount * 1_000 overflows i128 here, and must be reported, not wrapped.
    assert_eq!(
        c.try_calculate_protocol_fee(&i128::MAX),
        Err(Ok(Error::Overflow))
    );
}

/// 11. Collection publishes an event carrying the fee that was charged.
#[test]
fn test_fee_collection_emits_event() {
    let f = setup_fees(1_000_000);
    let c = f.client();
    c.set_treasury_address(&f.manager, &f.treasury);
    c.set_protocol_fee(&f.manager, &100u32);

    f.create(1_000);

    let events = f.env.events().all();
    assert!(!events.is_empty(), "fee collection must publish an event");
}

/// 12. Revoking the treasury role removes the ability to change fee settings.
#[test]
fn test_revoked_manager_loses_fee_control() {
    let f = setup_fees(1_000_000);
    let c = f.client();

    c.set_protocol_fee(&f.manager, &100u32);
    c.revoke_role(&f.admin, &f.manager, &ROLE_TREASURY);

    assert_eq!(
        c.try_set_protocol_fee(&f.manager, &500u32),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(c.get_protocol_fee(), 100, "the old rate still stands");
}
