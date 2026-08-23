//! Voting power derived from streamed token balances.
//!
//! A stream's voting power tracks the portion of its total amount that has vested
//! (linearly, between `start_time` and `end_time`) but has not yet been withdrawn.

use soroban_sdk::{Address, Env};

/// Returns the voting power currently available to a stream's receiver.
///
/// Voting power equals the linearly-vested (unlocked) amount at `current_time` minus
/// whatever has already been withdrawn. A closed stream always has zero voting power.
///
/// # Arguments
/// * `_env` - The contract execution environment (currently unused)
/// * `stream` - The stream to compute voting power for
/// * `current_time` - Unix timestamp to evaluate vesting at
///
/// # Returns
/// The available voting power, in the stream's token's smallest unit.
#[allow(dead_code)]
pub fn get_voting_power(_env: &Env, stream: &crate::types::Stream, current_time: u64) -> i128 {
    if stream.state == crate::types::StreamState::Closed {
        return 0;
    }

    // Calculate unlocked amount
    let unlocked = if current_time < stream.start_time {
        0
    } else if current_time >= stream.end_time {
        stream.total_amount
    } else {
        let elapsed = (current_time - stream.start_time) as i128;
        let duration = (stream.end_time - stream.start_time) as i128;
        (stream.total_amount * elapsed) / duration
    };

    // Return unlocked minus already withdrawn
    unlocked - stream.withdrawn_amount
}

/// Returns a stream's total remaining balance (both locked and unlocked amounts).
///
/// # Arguments
/// * `stream` - The stream to compute the balance for
///
/// # Returns
/// `total_amount - withdrawn_amount`, or `0` if the stream is closed.
#[allow(dead_code)]
pub fn get_total_balance(stream: &crate::types::Stream) -> i128 {
    if stream.state == crate::types::StreamState::Closed {
        return 0;
    }
    stream.total_amount - stream.withdrawn_amount
}

/// Checks whether `caller` holds the ownership receipt for a stream and therefore may
/// delegate that stream's voting power.
///
/// # Arguments
/// * `env` - The contract execution environment
/// * `stream_id` - ID of the stream to check
/// * `caller` - Address to check delegation rights for
///
/// # Returns
/// `true` if `caller` owns the stream's receipt.
///
/// # Panics
/// Panics if no stream/receipt exists for `stream_id`.
#[allow(dead_code)]
pub fn can_delegate(env: &Env, stream_id: u64, caller: &Address) -> bool {
    let receipt: crate::types::StreamReceipt = env
        .storage()
        .instance()
        .get(&(crate::storage::RECEIPT, stream_id))
        .unwrap_or_else(|| panic!("Stream not found"));

    receipt.owner == *caller
}
