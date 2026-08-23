#![cfg(test)]
//! Comprehensive test suite for the core stream-lifecycle functions:
//! `initialize`, `create_stream` (and `create_stream_with_milestones`),
//! `withdraw`, `cancel` (and the `cancel_stream` bridge-migration variant),
//! and `pause_stream`/`resume_stream`.
//!
//! Other features of the contract (RBAC, OFAC compliance, multi-sig
//! proposals, vaults, soulbound streams, batch operations, top-ups, flash
//! loans, voting, upgrades) already have their own dedicated test files
//! (`rbac_test.rs`, `compliance_test.rs`, `proposal_test.rs`, `vault_test.rs`,
//! `soulbound_test.rs`, `advanced_test.rs`, `bench_test.rs`, `topup_test.rs`,
//! `cliff_test.rs`, `pause_resume_test.rs`, `stream_active_test.rs`,
//! `remaining_time_test.rs`, `ttl_stress_test.rs`) and are not duplicated
//! here. This file is organized into one `mod` per test category, matching
//! the six core functions plus two cross-cutting categories:
//!
//! - [`initialization`]: `initialize` sets the admin and grants roles.
//! - [`stream_creation`]: `create_stream` / `create_stream_with_milestones`
//!   success paths, validation errors, and boundary conditions.
//! - [`withdrawal`]: `withdraw` success paths, vesting-curve math, and every
//!   way it can fail.
//! - [`cancellation`]: `cancel` and `cancel_stream` pro-rata splits and
//!   failure modes.
//! - [`pause_resume`]: `pause_stream` / `resume_stream` state transitions and
//!   their effect on vesting math (pause shifts the cliff and end time).
//! - [`error_conditions`]: a focused, one-assertion-per-case catalog sweeping
//!   every `Error` variant reachable from the six core functions, for use as
//!   a quick reference independent of the richer scenario tests above.
//! - [`integration`]: multi-step chains exercising two or more core
//!   functions together (create -> withdraw -> pause -> resume -> cancel,
//!   soulbound and vault-backed lifecycles, etc.).
//!
//! `support` holds the shared test harness: contract/token setup and small
//! helpers for creating streams and advancing the ledger clock, used by
//! every category to avoid duplicating boilerplate.

mod support {
    use crate::{StellarStreamContract, StellarStreamContractClient};
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Address, Env};

    /// Shared test context: a deployed contract, its token, and the three
    /// addresses (admin, sender, receiver) most tests need.
    pub struct TestCtx {
        pub env: Env,
        pub client: StellarStreamContractClient<'static>,
        pub admin: Address,
        pub sender: Address,
        pub receiver: Address,
        pub token: Address,
    }

    /// Deploys the contract and a token (minting 1,000,000 to `sender`), but
    /// does *not* call `initialize`. Use this for [`super::initialization`]
    /// tests that need to observe pre-initialization state.
    pub fn setup_uninitialized() -> TestCtx {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);

        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        StellarAssetClient::new(&env, &token).mint(&sender, &1_000_000);

        TestCtx {
            env,
            client,
            admin,
            sender,
            receiver,
            token,
        }
    }

    /// Like [`setup_uninitialized`], but also calls `initialize(admin)`.
    /// This is what every category other than `initialization` should use.
    pub fn setup() -> TestCtx {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        ctx
    }

    /// Advances the ledger clock to `t`.
    pub fn set_time(env: &Env, t: u64) {
        env.ledger().with_mut(|li| li.timestamp = t);
    }

    impl TestCtx {
        /// Creates a stream with round, easy-to-check numbers: 1000 units
        /// vesting linearly from t=1000 to t=2000 (no cliff delay), from
        /// `sender` to `receiver`. At time `t` in `(1000, 2000)`, the
        /// unlocked amount is exactly `t - 1000`.
        pub fn create_default_stream(&self) -> u64 {
            self.client.create_stream(
                &self.sender,
                &self.receiver,
                &self.token,
                &1000,
                &1000,
                &1000,
                &2000,
                &crate::types::CurveType::Linear,
                &false,
            )
        }
    }
}

/// `initialize`: sets the admin and grants it every role.
mod initialization {
    use super::support::*;
    use crate::rbac::Role;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Address;

    #[test]
    fn initialize_sets_admin() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        assert_eq!(ctx.client.get_admin(), ctx.admin);
    }

    #[test]
    fn initialize_grants_super_admin_role() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        assert!(ctx.client.check_role(&ctx.admin, &Role::SuperAdmin));
    }

    #[test]
    fn initialize_grants_guardian_role() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        assert!(ctx.client.check_role(&ctx.admin, &Role::Guardian));
    }

    #[test]
    fn initialize_grants_financial_operator_role() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        assert!(ctx.client.check_role(&ctx.admin, &Role::FinancialOperator));
    }

    #[test]
    fn initialize_does_not_grant_roles_to_unrelated_addresses() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        let stranger = Address::generate(&ctx.env);
        assert!(!ctx.client.check_role(&stranger, &Role::SuperAdmin));
        assert!(!ctx.client.check_role(&stranger, &Role::Guardian));
        assert!(!ctx.client.check_role(&stranger, &Role::FinancialOperator));
    }

    #[test]
    #[should_panic(expected = "Admin not set")]
    fn get_admin_before_initialize_panics() {
        let ctx = setup_uninitialized();
        ctx.client.get_admin();
    }

    /// `initialize` has no re-initialization guard (the `AlreadyInitialized`
    /// error variant exists but is never returned by any function): calling
    /// it a second time simply overwrites the admin and re-grants roles to
    /// the new admin. This documents that actual behavior.
    #[test]
    fn reinitialize_overwrites_admin_with_new_address() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);

        let new_admin = Address::generate(&ctx.env);
        ctx.client.initialize(&new_admin);

        assert_eq!(ctx.client.get_admin(), new_admin);
        assert!(ctx.client.check_role(&new_admin, &Role::SuperAdmin));
    }

    #[test]
    fn check_role_returns_false_for_unknown_address_and_role_combination() {
        let ctx = setup_uninitialized();
        ctx.client.initialize(&ctx.admin);
        // The admin was never granted anything beyond the three roles
        // `initialize` grants; nothing else should report true.
        let stranger = Address::generate(&ctx.env);
        assert!(!ctx.client.check_role(&stranger, &Role::FinancialOperator));
    }
}

/// `create_stream` / `create_stream_with_milestones`: success paths,
/// validation errors, and boundary conditions.
mod stream_creation {
    use super::support::*;
    use crate::errors::Error;
    use crate::types::{CurveType, Milestone, StreamOptions, StreamState};
    use soroban_sdk::testutils::Events;
    use soroban_sdk::token::TokenClient;
    use soroban_sdk::Vec;

    #[test]
    fn create_stream_linear_success_records_all_fields() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let stream = ctx.client.get_stream(&id);

        assert_eq!(stream.sender, ctx.sender);
        assert_eq!(stream.receiver, ctx.receiver);
        assert_eq!(stream.token, ctx.token);
        assert_eq!(stream.total_amount, 1000);
        assert_eq!(stream.start_time, 1000);
        assert_eq!(stream.cliff_time, 1000);
        assert_eq!(stream.end_time, 2000);
        assert_eq!(stream.curve_type, CurveType::Linear);
        assert_eq!(stream.withdrawn_amount, 0);
        assert_eq!(stream.state, StreamState::Active);
        assert!(!stream.is_soulbound);
    }

    #[test]
    fn create_stream_exponential_success() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Exponential,
            &false,
        );
        assert_eq!(
            ctx.client.get_stream(&id).curve_type,
            CurveType::Exponential
        );
    }

    #[test]
    fn create_stream_soulbound_flag_is_recorded() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &true,
        );
        assert!(ctx.client.get_stream(&id).is_soulbound);
    }

    #[test]
    fn create_stream_ids_increment_sequentially() {
        let ctx = setup();
        let first = ctx.create_default_stream();
        let second = ctx.create_default_stream();
        assert_eq!(first, 0);
        assert_eq!(second, 1);
    }

    #[test]
    fn create_stream_transfers_principal_from_sender_to_contract() {
        let ctx = setup();
        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        let sender_balance_before = token_client.balance(&ctx.sender);

        ctx.create_default_stream();

        assert_eq!(
            token_client.balance(&ctx.sender),
            sender_balance_before - 1000
        );
    }

    #[test]
    fn create_stream_zero_amount_fails() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &0,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn create_stream_negative_amount_fails() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &-1,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn create_stream_start_equal_end_fails() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &1000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidTimeRange)));
    }

    #[test]
    fn create_stream_start_after_end_fails() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &2000,
            &2000,
            &1000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidTimeRange)));
    }

    #[test]
    #[should_panic(expected = "Cliff time must be between start and end time")]
    fn create_stream_cliff_before_start_panics() {
        let ctx = setup();
        ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &500,
            &2000,
            &CurveType::Linear,
            &false,
        );
    }

    #[test]
    #[should_panic(expected = "Cliff time must be between start and end time")]
    fn create_stream_cliff_after_end_panics() {
        let ctx = setup();
        ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &2500,
            &2000,
            &CurveType::Linear,
            &false,
        );
    }

    #[test]
    fn create_stream_cliff_equal_to_start_succeeds() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        assert_eq!(ctx.client.get_stream(&id).cliff_time, 1000);
    }

    #[test]
    fn create_stream_cliff_equal_to_end_succeeds() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &2000,
            &2000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(ctx.client.get_stream(&id).cliff_time, 2000);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #23)")]
    fn create_stream_to_restricted_receiver_panics() {
        let ctx = setup();
        ctx.client.restrict_address(&ctx.admin, &ctx.receiver);
        ctx.create_default_stream();
    }

    #[test]
    fn create_stream_with_milestones_success() {
        let ctx = setup();
        let milestones: Vec<Milestone> = Vec::new(&ctx.env);
        let options = StreamOptions {
            curve_type: CurveType::Linear,
            is_soulbound: false,
            vault_address: None,
        };
        let id = ctx.client.create_stream_with_milestones(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &milestones,
            &options,
        );
        assert_eq!(ctx.client.get_stream(&id).total_amount, 1000);
    }

    #[test]
    fn create_stream_large_amount_boundary_succeeds() {
        let ctx = setup();
        let large_amount: i128 = 1_000_000_000_000_000_000;
        // Mint enough for this specific test's sender balance.
        soroban_sdk::token::StellarAssetClient::new(&ctx.env, &ctx.token)
            .mint(&ctx.sender, &large_amount);

        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &large_amount,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(ctx.client.get_stream(&id).total_amount, large_amount);
    }

    #[test]
    fn create_stream_start_time_zero_succeeds() {
        let ctx = setup();
        set_time(&ctx.env, 0);
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &0,
            &0,
            &1000,
            &CurveType::Linear,
            &false,
        );
        assert_eq!(ctx.client.get_stream(&id).start_time, 0);
    }

    #[test]
    fn create_stream_emits_stream_created_event() {
        let ctx = setup();
        ctx.create_default_stream();
        let events = ctx.env.events().all();
        assert!(
            !events.is_empty(),
            "expected at least one event to be published by create_stream"
        );
    }

    #[test]
    fn create_multiple_streams_between_same_sender_and_receiver_are_independent() {
        let ctx = setup();
        let first = ctx.create_default_stream();
        let second = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &500,
            &1000,
            &1000,
            &1500,
            &CurveType::Linear,
            &false,
        );

        assert_ne!(first, second);
        assert_eq!(ctx.client.get_stream(&first).total_amount, 1000);
        assert_eq!(ctx.client.get_stream(&second).total_amount, 500);
    }
}

/// `withdraw`: success paths, vesting-curve math, and every failure mode.
mod withdrawal {
    use super::support::*;
    use crate::errors::Error;
    use crate::types::{CurveType, StreamState};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::TokenClient;
    use soroban_sdk::Address;

    #[test]
    fn withdraw_full_amount_at_end_time() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 1000);
    }

    #[test]
    fn withdraw_partial_amount_mid_stream() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 500);
    }

    #[test]
    fn withdraw_before_start_time_fails_insufficient_withdrawable() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 500);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));
    }

    #[test]
    fn withdraw_exactly_at_start_time_fails_insufficient_withdrawable() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1000);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));
    }

    #[test]
    fn withdraw_before_cliff_fails_insufficient_withdrawable() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1200,
            &2000,
            &CurveType::Linear,
            &false,
        );
        set_time(&ctx.env, 1100);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));
    }

    #[test]
    fn withdraw_at_cliff_time_succeeds() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1200,
            &2000,
            &CurveType::Linear,
            &false,
        );
        set_time(&ctx.env, 1200);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        // Linear vesting: 1000 * (1200 - 1000) / (2000 - 1000) = 200.
        assert_eq!(withdrawn, 200);
    }

    #[test]
    fn withdraw_multiple_partial_withdrawals_accumulate() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1250);
        let first = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(first, 250);

        set_time(&ctx.env, 1600);
        let second = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(second, 350);

        assert_eq!(ctx.client.get_stream(&id).withdrawn_amount, 600);
    }

    #[test]
    fn withdraw_by_sender_fails_not_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        let result = ctx.client.try_withdraw(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::NotReceiver)));
    }

    #[test]
    fn withdraw_by_unrelated_stranger_fails_not_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let stranger = Address::generate(&ctx.env);
        set_time(&ctx.env, 1500);
        let result = ctx.client.try_withdraw(&id, &stranger);
        assert_eq!(result, Err(Ok(Error::NotReceiver)));
    }

    #[test]
    fn withdraw_unknown_stream_fails_not_found() {
        let ctx = setup();
        let result = ctx.client.try_withdraw(&999, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn withdraw_already_closed_stream_fails_already_cancelled() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        ctx.client.withdraw(&id, &ctx.receiver);

        // A second withdrawal after the stream auto-closed on full payout.
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn withdraw_paused_stream_fails_stream_paused() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.pause_stream(&id, &ctx.sender);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamPaused)));
    }

    #[test]
    fn withdraw_after_resume_uses_pause_adjusted_time() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1400);
        ctx.client.resume_stream(&id, &ctx.sender);

        // 200 units were paused, so at raw time 1500 only
        // (1500 - 1000) - 200 = 300 units have effectively vested.
        set_time(&ctx.env, 1500);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 300);
    }

    #[test]
    fn withdraw_nothing_new_available_fails_insufficient_withdrawable() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.withdraw(&id, &ctx.receiver);

        // Same timestamp, nothing new has vested since the last withdrawal.
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));
    }

    #[test]
    fn withdraw_updates_withdrawn_amount_field() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1300);
        ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(ctx.client.get_stream(&id).withdrawn_amount, 300);
    }

    #[test]
    fn withdraw_auto_closes_stream_when_fully_withdrawn() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn withdraw_does_not_auto_close_on_partial_withdrawal() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Active);
    }

    #[test]
    fn withdraw_transfers_correct_token_balance_to_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1750);
        ctx.client.withdraw(&id, &ctx.receiver);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 750);
    }

    #[test]
    fn withdraw_exponential_curve_partial() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Exponential,
            &false,
        );
        set_time(&ctx.env, 1500);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        // Exponential vesting at the midpoint is less than linear's 500,
        // but strictly more than zero.
        assert!(withdrawn > 0 && withdrawn < 500);
    }

    #[test]
    fn withdraw_after_cancel_fails_already_cancelled() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.cancel(&id, &ctx.sender);

        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn withdraw_by_new_receiver_after_transfer_succeeds() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let new_receiver = Address::generate(&ctx.env);
        ctx.client
            .transfer_receiver(&id, &ctx.sender, &new_receiver);

        set_time(&ctx.env, 1500);
        let withdrawn = ctx.client.withdraw(&id, &new_receiver);
        assert_eq!(withdrawn, 500);
    }

    #[test]
    fn withdraw_by_old_receiver_after_transfer_fails_not_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let new_receiver = Address::generate(&ctx.env);
        ctx.client
            .transfer_receiver(&id, &ctx.sender, &new_receiver);

        set_time(&ctx.env, 1500);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::NotReceiver)));
    }

    #[test]
    fn withdraw_never_exceeds_total_amount_far_past_end_time() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 50_000);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 1000);
    }

    #[test]
    fn withdraw_return_value_matches_stored_withdrawn_amount() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1400);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, ctx.client.get_stream(&id).withdrawn_amount);
    }

    #[test]
    fn withdraw_soulbound_stream_succeeds_normally() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &true,
        );
        set_time(&ctx.env, 2000);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 1000);
    }
}

/// `cancel` (pro-rata split between sender and receiver) and `cancel_stream`
/// (bridge-migration variant that pays the receiver the full remaining
/// balance regardless of vesting progress).
mod cancellation {
    use super::support::*;
    use crate::errors::Error;
    use crate::types::StreamState;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::TokenClient;
    use soroban_sdk::Address;

    #[test]
    fn cancel_before_any_vesting_returns_everything_to_sender() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1000);
        ctx.client.cancel(&id, &ctx.sender);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.sender), 1_000_000);
        assert_eq!(token_client.balance(&ctx.receiver), 0);
    }

    #[test]
    fn cancel_after_full_vesting_returns_everything_to_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        ctx.client.cancel(&id, &ctx.receiver);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 1000);
    }

    #[test]
    fn cancel_mid_stream_splits_pro_rata() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1400);
        ctx.client.cancel(&id, &ctx.sender);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        // 400 vested to the receiver, 600 returned to the sender.
        assert_eq!(token_client.balance(&ctx.receiver), 400);
        assert_eq!(token_client.balance(&ctx.sender), 1_000_000 - 1000 + 600);
    }

    #[test]
    fn cancel_after_partial_withdrawal_accounts_for_amount_already_paid() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1300);
        ctx.client.withdraw(&id, &ctx.receiver); // pays out 300

        set_time(&ctx.env, 1600);
        ctx.client.cancel(&id, &ctx.sender);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        // Total vested by t=1600 is 600; 300 was already withdrawn, so
        // cancel should pay the remaining 300 to the receiver and the
        // unvested 400 back to the sender.
        assert_eq!(token_client.balance(&ctx.receiver), 600);
        assert_eq!(token_client.balance(&ctx.sender), 1_000_000 - 1000 + 400);
    }

    #[test]
    fn cancel_sets_state_closed() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.cancel(&id, &ctx.sender);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn cancel_by_unrelated_third_party_fails_unauthorized() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let stranger = Address::generate(&ctx.env);
        let result = ctx.client.try_cancel(&id, &stranger);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn cancel_already_closed_stream_fails() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.cancel(&id, &ctx.sender);

        let result = ctx.client.try_cancel(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn cancel_unknown_stream_fails_not_found() {
        let ctx = setup();
        let result = ctx.client.try_cancel(&999, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn cancel_while_paused_still_succeeds() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1300);
        ctx.client.pause_stream(&id, &ctx.sender);

        // Unlike withdraw, cancel has no explicit Paused guard.
        let result = ctx.client.try_cancel(&id, &ctx.sender);
        assert!(result.is_ok());
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn cancel_by_receiver_is_also_allowed() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        let result = ctx.client.try_cancel(&id, &ctx.receiver);
        assert!(result.is_ok());
    }

    #[test]
    fn cancel_at_exact_start_skips_zero_amount_transfers_cleanly() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1000);
        // to_receiver is 0 here; this must not error or transfer anything.
        let result = ctx.client.try_cancel(&id, &ctx.sender);
        assert!(result.is_ok());

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 0);
    }

    #[test]
    fn cancel_stream_variant_pays_full_remaining_to_receiver() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1300); // only 300 has actually vested

        let remaining = ctx.client.cancel_stream(&id, &ctx.receiver);

        // Unlike `cancel`, `cancel_stream` pays the receiver the entire
        // remaining balance regardless of vesting progress.
        assert_eq!(remaining, 1000);
        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 1000);
    }

    #[test]
    fn cancel_stream_variant_by_sender_fails_unauthorized() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let result = ctx.client.try_cancel_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn cancel_stream_variant_unknown_stream_fails_not_found() {
        let ctx = setup();
        let result = ctx.client.try_cancel_stream(&999, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn cancel_stream_variant_after_full_withdrawal_fails_already_cancelled() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        ctx.client.withdraw(&id, &ctx.receiver); // auto-closes the stream

        let result = ctx.client.try_cancel_stream(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }
}

/// `pause_stream` / `resume_stream`: state transitions and their effect on
/// vesting math (a pause shifts both the cliff and the end time out by the
/// duration paused).
mod pause_resume {
    use super::support::*;
    use crate::errors::Error;
    use crate::types::CurveType;

    #[test]
    fn pause_when_already_paused_is_idempotent() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);
        let paused_time_first = ctx.client.get_stream(&id).paused_time;

        set_time(&ctx.env, 1300);
        let result = ctx.client.try_pause_stream(&id, &ctx.sender);
        assert!(result.is_ok());
        // The second pause call is a no-op: paused_time is not updated.
        assert_eq!(ctx.client.get_stream(&id).paused_time, paused_time_first);
    }

    #[test]
    fn resume_by_receiver_fails_unauthorized() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);

        let result = ctx.client.try_resume_stream(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn pause_unknown_stream_fails_not_found() {
        let ctx = setup();
        let result = ctx.client.try_pause_stream(&999, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn resume_unknown_stream_fails_not_found() {
        let ctx = setup();
        let result = ctx.client.try_resume_stream(&999, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn resume_updates_total_paused_duration_precisely() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1500);
        ctx.client.resume_stream(&id, &ctx.sender);

        assert_eq!(ctx.client.get_stream(&id).total_paused_duration, 300);
    }

    #[test]
    fn withdraw_amount_correct_after_pause_resume_cycle() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1100);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1350);
        ctx.client.resume_stream(&id, &ctx.sender);

        // 250 units were paused; at raw time 1600 the effective elapsed
        // time is (1600 - 1000) - 250 = 350.
        set_time(&ctx.env, 1600);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 350);
    }

    #[test]
    fn pause_before_cliff_shifts_the_effective_cliff_out() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1200,
            &2000,
            &CurveType::Linear,
            &false,
        );

        // Pause for 50 units before the original cliff at 1200.
        set_time(&ctx.env, 1100);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1150);
        ctx.client.resume_stream(&id, &ctx.sender);

        // The adjusted cliff is now 1200 + 50 = 1250, so withdrawing at the
        // original cliff time of 1200 must still fail.
        set_time(&ctx.env, 1200);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));

        // But it succeeds once past the adjusted cliff.
        set_time(&ctx.env, 1260);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert!(withdrawn > 0);
    }

    #[test]
    fn is_stream_active_false_while_paused() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);
        assert!(!ctx.client.is_stream_active(&id));
    }

    #[test]
    fn is_stream_active_true_while_active_and_before_end() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        assert!(ctx.client.is_stream_active(&id));
    }

    #[test]
    fn pause_resume_multiple_cycles_accumulate_duration() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1100);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1150); // 50 paused
        ctx.client.resume_stream(&id, &ctx.sender);

        set_time(&ctx.env, 1300);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1380); // 80 paused
        ctx.client.resume_stream(&id, &ctx.sender);

        assert_eq!(ctx.client.get_stream(&id).total_paused_duration, 130);
    }

    #[test]
    fn resume_closed_stream_fails_already_cancelled() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1200);
        ctx.client.pause_stream(&id, &ctx.sender);
        ctx.client.cancel(&id, &ctx.sender);

        let result = ctx.client.try_resume_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn pause_active_stream_sets_paused_time_to_current_timestamp() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1234);
        ctx.client.pause_stream(&id, &ctx.sender);
        assert_eq!(ctx.client.get_stream(&id).paused_time, 1234);
    }
}

/// A focused, one-assertion-per-case catalog sweeping every `Error` variant
/// reachable from the six core functions. This complements the richer
/// scenario tests in the categories above by serving as a quick reference:
/// each test here does the minimum setup needed to trigger exactly one
/// error and asserts on it directly.
mod error_conditions {
    use super::support::*;
    use crate::errors::Error;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Address;

    #[test]
    fn invalid_time_range_on_create() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &2000,
            &2000,
            &1000,
            &crate::types::CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidTimeRange)));
    }

    #[test]
    fn invalid_amount_zero_on_create() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &0,
            &1000,
            &1000,
            &2000,
            &crate::types::CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn invalid_amount_negative_on_create() {
        let ctx = setup();
        let result = ctx.client.try_create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &-500,
            &1000,
            &1000,
            &2000,
            &crate::types::CurveType::Linear,
            &false,
        );
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn stream_not_found_on_withdraw() {
        let ctx = setup();
        let result = ctx.client.try_withdraw(&42, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn not_receiver_on_withdraw() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        let result = ctx.client.try_withdraw(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::NotReceiver)));
    }

    #[test]
    fn already_cancelled_on_withdraw() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.cancel(&id, &ctx.sender);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn stream_paused_on_withdraw() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 1500);
        ctx.client.pause_stream(&id, &ctx.sender);
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamPaused)));
    }

    #[test]
    fn insufficient_withdrawable_on_withdraw() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        set_time(&ctx.env, 999); // before start_time
        let result = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::InsufficientWithdrawable)));
    }

    #[test]
    fn stream_not_found_on_cancel() {
        let ctx = setup();
        let result = ctx.client.try_cancel(&42, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn unauthorized_on_cancel() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let stranger = Address::generate(&ctx.env);
        let result = ctx.client.try_cancel(&id, &stranger);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn already_cancelled_on_cancel() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        ctx.client.cancel(&id, &ctx.sender);
        let result = ctx.client.try_cancel(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn stream_not_found_on_pause() {
        let ctx = setup();
        let result = ctx.client.try_pause_stream(&42, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn unauthorized_on_pause() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let result = ctx.client.try_pause_stream(&id, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    #[test]
    fn already_cancelled_on_pause() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        ctx.client.cancel(&id, &ctx.sender);
        let result = ctx.client.try_pause_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn stream_not_paused_on_resume() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let result = ctx.client.try_resume_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::StreamNotPaused)));
    }

    #[test]
    fn already_cancelled_on_resume() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        ctx.client.cancel(&id, &ctx.sender);
        let result = ctx.client.try_resume_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
    }

    #[test]
    fn stream_not_found_on_cancel_stream_variant() {
        let ctx = setup();
        let result = ctx.client.try_cancel_stream(&42, &ctx.receiver);
        assert_eq!(result, Err(Ok(Error::StreamNotFound)));
    }

    #[test]
    fn unauthorized_on_cancel_stream_variant() {
        let ctx = setup();
        let id = ctx.create_default_stream();
        let result = ctx.client.try_cancel_stream(&id, &ctx.sender);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }
}

/// Multi-step chains exercising two or more core functions together, the
/// way a real caller would use them across a stream's lifetime.
mod integration {
    use super::support::*;
    use crate::types::{CurveType, Milestone, StreamOptions, StreamState};
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::TokenClient;
    use soroban_sdk::{Address, Vec};

    #[test]
    fn full_lifecycle_create_withdraw_pause_resume_withdraw_cancel() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1200);
        let first = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(first, 200);

        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1300); // 100 units paused
        ctx.client.resume_stream(&id, &ctx.sender);

        set_time(&ctx.env, 1500);
        let second = ctx.client.withdraw(&id, &ctx.receiver);
        // Effective elapsed at 1500 is (1500-1000) - 100 = 400; 200 already
        // withdrawn, so this withdrawal pays out 200 more.
        assert_eq!(second, 200);

        ctx.client.cancel(&id, &ctx.sender);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn pause_immediately_then_resume_then_full_withdraw_at_end() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1000);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1500); // 500 units paused
        ctx.client.resume_stream(&id, &ctx.sender);

        // With 500 units paused, the adjusted end is 2500.
        set_time(&ctx.env, 2500);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 1000);
    }

    #[test]
    fn two_independent_streams_between_same_parties_do_not_interfere() {
        let ctx = setup();
        let first = ctx.create_default_stream();
        let second = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &2000,
            &1000,
            &1000,
            &3000,
            &CurveType::Linear,
            &false,
        );

        set_time(&ctx.env, 1500);
        ctx.client.pause_stream(&first, &ctx.sender);

        // Pausing the first stream must not affect the second.
        let withdrawn_second = ctx.client.withdraw(&second, &ctx.receiver);
        assert_eq!(withdrawn_second, 500);
        assert_eq!(ctx.client.get_stream(&first).state, StreamState::Paused);
    }

    #[test]
    fn create_with_milestones_then_withdraw_then_cancel() {
        let ctx = setup();
        let milestones: Vec<Milestone> = Vec::new(&ctx.env);
        let options = StreamOptions {
            curve_type: CurveType::Linear,
            is_soulbound: false,
            vault_address: None,
        };
        let id = ctx.client.create_stream_with_milestones(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &milestones,
            &options,
        );

        set_time(&ctx.env, 1400);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 400);

        set_time(&ctx.env, 1600);
        ctx.client.cancel(&id, &ctx.sender);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn soulbound_stream_full_lifecycle() {
        let ctx = setup();
        let id = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &ctx.token,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &true,
        );

        set_time(&ctx.env, 1300);
        ctx.client.withdraw(&id, &ctx.receiver);

        // Soulbound streams cannot have their receiver transferred.
        let other = Address::generate(&ctx.env);
        let transfer_result = ctx.client.try_transfer_receiver(&id, &ctx.sender, &other);
        assert!(transfer_result.is_err());

        set_time(&ctx.env, 1800);
        ctx.client.cancel(&id, &ctx.sender);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);
    }

    #[test]
    fn transfer_receiver_mid_lifecycle_then_new_receiver_continues_withdrawing() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1200);
        ctx.client.withdraw(&id, &ctx.receiver);

        let new_receiver = Address::generate(&ctx.env);
        ctx.client
            .transfer_receiver(&id, &ctx.sender, &new_receiver);

        set_time(&ctx.env, 1600);
        let withdrawn = ctx.client.withdraw(&id, &new_receiver);
        assert_eq!(withdrawn, 400);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&new_receiver), 400);
        assert_eq!(token_client.balance(&ctx.receiver), 200);
    }

    #[test]
    fn multiple_streams_different_tokens_have_independent_accounting() {
        let ctx = setup();
        let admin2 = Address::generate(&ctx.env);
        let token2 = ctx.env.register_stellar_asset_contract_v2(admin2).address();
        soroban_sdk::token::StellarAssetClient::new(&ctx.env, &token2)
            .mint(&ctx.sender, &1_000_000);

        let stream_token1 = ctx.create_default_stream();
        let stream_token2 = ctx.client.create_stream(
            &ctx.sender,
            &ctx.receiver,
            &token2,
            &1000,
            &1000,
            &1000,
            &2000,
            &CurveType::Linear,
            &false,
        );

        set_time(&ctx.env, 1500);
        ctx.client.withdraw(&stream_token1, &ctx.receiver);
        ctx.client.withdraw(&stream_token2, &ctx.receiver);

        let token1_client = TokenClient::new(&ctx.env, &ctx.token);
        let token2_client = TokenClient::new(&ctx.env, &token2);
        assert_eq!(token1_client.balance(&ctx.receiver), 500);
        assert_eq!(token2_client.balance(&ctx.receiver), 500);
    }

    #[test]
    fn pause_prevents_withdraw_then_cancel_after_resume_settles_correctly() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1300);
        ctx.client.pause_stream(&id, &ctx.sender);

        set_time(&ctx.env, 1900);
        let blocked = ctx.client.try_withdraw(&id, &ctx.receiver);
        assert!(blocked.is_err());

        ctx.client.resume_stream(&id, &ctx.sender);
        // 600 units were paused; cancel now should reflect that almost
        // nothing has effectively vested since resuming.
        ctx.client.cancel(&id, &ctx.sender);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        // Effective elapsed at cancel time (1900) is (1900-1000) - 600 = 300.
        assert_eq!(token_client.balance(&ctx.receiver), 300);
    }

    #[test]
    fn repeated_pause_resume_then_cancel_computes_correct_split() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1100);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1150); // +50 paused
        ctx.client.resume_stream(&id, &ctx.sender);

        set_time(&ctx.env, 1400);
        ctx.client.pause_stream(&id, &ctx.sender);
        set_time(&ctx.env, 1450); // +50 paused, 100 total
        ctx.client.resume_stream(&id, &ctx.sender);

        set_time(&ctx.env, 1700);
        ctx.client.cancel(&id, &ctx.sender);

        // Effective elapsed at cancel time (1700) is (1700-1000) - 100 = 600.
        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 600);
        assert_eq!(token_client.balance(&ctx.sender), 1_000_000 - 1000 + 400);
    }

    #[test]
    fn initialize_then_admin_uses_granted_role_before_stream_lifecycle() {
        let ctx = setup();
        // initialize() granted the admin SuperAdmin; use that role to
        // restrict an unrelated address, then run an ordinary stream
        // lifecycle to confirm the two features compose correctly.
        let blocked = Address::generate(&ctx.env);
        ctx.client.restrict_address(&ctx.admin, &blocked);
        assert!(ctx.client.is_address_restricted(&blocked));

        let id = ctx.create_default_stream();
        set_time(&ctx.env, 2000);
        let withdrawn = ctx.client.withdraw(&id, &ctx.receiver);
        assert_eq!(withdrawn, 1000);
    }

    #[test]
    fn cancel_stream_bridge_migration_variant_full_flow() {
        let ctx = setup();
        let id = ctx.create_default_stream();

        set_time(&ctx.env, 1250);
        ctx.client.withdraw(&id, &ctx.receiver); // pays 250

        set_time(&ctx.env, 1600);
        let remaining = ctx.client.cancel_stream(&id, &ctx.receiver);

        // cancel_stream pays out everything left, unvested included.
        assert_eq!(remaining, 750);
        assert_eq!(ctx.client.get_stream(&id).state, StreamState::Closed);

        let token_client = TokenClient::new(&ctx.env, &ctx.token);
        assert_eq!(token_client.balance(&ctx.receiver), 1000);
    }
}
