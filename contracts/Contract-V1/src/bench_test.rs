#![cfg(test)]

/// Benchmark tests for gas optimization
/// These tests verify that optimized functions work correctly
/// Actual gas profiling requires soroban-cli with --profile flag

#[test]
fn bench_math_operations() {
    use crate::math;

    // Benchmark: Math calculations (inlined functions)
    let total = 1_000_000_i128;
    let start = 0u64;
    let cliff = 500u64;
    let end = 1000u64;

    // Test at various points
    for now in [0, 250, 500, 750, 1000] {
        let unlocked = math::calculate_unlocked(total, start, cliff, end, now);
        assert!(unlocked >= 0 && unlocked <= total);
    }

    // Benchmark: Fee calculation
    for fee_bps in [0, 50, 100, 250, 500, 1000] {
        let fee = math::calculate_fee(total, fee_bps);
        assert!(fee >= 0 && fee <= total);
    }
}

#[test]
fn bench_inline_math_performance() {
    use crate::math;

    // Test that inlined functions work correctly
    // In release mode, these should have zero function call overhead

    let amount = 1_000_000_i128;
    let start = 0u64;
    let cliff = 100u64;
    let end = 1000u64;

    // Multiple calls to test inlining benefit
    for i in 0..100 {
        let now = i * 10;
        let unlocked = math::calculate_unlocked(amount, start, cliff, end, now);
        assert!(unlocked >= 0);
    }
}

#[test]
fn bench_fee_calculation_optimization() {
    use crate::math;

    let amount = 1_000_000_i128;

    // Test zero fee (should be optimized with early return)
    let fee = math::calculate_fee(amount, 0);
    assert_eq!(fee, 0);

    // Test various fee rates
    let fee_50 = math::calculate_fee(amount, 50); // 0.5%
    assert_eq!(fee_50, 5000);

    let fee_100 = math::calculate_fee(amount, 100); // 1%
    assert_eq!(fee_100, 10000);

    let fee_1000 = math::calculate_fee(amount, 1000); // 10%
    assert_eq!(fee_1000, 100000);
}

#[test]
fn bench_early_return_optimization() {
    use crate::math;

    let amount = 1_000_000_i128;
    let start = 1000u64;
    let cliff = 1500u64;
    let end = 2000u64;

    // Test early return for before cliff
    let unlocked_before = math::calculate_unlocked(amount, start, cliff, end, 1000);
    assert_eq!(unlocked_before, 0);

    // Test early return for after end
    let unlocked_after = math::calculate_unlocked(amount, start, cliff, end, 3000);
    assert_eq!(unlocked_after, amount);

    // Test main calculation path
    let unlocked_mid = math::calculate_unlocked(amount, start, cliff, end, 1750);
    assert!(unlocked_mid > 0 && unlocked_mid < amount);
}

#[test]
fn bench_calculate_unlocked_edge_cases() {
    use crate::math;

    let amount = 1_000_000_i128;

    // Test with cliff at start
    let unlocked = math::calculate_unlocked(amount, 1000, 1000, 2000, 1500);
    assert_eq!(unlocked, 500_000);

    // Test with large amounts (but not overflow)
    let large_amount = 1_000_000_000_000_i128;
    let unlocked_large = math::calculate_unlocked(large_amount, 0, 0, 1000, 500);
    assert!(unlocked_large > 0);

    // Test with zero amount
    let unlocked_zero = math::calculate_unlocked(0, 0, 0, 1000, 500);
    assert_eq!(unlocked_zero, 0);
}

#[test]
fn bench_fee_calculation_edge_cases() {
    use crate::math;

    // Test with zero amount
    let fee = math::calculate_fee(0, 100);
    assert_eq!(fee, 0);

    // Test with maximum fee (10%)
    let fee_max = math::calculate_fee(1_000_000, 1000);
    assert_eq!(fee_max, 100_000);

    // Test with large amounts (but not overflow)
    let large_amount = 1_000_000_000_000_i128;
    let fee_large = math::calculate_fee(large_amount, 100);
    assert!(fee_large > 0);
}

#[test]
fn bench_math_precision() {
    use crate::math;

    // Test precision of calculations
    let amount = 1_000_000_i128;
    let start = 0u64;
    let cliff = 0u64;
    let end = 1000u64;

    // Test at 1% intervals
    for i in 0..=100 {
        let now = (i * 10) as u64;
        let unlocked = math::calculate_unlocked(amount, start, cliff, end, now);
        let expected_min = (amount * i) / 100 - 1; // Allow for rounding
        let expected_max = (amount * i) / 100 + 1;
        assert!(unlocked >= expected_min && unlocked <= expected_max);
    }
}

/// Benchmarks for `create_batch_streams` gas efficiency.
///
/// These measure CPU instructions consumed (via `env.cost_estimate().budget()`)
/// rather than real network gas, but the relative comparison holds: the
/// optimizations in `create_batch_streams` (single auth check, cached
/// restricted-address list, cached stream counter, one bulk token transfer)
/// only affect host-call and storage-op counts, which is exactly what the CPU
/// instruction counter tracks. Actual on-chain gas profiling requires
/// soroban-cli with the `--profile` flag.
mod batch_gas {
    use crate::types::{CurveType, StreamRequest};
    use crate::{StellarStreamContract, StellarStreamContractClient};
    use soroban_sdk::testutils::{Address as _, Events, Ledger};
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Address, Env, Vec};

    struct BenchCtx {
        env: Env,
        client: StellarStreamContractClient<'static>,
        sender: Address,
        token: Address,
    }

    fn setup_bench() -> BenchCtx {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 1_000);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin).address();
        StellarAssetClient::new(&env, &token).mint(&sender, &1_000_000_000);

        BenchCtx {
            env,
            client,
            sender,
            token,
        }
    }

    fn make_requests(env: &Env, n: u32) -> Vec<StreamRequest> {
        let mut requests = Vec::new(env);
        for _ in 0..n {
            requests.push_back(StreamRequest {
                receiver: Address::generate(env),
                amount: 1_000,
                start_time: 1_000,
                cliff_time: 1_000,
                end_time: 2_000,
                interest_strategy: 0,
                vault_address: None,
                metadata: None,
            });
        }
        requests
    }

    /// Like [`make_requests`], but every request pays the same `receiver` —
    /// the shape a `batch_withdraw` caller actually needs, since one caller
    /// must own every stream being withdrawn from.
    fn make_requests_for(env: &Env, n: u32, receiver: &Address) -> Vec<StreamRequest> {
        let mut requests = Vec::new(env);
        for _ in 0..n {
            requests.push_back(StreamRequest {
                receiver: receiver.clone(),
                amount: 1_000,
                start_time: 1_000,
                cliff_time: 1_000,
                end_time: 2_000,
                interest_strategy: 0,
                vault_address: None,
                metadata: None,
            });
        }
        requests
    }

    /// Runs `f` with a freshly reset, unlimited budget and returns the CPU
    /// instructions it consumed in isolation. Setup work (registering the
    /// contract/token, generating addresses) happens before this is called
    /// so only the call under test is measured.
    fn measure_cpu(env: &Env, f: impl FnOnce()) -> u64 {
        env.cost_estimate().budget().reset_unlimited();
        f();
        env.cost_estimate().budget().cpu_instruction_cost()
    }

    #[test]
    fn bench_batch_saves_at_least_30_percent_cpu_vs_individual_calls() {
        const N: u32 = 10;

        let individual = setup_bench();
        let individual_requests = make_requests(&individual.env, N);
        let individual_cost = measure_cpu(&individual.env, || {
            for req in individual_requests.iter() {
                individual.client.create_stream(
                    &individual.sender,
                    &req.receiver,
                    &individual.token,
                    &1_000,
                    &1_000,
                    &1_000,
                    &2_000,
                    &CurveType::Linear,
                    &false,
                );
            }
        });

        let batch = setup_bench();
        let requests = make_requests(&batch.env, N);
        let batch_cost = measure_cpu(&batch.env, || {
            batch
                .client
                .create_batch_streams(&batch.sender, &batch.token, &requests);
        });

        let individual_per_item = individual_cost / N as u64;
        let batch_per_item = batch_cost / N as u64;

        assert!(
            batch_cost < individual_cost,
            "batch of {N} ({batch_cost} cpu insns) should cost less than {N} individual calls ({individual_cost} cpu insns)"
        );
        assert!(
            batch_per_item < individual_per_item,
            "batch per-item cost ({batch_per_item}) should be lower than individual per-item cost ({individual_per_item})"
        );

        // Acceptance criterion: at least 30% CPU savings vs individual calls.
        let savings_bps = ((individual_cost - batch_cost) * 10_000) / individual_cost;
        assert!(
            savings_bps >= 3_000,
            "expected at least 30% CPU savings from batching, got {savings_bps}bps ({batch_cost} vs {individual_cost})"
        );
    }

    #[test]
    fn bench_batch_per_item_cost_decreases_with_batch_size() {
        let small = setup_bench();
        let small_n: u32 = 2;
        let small_requests = make_requests(&small.env, small_n);
        let small_cost = measure_cpu(&small.env, || {
            small
                .client
                .create_batch_streams(&small.sender, &small.token, &small_requests);
        });
        let small_per_item = small_cost / small_n as u64;

        let large = setup_bench();
        let large_n: u32 = 20;
        let large_requests = make_requests(&large.env, large_n);
        let large_cost = measure_cpu(&large.env, || {
            large
                .client
                .create_batch_streams(&large.sender, &large.token, &large_requests);
        });
        let large_per_item = large_cost / large_n as u64;

        assert!(
            large_per_item < small_per_item,
            "marginal per-item CPU cost should shrink as batch size grows: batch({small_n})={small_per_item} vs batch({large_n})={large_per_item}"
        );
    }

    /// Counts events emitted by `token` during the most recent top-level
    /// contract invocation (soroban_sdk's test event log is scoped to the
    /// latest call, not accumulated across calls).
    fn token_event_count(env: &Env, token: &Address) -> usize {
        env.events()
            .all()
            .iter()
            .filter(|(contract, _, _)| contract == token)
            .count()
    }

    /// `create_batch_streams` beats individual calls on raw CPU instructions
    /// (see above), but for withdrawals the CPU-instruction proxy is
    /// misleading: per-stream storage I/O dominates and is irreducible, and
    /// `mock_all_auths` hides the real cost that a single auth check would
    /// otherwise save. What batching *does* unambiguously reduce is the
    /// number of token-contract invocations for a same-token batch — that's
    /// a real reduction in ledger footprint and transaction size on the
    /// actual network, and it's directly observable here as fewer emitted
    /// transfer events. See the `batch_withdraw` rustdoc for the full
    /// explanation of this tradeoff.
    #[test]
    fn bench_batch_withdraw_emits_one_transfer_event_per_distinct_token() {
        const N: u32 = 10;

        let individual = setup_bench();
        let individual_receiver = Address::generate(&individual.env);
        let individual_requests = make_requests_for(&individual.env, N, &individual_receiver);
        let individual_ids = individual.client.create_batch_streams(
            &individual.sender,
            &individual.token,
            &individual_requests,
        );
        individual.env.ledger().with_mut(|li| li.timestamp = 1_500);
        let mut individual_transfer_events = 0;
        for id in individual_ids.iter() {
            individual.client.withdraw(&id, &individual_receiver);
            individual_transfer_events += token_event_count(&individual.env, &individual.token);
        }
        assert_eq!(
            individual_transfer_events, N as usize,
            "N individual withdraws should each invoke the token contract once"
        );

        let batch = setup_bench();
        let batch_receiver = Address::generate(&batch.env);
        let batch_requests = make_requests_for(&batch.env, N, &batch_receiver);
        let batch_ids =
            batch
                .client
                .create_batch_streams(&batch.sender, &batch.token, &batch_requests);
        batch.env.ledger().with_mut(|li| li.timestamp = 1_500);
        batch.client.batch_withdraw(&batch_receiver, &batch_ids);
        let batch_transfer_events = token_event_count(&batch.env, &batch.token);
        assert_eq!(
            batch_transfer_events, 1,
            "a same-token batch of {N} withdrawals should invoke the token contract once, not {N} times"
        );
    }

    #[test]
    fn bench_batch_withdraw_per_item_cost_decreases_with_batch_size() {
        let small = setup_bench();
        let small_n: u32 = 2;
        let small_receiver = Address::generate(&small.env);
        let small_requests = make_requests_for(&small.env, small_n, &small_receiver);
        let small_ids =
            small
                .client
                .create_batch_streams(&small.sender, &small.token, &small_requests);
        small.env.ledger().with_mut(|li| li.timestamp = 1_500);
        let small_cost = measure_cpu(&small.env, || {
            small.client.batch_withdraw(&small_receiver, &small_ids);
        });
        let small_per_item = small_cost / small_n as u64;

        let large = setup_bench();
        let large_n: u32 = 20;
        let large_receiver = Address::generate(&large.env);
        let large_requests = make_requests_for(&large.env, large_n, &large_receiver);
        let large_ids =
            large
                .client
                .create_batch_streams(&large.sender, &large.token, &large_requests);
        large.env.ledger().with_mut(|li| li.timestamp = 1_500);
        let large_cost = measure_cpu(&large.env, || {
            large.client.batch_withdraw(&large_receiver, &large_ids);
        });
        let large_per_item = large_cost / large_n as u64;

        assert!(
            large_per_item < small_per_item,
            "marginal per-item CPU cost should shrink as batch size grows: batch({small_n})={small_per_item} vs batch({large_n})={large_per_item}"
        );
    }
}
