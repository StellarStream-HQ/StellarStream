#![cfg(test)]

use crate::{
    errors::Error, types::StreamState, types::CurveType, StellarStreamContract,
    StellarStreamContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};

fn setup(env: &Env) -> (StellarStreamContractClient, Address, Address, Address) {
    let contract_id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(env, &contract_id);
    let sender = Address::generate(env);
    let receiver = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(env, &token_id).mint(&sender, &10000);
    (client, sender, receiver, token_id)
}

#[test]
fn test_pause_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, StreamState::Paused);
    assert!(stream.paused_time > 0);
}

#[test]
fn test_resume_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);

    env.ledger().with_mut(|li| li.timestamp = 300);
    client.resume_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, StreamState::Active);
    assert_eq!(stream.paused_time, 0);
    assert_eq!(stream.total_paused_duration, 200);
}

#[test]
fn test_cannot_withdraw_during_pause() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);

    env.ledger().with_mut(|li| li.timestamp = 200);
    let result = client.try_withdraw(&stream_id, &receiver);
    assert_eq!(result, Err(Ok(Error::StreamPaused)));
}

#[test]
fn test_cannot_pause_closed_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.cancel(&stream_id, &sender);

    let result = client.try_pause_stream(&stream_id, &sender);
    assert_eq!(result, Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn test_cannot_resume_active_stream() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    let result = client.try_resume_stream(&stream_id, &sender);
    assert_eq!(result, Err(Ok(Error::StreamNotPaused)));
}

#[test]
fn test_pause_resume_cycle() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);
    assert_eq!(
        client.get_stream(&stream_id).state,
        StreamState::Paused
    );

    env.ledger().with_mut(|li| li.timestamp = 200);
    client.resume_stream(&stream_id, &sender);
    assert_eq!(
        client.get_stream(&stream_id).state,
        StreamState::Active
    );

    env.ledger().with_mut(|li| li.timestamp = 300);
    client.pause_stream(&stream_id, &sender);
    assert_eq!(
        client.get_stream(&stream_id).state,
        StreamState::Paused
    );

    env.ledger().with_mut(|li| li.timestamp = 400);
    client.resume_stream(&stream_id, &sender);
    assert_eq!(
        client.get_stream(&stream_id).state,
        StreamState::Active
    );

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_paused_duration, 200);
}

#[test]
fn test_unauthorized_cannot_pause() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    let result = client.try_pause_stream(&stream_id, &receiver);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_unpause_stream_alias() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 0);

    let (client, sender, receiver, token_id) = setup(&env);

    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token_id,
        &1000,
        &0, &0,
        &500,
        &CurveType::Linear,
        &false,
    );

    env.ledger().with_mut(|li| li.timestamp = 100);
    client.pause_stream(&stream_id, &sender);

    env.ledger().with_mut(|li| li.timestamp = 300);
    client.unpause_stream(&stream_id, &sender);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.state, StreamState::Active);
}
