use soroban_sdk::{Address, Env, Map, Vec};
use crate::types::{DataKey, Error, Stream};

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().persistent().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn get_next_stream_id(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::NextStreamId)
        .unwrap_or(1)
}

pub fn increment_stream_id(env: &Env) -> u64 {
    let next_id = get_next_stream_id(env);
    env.storage()
        .persistent()
        .set(&DataKey::NextStreamId, &(next_id + 1));
    next_id
}

pub fn save_stream(env: &Env, stream: &Stream) {
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream.id), stream);
}

pub fn get_stream(env: &Env, stream_id: u64) -> Result<Stream, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Stream(stream_id))
        .ok_or(Error::StreamNotFound)
}

pub fn has_stream(env: &Env, stream_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Stream(stream_id))
}

pub fn get_stream_count(env: &Env) -> u64 {
    get_next_stream_id(env).saturating_sub(1)
}

pub fn get_token_tvl(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TokenTvl(token.clone()))
        .unwrap_or(0)
}

pub fn set_token_tvl(env: &Env, token: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::TokenTvl(token.clone()), &amount);
    
    // Register token in tokens list if not present
    let mut tokens: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::TokensList)
        .unwrap_or_else(|| Vec::new(env));

    let mut found = false;
    for i in 0..tokens.len() {
        if tokens.get(i).unwrap() == *token {
            found = true;
            break;
        }
    }
    if !found {
        tokens.push_back(token.clone());
        env.storage().persistent().set(&DataKey::TokensList, &tokens);
    }
}

pub fn add_token_tvl(env: &Env, token: &Address, delta: i128) {
    let current = get_token_tvl(env, token);
    set_token_tvl(env, token, current.saturating_add(delta));
}

pub fn sub_token_tvl(env: &Env, token: &Address, delta: i128) {
    let current = get_token_tvl(env, token);
    let next = if current >= delta { current - delta } else { 0 };
    set_token_tvl(env, token, next);
}

pub fn get_all_tokens_tvl(env: &Env) -> Map<Address, i128> {
    let tokens: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::TokensList)
        .unwrap_or_else(|| Vec::new(env));

    let mut result = Map::new(env);
    for i in 0..tokens.len() {
        let token = tokens.get(i).unwrap();
        let tvl = get_token_tvl(env, &token);
        result.set(token, tvl);
    }
    result
}
