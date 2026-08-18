#![no_std]

//! StellarStream - Real-time asset streaming on Stellar (Contract-V1)
//!
//! Provides continuous token streaming, linear vesting, real-time rate calculators,
//! multi-criteria stream querying, and Total Value Locked (TVL) tracking.

pub mod math;
pub mod storage;
pub mod types;

#[cfg(test)]
pub mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Map, Vec};
use crate::types::{ContractHealth, ContractMetrics, Error, Stream, StreamFilter, StreamState};

pub const MAX_QUERY_LIMIT: u32 = 50;
pub const PROTOCOL_VERSION: u32 = 1;

#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if storage::get_admin(&env).is_ok() {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        Ok(())
    }

    /// Creates a new continuous payment stream from sender to receiver.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if end_time <= start_time {
            return Err(Error::InvalidTimeRange);
        }

        // Transfer tokens from sender to contract
        let client = token::Client::new(&env, &token);
        client.transfer(&sender, &env.current_contract_address(), &total_amount);

        let stream_id = storage::increment_stream_id(&env);
        let stream = Stream {
            id: stream_id,
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            withdrawn_amount: 0,
            start_time,
            end_time,
            paused_duration: 0,
            last_paused_time: 0,
            state: StreamState::Active,
        };

        storage::save_stream(&env, &stream);
        storage::add_token_tvl(&env, &token, total_amount);
        storage::update_last_activity_time(&env);

        Ok(stream_id)
    }

    /// Retrieves stream details by ID.
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        storage::get_stream(&env, stream_id)
    }

    /// Pauses an active stream (only sender or admin).
    pub fn pause_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let mut stream = storage::get_stream(&env, stream_id)?;

        if caller != stream.sender {
            let admin = storage::get_admin(&env)?;
            if caller != admin {
                return Err(Error::Unauthorized);
            }
        }

        if stream.state != StreamState::Active {
            return Err(Error::StreamNotActive);
        }

        let now = env.ledger().timestamp();
        stream.state = StreamState::Paused;
        stream.last_paused_time = now;
        storage::save_stream(&env, &stream);
        storage::update_last_activity_time(&env);

        Ok(())
    }

    /// Unpauses a paused stream (only sender or admin).
    pub fn unpause_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let mut stream = storage::get_stream(&env, stream_id)?;

        if caller != stream.sender {
            let admin = storage::get_admin(&env)?;
            if caller != admin {
                return Err(Error::Unauthorized);
            }
        }

        if stream.state != StreamState::Paused {
            return Err(Error::StreamNotActive);
        }

        let now = env.ledger().timestamp();
        if stream.last_paused_time > 0 && now > stream.last_paused_time {
            let pause_delta = now - stream.last_paused_time;
            stream.paused_duration = stream.paused_duration.saturating_add(pause_delta);
        }

        stream.state = StreamState::Active;
        stream.last_paused_time = 0;
        storage::save_stream(&env, &stream);
        storage::update_last_activity_time(&env);

        Ok(())
    }

    /// Cancels an active or paused stream, distributing vested funds to receiver and unvested funds to sender.
    pub fn cancel_stream(env: Env, caller: Address, stream_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let mut stream = storage::get_stream(&env, stream_id)?;

        if caller != stream.sender && caller != stream.receiver {
            let admin = storage::get_admin(&env)?;
            if caller != admin {
                return Err(Error::Unauthorized);
            }
        }

        if stream.state == StreamState::Cancelled || stream.state == StreamState::Completed {
            return Err(Error::StreamAlreadyFinished);
        }

        let now = env.ledger().timestamp();
        let vested = math::calculate_vested_amount(&stream, now)?;
        let claimable = vested.saturating_sub(stream.withdrawn_amount);
        let refund_to_sender = stream.total_amount.saturating_sub(vested);
        let remaining_tvl_to_deduct = stream.total_amount.saturating_sub(stream.withdrawn_amount);

        let client = token::Client::new(&env, &stream.token);
        if claimable > 0 {
            client.transfer(&env.current_contract_address(), &stream.receiver, &claimable);
            stream.withdrawn_amount = stream.withdrawn_amount.saturating_add(claimable);
        }
        if refund_to_sender > 0 {
            client.transfer(&env.current_contract_address(), &stream.sender, &refund_to_sender);
        }

        // Deduct remaining stream value from TVL
        storage::sub_token_tvl(&env, &stream.token, remaining_tvl_to_deduct);

        stream.state = StreamState::Cancelled;
        storage::save_stream(&env, &stream);
        storage::update_last_activity_time(&env);

        Ok(())
    }

    /// Allows receiver to withdraw vested tokens.
    pub fn withdraw(
        env: Env,
        receiver: Address,
        stream_id: u64,
        amount: Option<i128>,
    ) -> Result<i128, Error> {
        receiver.require_auth();
        let mut stream = storage::get_stream(&env, stream_id)?;

        if receiver != stream.receiver {
            return Err(Error::Unauthorized);
        }
        if stream.state != StreamState::Active && stream.state != StreamState::Paused {
            return Err(Error::StreamNotActive);
        }

        let now = env.ledger().timestamp();
        let vested = math::calculate_vested_amount(&stream, now)?;
        let available = vested.saturating_sub(stream.withdrawn_amount);

        if available <= 0 {
            return Ok(0);
        }

        let to_withdraw = match amount {
            Some(requested) => {
                if requested <= 0 || requested > available {
                    return Err(Error::InvalidAmount);
                }
                requested
            }
            None => available,
        };

        let client = token::Client::new(&env, &stream.token);
        client.transfer(&env.current_contract_address(), &receiver, &to_withdraw);

        stream.withdrawn_amount = stream.withdrawn_amount.saturating_add(to_withdraw);
        if stream.withdrawn_amount >= stream.total_amount {
            stream.state = StreamState::Completed;
        }

        storage::save_stream(&env, &stream);
        storage::update_last_activity_time(&env);

        Ok(to_withdraw)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Issue #1477: Streaming Rate Calculator Utilities
    // ─────────────────────────────────────────────────────────────────────────────

    /// Calculates token streaming rate per second.
    /// Rate = total_amount / (end_time - start_time - paused_duration)
    pub fn get_stream_rate_per_second(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = storage::get_stream(&env, stream_id)?;
        math::calculate_rate_per_second(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
        )
    }

    /// Calculates token streaming rate per day (86,400 seconds).
    /// Rate = (total_amount * 86400) / (end_time - start_time - paused_duration)
    pub fn get_stream_rate_per_day(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = storage::get_stream(&env, stream_id)?;
        math::calculate_rate_per_day(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
        )
    }

    /// Calculates token streaming rate per month (2,592,000 seconds / 30 days).
    /// Rate = (total_amount * 2592000) / (end_time - start_time - paused_duration)
    pub fn get_stream_rate_per_month(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = storage::get_stream(&env, stream_id)?;
        math::calculate_rate_per_month(
            stream.total_amount,
            stream.start_time,
            stream.end_time,
            stream.paused_duration,
        )
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Issue #1476: Stream Search and Filter Queries
    // ─────────────────────────────────────────────────────────────────────────────

    /// Searches and filters streams by token, state, amount range, and time bounds.
    /// Supports pagination with offset and limit (capped at MAX_QUERY_LIMIT = 50).
    pub fn query_streams(
        env: Env,
        filter: StreamFilter,
        offset: u32,
        limit: u32,
    ) -> Vec<Stream> {
        let capped_limit = if limit == 0 {
            MAX_QUERY_LIMIT
        } else {
            limit.min(MAX_QUERY_LIMIT)
        };

        let total_streams = storage::get_stream_count(&env);
        let mut results = Vec::new(&env);
        let mut skipped = 0u32;

        for id in 1..=total_streams {
            if let Ok(stream) = storage::get_stream(&env, id) {
                // Token filter
                if let Some(ref token_filter) = filter.token {
                    if stream.token != *token_filter {
                        continue;
                    }
                }

                // State filter
                if let Some(state_filter) = filter.state {
                    if (stream.state as u32) != state_filter {
                        continue;
                    }
                }

                // Min amount filter
                if let Some(min_amt) = filter.min_amount {
                    if stream.total_amount < min_amt {
                        continue;
                    }
                }

                // Max amount filter
                if let Some(max_amt) = filter.max_amount {
                    if stream.total_amount > max_amt {
                        continue;
                    }
                }

                // Start time after filter
                if let Some(start_after) = filter.start_time_after {
                    if stream.start_time <= start_after {
                        continue;
                    }
                }

                // End time before filter
                if let Some(end_before) = filter.end_time_before {
                    if stream.end_time >= end_before {
                        continue;
                    }
                }

                // Handle pagination offset
                if skipped < offset {
                    skipped += 1;
                    continue;
                }

                results.push_back(stream);
                if results.len() >= capped_limit {
                    break;
                }
            }
        }

        results
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Issue #1475: Total Value Locked (TVL) Query
    // ─────────────────────────────────────────────────────────────────────────────

    /// Returns the Total Value Locked (TVL) for a specific token across all streams.
    pub fn get_token_tvl(env: Env, token: Address) -> i128 {
        storage::get_token_tvl(&env, &token)
    }

    /// Returns Total Value Locked (TVL) for all active tokens in the protocol.
    pub fn get_all_tokens_tvl(env: Env) -> Map<Address, i128> {
        storage::get_all_tokens_tvl(&env)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Issue #1502 & #1500: Health Checks and Contract Metrics
    // ─────────────────────────────────────────────────────────────────────────────

    /// Lightweight, read-only health check returning protocol operational status.
    pub fn health_check(env: Env) -> Result<ContractHealth, Error> {
        let is_paused = storage::is_protocol_paused(&env);
        let total_streams = storage::get_stream_count(&env);
        let last_activity_time = storage::get_last_activity_time(&env);

        let mut active_streams = 0u64;
        for id in 1..=total_streams {
            if let Ok(stream) = storage::get_stream(&env, id) {
                if stream.state == StreamState::Active {
                    active_streams += 1;
                }
            }
        }

        Ok(ContractHealth {
            is_paused,
            active_streams,
            total_streams,
            last_activity_time,
            version: PROTOCOL_VERSION,
        })
    }

    /// Real-time protocol metrics and analytics framework.
    pub fn get_metrics(env: Env) -> Result<ContractMetrics, Error> {
        let total_streams = storage::get_stream_count(&env);
        let mut active_streams = 0u64;
        let mut completed_streams = 0u64;
        let mut cancelled_streams = 0u64;
        let mut total_volume_streamed = 0i128;
        let mut total_withdrawn_volume = 0i128;

        for id in 1..=total_streams {
            if let Ok(stream) = storage::get_stream(&env, id) {
                match stream.state {
                    StreamState::Active => active_streams += 1,
                    StreamState::Paused => active_streams += 1,
                    StreamState::Completed => completed_streams += 1,
                    StreamState::Cancelled => cancelled_streams += 1,
                }
                total_volume_streamed = total_volume_streamed.saturating_add(stream.total_amount);
                total_withdrawn_volume = total_withdrawn_volume.saturating_add(stream.withdrawn_amount);
            }
        }

        Ok(ContractMetrics {
            total_streams,
            active_streams,
            completed_streams,
            cancelled_streams,
            total_volume_streamed,
            total_withdrawn_volume,
        })
    }
}
