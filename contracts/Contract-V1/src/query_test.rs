#![cfg(test)]

use crate::types::{CurveType, Stream, StreamFilter, StreamState};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

use crate::{StellarStream, StellarStreamClient};

struct QueryTestContext {
    env: Env,
    client: StellarStreamClient<'static>,
    token: token::StellarAssetClient<'static>,
    token_id: Address,
}

fn setup_query_test() -> QueryTestContext {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::StellarAssetClient::new(&env, &token_id.address());

    QueryTestContext {
        env,
        client,
        token,
        token_id: token_id.address(),
    }
}

/// Helper to create multiple test streams with various properties
fn create_test_streams(ctx: &QueryTestContext) -> (Address, Address, Address, Address) {
    let sender1 = Address::generate(&ctx.env);
    let sender2 = Address::generate(&ctx.env);
    let receiver1 = Address::generate(&ctx.env);
    let receiver2 = Address::generate(&ctx.env);

    // Fund senders with tokens
    let total_amount = 1_000_000_i128;
    ctx.token.mint(&sender1, &(total_amount * 5));
    ctx.token.mint(&sender2, &(total_amount * 5));

    // Stream 1: 1000 amount, Active, USDC (default token)
    let _stream_id_1 = ctx.client.create_stream(
        sender1.clone(),
        receiver1.clone(),
        ctx.token_id.clone(),
        1000,
        1000,
        1100,
        2000,
        None,
        None,
    );

    // Stream 2: 5000 amount, Active
    let _stream_id_2 = ctx.client.create_stream(
        sender1.clone(),
        receiver1.clone(),
        ctx.token_id.clone(),
        5000,
        1000,
        1100,
        2000,
        None,
        None,
    );

    // Stream 3: 100 amount, Active, early time range
    let _stream_id_3 = ctx.client.create_stream(
        sender1.clone(),
        receiver2.clone(),
        ctx.token_id.clone(),
        100,
        500,
        600,
        1000,
        None,
        None,
    );

    // Stream 4: 10000 amount, pause it
    let stream_id_4 = ctx.client.create_stream(
        sender2.clone(),
        receiver1.clone(),
        ctx.token_id.clone(),
        10000,
        1000,
        1100,
        3000,
        None,
        None,
    );
    ctx.client.pause_stream(stream_id_4, sender2.clone());

    // Stream 5: 2500 amount, Active
    let _stream_id_5 = ctx.client.create_stream(
        sender2.clone(),
        receiver2.clone(),
        ctx.token_id.clone(),
        2500,
        2000,
        2100,
        3500,
        None,
        None,
    );

    (sender1, sender2, receiver1, receiver2)
}

#[test]
fn test_query_all_streams_empty_filter() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter::all();
    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return all 5 streams
    assert_eq!(results.len(), 5);
}

#[test]
fn test_query_by_token() {
    let ctx = setup_query_test();
    let (_s1, _s2, _r1, _r2) = create_test_streams(&ctx);

    let filter = StreamFilter {
        token: Some(ctx.token_id.clone()),
        state: None,
        min_amount: None,
        max_amount: None,
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // All created streams use the same token
    assert_eq!(results.len(), 5);
    for stream in results {
        assert_eq!(stream.token, ctx.token_id);
    }
}

#[test]
fn test_query_by_status_active() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: Some(StreamState::Active),
        min_amount: None,
        max_amount: None,
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return only active streams (4 active, 1 paused)
    assert_eq!(results.len(), 4);
    for stream in results {
        assert_eq!(stream.state, StreamState::Active);
    }
}

#[test]
fn test_query_by_status_paused() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: Some(StreamState::Paused),
        min_amount: None,
        max_amount: None,
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return only the paused stream
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().state, StreamState::Paused);
}

#[test]
fn test_query_by_amount_range_min() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: Some(2500),
        max_amount: None,
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return streams with amounts >= 2500: 5000, 10000, 2500
    assert_eq!(results.len(), 3);
    for stream in results {
        assert!(stream.total_amount >= 2500);
    }
}

#[test]
fn test_query_by_amount_range_max() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: None,
        max_amount: Some(1000),
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return streams with amounts <= 1000: 1000, 100
    assert_eq!(results.len(), 2);
    for stream in results {
        assert!(stream.total_amount <= 1000);
    }
}

#[test]
fn test_query_by_amount_range_both() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: Some(1000),
        max_amount: Some(5000),
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return: 1000, 5000, 2500
    assert_eq!(results.len(), 3);
    for stream in results {
        assert!(stream.total_amount >= 1000);
        assert!(stream.total_amount <= 5000);
    }
}

#[test]
fn test_query_by_time_range_start_after() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: None,
        max_amount: None,
        start_time_after: Some(999),
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return streams starting after 999: 1000, 2000, etc.
    assert!(results.len() > 0);
    for stream in results {
        assert!(stream.start_time > 999);
    }
}

#[test]
fn test_query_by_time_range_end_before() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: None,
        max_amount: None,
        start_time_after: None,
        end_time_before: Some(1500),
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return streams ending before or at 1500
    for stream in results {
        assert!(stream.end_time <= 1500);
    }
}

#[test]
fn test_query_combined_filters() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    // Query: USDC token, Active state, amount 1000-10000, starting after 999
    let filter = StreamFilter {
        token: Some(ctx.token_id.clone()),
        state: Some(StreamState::Active),
        min_amount: Some(1000),
        max_amount: Some(10000),
        start_time_after: Some(999),
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Verify all results match all criteria
    for stream in results {
        assert_eq!(stream.token, ctx.token_id);
        assert_eq!(stream.state, StreamState::Active);
        assert!(stream.total_amount >= 1000);
        assert!(stream.total_amount <= 10000);
        assert!(stream.start_time > 999);
    }
}

#[test]
fn test_query_pagination_offset() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter::all();

    // Get first page
    let page1 = ctx.client.query_streams(filter.clone(), 0, 2);
    assert_eq!(page1.len(), 2);

    // Get second page
    let page2 = ctx.client.query_streams(filter.clone(), 2, 2);
    assert_eq!(page2.len(), 2);

    // Get third page
    let page3 = ctx.client.query_streams(filter.clone(), 4, 2);
    assert_eq!(page3.len(), 1);

    // Verify no duplicates across pages
    let page1_ids: Vec<u64> = page1.iter().map(|s| s.start_time).collect();
    let page2_ids: Vec<u64> = page2.iter().map(|s| s.start_time).collect();
    let page3_ids: Vec<u64> = page3.iter().map(|s| s.start_time).collect();

    for id in &page1_ids {
        assert!(!page2_ids.contains(id));
        assert!(!page3_ids.contains(id));
    }
}

#[test]
fn test_query_pagination_limit_cap() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter::all();

    // Request 100 results, should be capped at 50
    let results = ctx.client.query_streams(filter.clone(), 0, 100);
    assert!(results.len() <= 50);

    // Request 50, should return up to 50
    let results = ctx.client.query_streams(filter.clone(), 0, 50);
    assert!(results.len() <= 50);
}

#[test]
fn test_query_no_results() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    // Query for streams with amount > 100000
    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: Some(100000),
        max_amount: None,
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_query_empty_stream_storage() {
    let ctx = setup_query_test();

    // No streams created yet
    let filter = StreamFilter::all();
    let results = ctx.client.query_streams(filter, 0, 50);

    assert_eq!(results.len(), 0);
}

#[test]
fn test_query_max_limit_enforcement() {
    let ctx = setup_query_test();

    // Create 60 streams to exceed default limit
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    ctx.token.mint(&sender, &(1_000_000_i128 * 100));

    for i in 0..60 {
        let _ = ctx.client.create_stream(
            sender.clone(),
            receiver.clone(),
            ctx.token_id.clone(),
            1000 + i as i128,
            1000,
            1100,
            2000 + i as u64,
            None,
            None,
        );
    }

    let filter = StreamFilter::all();

    // Request 0 limit, should default to MAX_QUERY_LIMIT (50)
    let results = ctx.client.query_streams(filter.clone(), 0, 0);
    assert_eq!(results.len(), 50);

    // Request excessive limit
    let results = ctx.client.query_streams(filter.clone(), 0, 1000);
    assert_eq!(results.len(), 50);
}

#[test]
fn test_query_offset_beyond_results() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    let filter = StreamFilter::all();

    // Only 5 streams exist, offset to 100
    let results = ctx.client.query_streams(filter, 100, 50);
    assert_eq!(results.len(), 0);
}

#[test]
fn test_query_filter_by_all_criteria() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    // Complex filter: Active state, amount 2000-6000, started after 1000, ended before 2500
    let filter = StreamFilter {
        token: Some(ctx.token_id.clone()),
        state: Some(StreamState::Active),
        min_amount: Some(2000),
        max_amount: Some(6000),
        start_time_after: Some(1000),
        end_time_before: Some(2500),
    };

    let results = ctx.client.query_streams(filter.clone(), 0, 50);

    // Verify each result matches all criteria
    for stream in results {
        assert_eq!(stream.token, ctx.token_id);
        assert_eq!(stream.state, StreamState::Active);
        assert!(stream.total_amount >= 2000, "Amount too low");
        assert!(stream.total_amount <= 6000, "Amount too high");
        assert!(stream.start_time > 1000, "Start time not after 1000");
        assert!(stream.end_time <= 2500, "End time not before 2500");
    }
}

#[test]
fn test_query_filter_edge_case_boundary() {
    let ctx = setup_query_test();
    create_test_streams(&ctx);

    // Boundary test: exact amount match
    let filter = StreamFilter {
        token: None,
        state: None,
        min_amount: Some(1000),
        max_amount: Some(1000),
        start_time_after: None,
        end_time_before: None,
    };

    let results = ctx.client.query_streams(filter, 0, 50);

    // Should return only the stream with exactly 1000
    for stream in results {
        assert_eq!(stream.total_amount, 1000);
    }
}

#[test]
fn test_query_gas_efficiency_large_dataset() {
    let ctx = setup_query_test();

    // Create 100 streams
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    ctx.token.mint(&sender, &(1_000_000_i128 * 200));

    for i in 0..100 {
        let _ = ctx.client.create_stream(
            sender.clone(),
            receiver.clone(),
            ctx.token_id.clone(),
            1000 + i as i128,
            1000,
            1100,
            2000 + i as u64,
            None,
            None,
        );
    }

    let filter = StreamFilter::all();

    // Paginate through results in 50-stream chunks
    let page1 = ctx.client.query_streams(filter.clone(), 0, 50);
    let page2 = ctx.client.query_streams(filter.clone(), 50, 50);
    let page3 = ctx.client.query_streams(filter.clone(), 100, 50);

    assert_eq!(page1.len(), 50);
    assert_eq!(page2.len(), 50);
    assert_eq!(page3.len(), 0); // Only 100 streams, 100 already loaded

    // Total should equal created streams (max 50 per query)
    assert_eq!(page1.len() + page2.len(), 100);
}
