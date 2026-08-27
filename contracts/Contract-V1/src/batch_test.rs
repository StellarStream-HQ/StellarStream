//! Batch stream creation tests (issue #1450).
#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::Address as _;

fn stream_param(
    receiver: &Address,
    token: &Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: u32,
    is_soulbound: bool,
) -> StreamParams {
    StreamParams {
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount,
        start_time,
        end_time,
        curve_type,
        is_soulbound,
    }
}

#[test]
fn test_batch_create_two_streams() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    params.push_back(stream_param(&f.receiver, &f.token, 1_000, 0, 1_000, CURVE_LINEAR, false));
    params.push_back(stream_param(&f.receiver, &f.token, 2_000, 0, 1_000, CURVE_EXP, false));

    let ids = c.batch_create_streams(&f.sender, &params);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids.get(0).unwrap(), 1);
    assert_eq!(ids.get(1).unwrap(), 2);

    let s0 = c.get_stream(&1);
    assert_eq!(s0.total_amount, 1_000);
    assert_eq!(s0.curve_type, CURVE_LINEAR);
    let s1 = c.get_stream(&2);
    assert_eq!(s1.total_amount, 2_000);
    assert_eq!(s1.curve_type, CURVE_EXP);
    assert_eq!(c.next_stream_id(), 3);
}

#[test]
fn test_batch_create_ten_streams() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    for i in 0..10u32 {
        let receiver = Address::generate(&f.env);
        params.push_back(stream_param(
            &receiver,
            &f.token,
            ((i as i128) + 1) * 100,
            0,
            1_000,
            CURVE_LINEAR,
            false,
        ));
    }

    let ids = c.batch_create_streams(&f.sender, &params);
    assert_eq!(ids.len(), 10);
    for (idx, id) in ids.iter().enumerate() {
        assert_eq!(id, (idx as u64) + 1);
    }
    assert_eq!(c.next_stream_id(), 11);
}

#[test]
fn test_batch_create_mixed_parameters() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    params.push_back(stream_param(&f.receiver, &f.token, 1_000, 100, 1_100, CURVE_LINEAR, false));
    params.push_back(stream_param(&f.receiver, &f.token, 5_000, 0, 10_000, CURVE_EXP, true));
    params.push_back(stream_param(&f.admin, &f.token, 500, 50, 500, CURVE_LINEAR, false));

    let ids = c.batch_create_streams(&f.sender, &params);
    assert_eq!(ids.len(), 3);

    let s1 = c.get_stream(&ids.get(1).unwrap());
    assert_eq!(s1.curve_type, CURVE_EXP);
    assert!(s1.is_soulbound);
    assert_eq!(s1.start_time, 0);
    assert_eq!(s1.end_time, 10_000);

    let s2 = c.get_stream(&ids.get(2).unwrap());
    assert_eq!(s2.receiver, f.admin);
    assert_eq!(s2.total_amount, 500);
}

#[test]
fn test_batch_create_partial_failure_rolls_back() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    params.push_back(stream_param(&f.receiver, &f.token, 1_000, 0, 1_000, CURVE_LINEAR, false));
    // Second entry is invalid (unknown curve) — the whole batch must fail atomically.
    params.push_back(stream_param(&f.receiver, &f.token, 2_000, 0, 1_000, 99, false));
    params.push_back(stream_param(&f.receiver, &f.token, 3_000, 0, 1_000, CURVE_LINEAR, false));

    assert_eq!(
        c.try_batch_create_streams(&f.sender, &params),
        Err(Ok(Error::InvalidCurve))
    );
    // Nothing was created: id counter untouched and no user streams recorded.
    assert_eq!(c.next_stream_id(), 1);
    assert_eq!(c.get_user_streams(&f.sender).len(), 0);
    assert_eq!(c.get_user_streams(&f.receiver).len(), 0);
}

#[test]
fn test_batch_create_total_overflow_rolls_back() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    params.push_back(stream_param(&f.receiver, &f.token, i128::MAX, 0, 1_000, CURVE_LINEAR, false));
    params.push_back(stream_param(&f.receiver, &f.token, 1, 0, 1_000, CURVE_LINEAR, false));

    assert_eq!(
        c.try_batch_create_streams(&f.sender, &params),
        Err(Ok(Error::Overflow))
    );
    assert_eq!(c.next_stream_id(), 1);
    assert_eq!(c.get_user_streams(&f.sender).len(), 0);
}

#[test]
fn test_batch_create_empty_batch() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let params = Vec::new(&f.env);

    assert_eq!(
        c.try_batch_create_streams(&f.sender, &params),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(c.next_stream_id(), 1);
}

#[test]
fn test_batch_create_exceeds_max_batch_size() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let mut params = Vec::new(&f.env);
    for _ in 0..(MAX_BATCH_SIZE + 1) {
        params.push_back(stream_param(&f.receiver, &f.token, 100, 0, 1_000, CURVE_LINEAR, false));
    }

    assert_eq!(
        c.try_batch_create_streams(&f.sender, &params),
        Err(Ok(Error::BatchSizeExceeded))
    );
    assert_eq!(c.next_stream_id(), 1);
}

#[test]
fn test_batch_create_restricted_receiver_rolls_back() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    c.restrict_address(&f.admin, &f.receiver);

    let mut params = Vec::new(&f.env);
    params.push_back(stream_param(&f.receiver, &f.token, 1_000, 0, 1_000, CURVE_LINEAR, false));
    params.push_back(stream_param(&f.admin, &f.token, 2_000, 0, 1_000, CURVE_LINEAR, false));

    assert_eq!(
        c.try_batch_create_streams(&f.sender, &params),
        Err(Ok(Error::AddressRestricted))
    );
    assert_eq!(c.next_stream_id(), 1);
}