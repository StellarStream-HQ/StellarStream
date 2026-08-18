#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let token_address = e.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_admin_client = StellarAssetClient::new(e, &token_address);
    (token_address, token_admin_client)
}

fn setup_test<'a>() -> (Env, Address, StellarStreamContractClient<'a>, Address, StellarAssetClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let (token_address, token_admin) = create_token_contract(&env, &admin);

    (env, admin, client, token_address, token_admin)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Issue #1477: Streaming Rate Calculator Utilities
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_rate_calculator_basic_day_month_second() {
    let (env, _admin, client, token, token_admin) = setup_test();

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let amount: i128 = 100_000;
    token_admin.mint(&sender, &amount);

    let start_time = 1000;
    let end_time = 101_000; // 100,000 seconds
    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &start_time, &end_time);

    let rate_sec = client.get_stream_rate_per_second(&stream_id);
    assert_eq!(rate_sec, 1);

    let rate_day = client.get_stream_rate_per_day(&stream_id);
    assert_eq!(rate_day, 86_400);

    let rate_month = client.get_stream_rate_per_month(&stream_id);
    assert_eq!(rate_month, 2_592_000);
}

#[test]
fn test_rate_calculator_with_paused_duration() {
    let (env, _admin, client, token, token_admin) = setup_test();

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let amount: i128 = 100_000;
    token_admin.mint(&sender, &amount);

    let start_time = 0;
    let end_time = 200_000;
    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &start_time, &end_time);

    env.ledger().set_timestamp(50_000);
    client.pause_stream(&sender, &stream_id);

    env.ledger().set_timestamp(150_000);
    client.unpause_stream(&sender, &stream_id);

    let rate_sec = client.get_stream_rate_per_second(&stream_id);
    assert_eq!(rate_sec, 1);

    let rate_day = client.get_stream_rate_per_day(&stream_id);
    assert_eq!(rate_day, 86_400);

    let rate_month = client.get_stream_rate_per_month(&stream_id);
    assert_eq!(rate_month, 2_592_000);
}

#[test]
fn test_rate_calculator_stream_not_found() {
    let (_env, _admin, client, _token, _token_admin) = setup_test();
    let res = client.try_get_stream_rate_per_second(&999);
    assert!(res.is_err());
}

#[test]
fn test_rate_calculator_precision_short_stream() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let amount: i128 = 86_400;
    token_admin.mint(&sender, &amount);

    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &0, &86_400);

    assert_eq!(client.get_stream_rate_per_second(&stream_id), 1);
    assert_eq!(client.get_stream_rate_per_day(&stream_id), 86_400);
    assert_eq!(client.get_stream_rate_per_month(&stream_id), 2_592_000);
}

#[test]
fn test_rate_calculator_fractional_precision() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let amount: i128 = 100;
    token_admin.mint(&sender, &amount);

    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &0, &200);

    assert_eq!(client.get_stream_rate_per_second(&stream_id), 0);
    assert_eq!(client.get_stream_rate_per_day(&stream_id), 43_200);
    assert_eq!(client.get_stream_rate_per_month(&stream_id), 1_296_000);
}

#[test]
fn test_rate_calculator_very_long_stream() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    // 1 year stream: 31,536,000 seconds with 31,536,000 tokens
    let amount: i128 = 31_536_000;
    token_admin.mint(&sender, &amount);

    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &0, &31_536_000);
    assert_eq!(client.get_stream_rate_per_second(&stream_id), 1);
    assert_eq!(client.get_stream_rate_per_day(&stream_id), 86_400);
    assert_eq!(client.get_stream_rate_per_month(&stream_id), 2_592_000);
}

#[test]
fn test_rate_consistency_across_units() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    let amount: i128 = 2_592_000; // Exactly 1 month of seconds
    token_admin.mint(&sender, &amount);

    let stream_id = client.create_stream(&sender, &receiver, &token, &amount, &0, &2_592_000);
    let sec = client.get_stream_rate_per_second(&stream_id);
    let day = client.get_stream_rate_per_day(&stream_id);
    let month = client.get_stream_rate_per_month(&stream_id);

    assert_eq!(sec, 1);
    assert_eq!(day, 86_400);
    assert_eq!(month, 2_592_000);
    assert_eq!(day, sec * 86_400);
    assert_eq!(month, day * 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Issue #1476: Stream Search and Filter Queries
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_query_streams_empty_filter_returns_all() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &10_000);

    client.create_stream(&sender, &receiver, &token, &1000, &0, &1000);
    client.create_stream(&sender, &receiver, &token, &2000, &1000, &3000);
    client.create_stream(&sender, &receiver, &token, &3000, &2000, &5000);

    let filter = StreamFilter::default();
    let results = client.query_streams(&filter, &0, &10);

    assert_eq!(results.len(), 3);
    assert_eq!(results.get(0).unwrap().id, 1);
    assert_eq!(results.get(1).unwrap().id, 2);
    assert_eq!(results.get(2).unwrap().id, 3);
}

#[test]
fn test_query_streams_filter_by_token_and_amount() {
    let (env, admin, client, token1, token_admin1) = setup_test();
    let (token2, token_admin2) = create_token_contract(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin1.mint(&sender, &10_000);
    token_admin2.mint(&sender, &10_000);

    client.create_stream(&sender, &receiver, &token1, &500, &0, &1000);
    client.create_stream(&sender, &receiver, &token1, &1500, &0, &1000);
    client.create_stream(&sender, &receiver, &token2, &1500, &0, &1000);

    let mut filter = StreamFilter::default();
    filter.token = Some(token1.clone());
    filter.min_amount = Some(1000);

    let results = client.query_streams(&filter, &0, &10);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, 2);
    assert_eq!(results.get(0).unwrap().total_amount, 1500);
}

#[test]
fn test_query_streams_filter_by_state_and_pagination() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &20_000);

    let id1 = client.create_stream(&sender, &receiver, &token, &1000, &0, &1000);
    let id2 = client.create_stream(&sender, &receiver, &token, &1000, &0, &1000);
    let id3 = client.create_stream(&sender, &receiver, &token, &1000, &0, &1000);

    client.pause_stream(&sender, &id2);

    let mut filter = StreamFilter::default();
    filter.state = Some(StreamState::Active as u32);

    let active_results = client.query_streams(&filter, &0, &10);
    assert_eq!(active_results.len(), 2);
    assert_eq!(active_results.get(0).unwrap().id, id1);
    assert_eq!(active_results.get(1).unwrap().id, id3);

    let page1 = client.query_streams(&StreamFilter::default(), &0, &2);
    assert_eq!(page1.len(), 2);
    assert_eq!(page1.get(0).unwrap().id, 1);
    assert_eq!(page1.get(1).unwrap().id, 2);

    let page2 = client.query_streams(&StreamFilter::default(), &2, &2);
    assert_eq!(page2.len(), 1);
    assert_eq!(page2.get(0).unwrap().id, 3);
}

#[test]
fn test_query_streams_time_bounds() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &10_000);

    client.create_stream(&sender, &receiver, &token, &1000, &100, &500);
    client.create_stream(&sender, &receiver, &token, &1000, &600, &1200);

    let mut filter = StreamFilter::default();
    filter.start_time_after = Some(200);

    let results = client.query_streams(&filter, &0, &10);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, 2);

    let mut end_filter = StreamFilter::default();
    end_filter.end_time_before = Some(600);
    let end_results = client.query_streams(&end_filter, &0, &10);
    assert_eq!(end_results.len(), 1);
    assert_eq!(end_results.get(0).unwrap().id, 1);
}

#[test]
fn test_query_streams_max_limit_capping() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &100_000);

    for _ in 0..60 {
        client.create_stream(&sender, &receiver, &token, &100, &0, &1000);
    }

    // Limit requesting 100 should be capped at MAX_QUERY_LIMIT (50)
    let results = client.query_streams(&StreamFilter::default(), &0, &100);
    assert_eq!(results.len(), 50);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests for Issue #1475: Total Value Locked (TVL) Query
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tvl_tracking_single_and_multi_token() {
    let (env, admin, client, token1, token_admin1) = setup_test();
    let (token2, token_admin2) = create_token_contract(&env, &admin);

    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin1.mint(&sender, &50_000);
    token_admin2.mint(&sender, &50_000);

    assert_eq!(client.get_token_tvl(&token1), 0);
    assert_eq!(client.get_token_tvl(&token2), 0);

    client.create_stream(&sender, &receiver, &token1, &10_000, &0, &1000);
    client.create_stream(&sender, &receiver, &token1, &20_000, &0, &1000);
    client.create_stream(&sender, &receiver, &token2, &15_000, &0, &1000);

    assert_eq!(client.get_token_tvl(&token1), 30_000);
    assert_eq!(client.get_token_tvl(&token2), 15_000);

    let all_tvl = client.get_all_tokens_tvl();
    assert_eq!(all_tvl.get(token1.clone()).unwrap(), 30_000);
    assert_eq!(all_tvl.get(token2.clone()).unwrap(), 15_000);
}

#[test]
fn test_tvl_updates_on_cancellation() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &10_000);

    let stream_id = client.create_stream(&sender, &receiver, &token, &10_000, &0, &1000);
    assert_eq!(client.get_token_tvl(&token), 10_000);

    // Cancel at 50% (timestamp = 500)
    env.ledger().set_timestamp(500);
    client.cancel_stream(&sender, &stream_id);

    // TVL is cleared when stream is cancelled
    assert_eq!(client.get_token_tvl(&token), 0);
}

#[test]
fn test_tvl_empty_protocol() {
    let (_env, _admin, client, token, _token_admin) = setup_test();
    assert_eq!(client.get_token_tvl(&token), 0);
    let all = client.get_all_tokens_tvl();
    assert_eq!(all.len(), 0);
}

#[test]
fn test_health_check_empty_and_active_protocol() {
    let (env, _admin, client, token, token_admin) = setup_test();
    
    // Initial health check on empty protocol
    let health0 = client.health_check();
    assert_eq!(health0.is_paused, false);
    assert_eq!(health0.active_streams, 0);
    assert_eq!(health0.total_streams, 0);
    assert_eq!(health0.version, 1);

    // Create active stream
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    token_admin.mint(&sender, &10_000);
    client.create_stream(&sender, &receiver, &token, &10_000, &0, &1000);

    let health1 = client.health_check();
    assert_eq!(health1.is_paused, false);
    assert_eq!(health1.active_streams, 1);
    assert_eq!(health1.total_streams, 1);
}

#[test]
fn test_get_metrics_aggregation_across_lifecycles() {
    let (env, _admin, client, token, token_admin) = setup_test();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);

    token_admin.mint(&sender, &50_000);

    // 1. Create Stream 1 (will complete)
    let s1 = client.create_stream(&sender, &receiver, &token, &10_000, &0, &1000);
    // 2. Create Stream 2 (will cancel)
    let s2 = client.create_stream(&sender, &receiver, &token, &20_000, &0, &1000);
    // 3. Create Stream 3 (stays active)
    let _s3 = client.create_stream(&sender, &receiver, &token, &15_000, &0, &1000);

    let metrics_initial = client.get_metrics();
    assert_eq!(metrics_initial.total_streams, 3);
    assert_eq!(metrics_initial.active_streams, 3);
    assert_eq!(metrics_initial.total_volume_streamed, 45_000);
    assert_eq!(metrics_initial.total_withdrawn_volume, 0);

    // Advance time and complete s1
    env.ledger().set_timestamp(1000);
    client.withdraw(&receiver, &s1, &None);

    // Cancel s2 at time 1000 (all 20,000 vested & transferred to receiver)
    client.cancel_stream(&sender, &s2);

    let metrics_final = client.get_metrics();
    assert_eq!(metrics_final.total_streams, 3);
    assert_eq!(metrics_final.active_streams, 1);
    assert_eq!(metrics_final.completed_streams, 1);
    assert_eq!(metrics_final.cancelled_streams, 1);
    assert_eq!(metrics_final.total_volume_streamed, 45_000);
    assert_eq!(metrics_final.total_withdrawn_volume, 30_000);
}
