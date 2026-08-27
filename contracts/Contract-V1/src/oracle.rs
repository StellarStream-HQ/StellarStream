//! Oracle integration for USD-pegged streams.
//!
//! This module provides price fetching and validation for converting USD amounts
//! to token amounts using an oracle price feed. All price queries are validated
//! against slippage bounds to prevent unfavorable execution.

use soroban_sdk::{contractclient, Address, Env};

/// Oracle contract interface for querying token prices.
///
/// The oracle is assumed to implement a standard price feed interface that
/// returns the token's current USD price in basis points.
#[contractclient(name = "OracleClient")]
pub trait Oracle {
    /// Get the current USD price for a token.
    ///
    /// # Arguments
    /// - `token`: The address of the token to price.
    ///
    /// # Returns
    /// The token's USD price in basis points (10_000 = $1.00).
    fn get_price(env: Env, token: Address) -> i128;
}

/// Fetch the USD price of a token from the oracle with validation.
///
/// # Arguments
/// - `env`: The contract environment.
/// - `oracle`: Address of the oracle contract.
/// - `token`: Address of the token to price.
/// - `min_price`: Minimum acceptable price in basis points.
/// - `max_price`: Maximum acceptable price in basis points.
///
/// # Returns
/// The oracle price in basis points if within the specified bounds.
///
/// # Errors
/// - Returns `Error::OraclePriceOutOfBounds` if price < min_price or > max_price.
/// - Propagates oracle contract errors.
pub fn fetch_price_with_slippage(
    env: &Env,
    oracle: &Address,
    token: &Address,
    min_price: i128,
    max_price: i128,
) -> Result<i128, crate::Error> {
    let oracle_client = OracleClient::new(env, oracle);
    let price = oracle_client.get_price(token);

    // Validate price is within acceptable bounds
    if price < min_price || price > max_price {
        return Err(crate::Error::OraclePriceOutOfBounds);
    }

    Ok(price)
}

/// Convert USD amount to token amount using the provided price.
///
/// # Arguments
/// - `usd_amount`: The USD amount in basis points (10_000 = $1.00).
/// - `price_usd_bps`: The token's USD price in basis points.
///
/// # Returns
/// The token amount, or an overflow error if the multiplication exceeds i128 range.
///
/// # Formula
/// `token_amount = (usd_amount * 10_000) / price_usd_bps`
///
/// The formula uses a 10_000 multiplier because both values are in basis points.
pub fn usd_to_tokens(usd_amount: i128, price_usd_bps: i128) -> Result<i128, crate::Error> {
    // Prevent division by zero
    if price_usd_bps == 0 {
        return Err(crate::Error::OraclePriceInvalid);
    }

    // Use checked multiplication to detect overflow
    let multiplied = usd_amount
        .checked_mul(10_000)
        .ok_or(crate::Error::Overflow)?;

    // Divide to get token amount (uses integer division, rounded down)
    Ok(multiplied / price_usd_bps)
}

/// Calculate the USD value of a token amount using the provided price.
///
/// # Arguments
/// - `token_amount`: The token amount.
/// - `price_usd_bps`: The token's USD price in basis points.
///
/// # Returns
/// The USD amount in basis points.
pub fn tokens_to_usd(token_amount: i128, price_usd_bps: i128) -> Result<i128, crate::Error> {
    if price_usd_bps == 0 {
        return Err(crate::Error::OraclePriceInvalid);
    }

    let multiplied = token_amount
        .checked_mul(price_usd_bps)
        .ok_or(crate::Error::Overflow)?;

    Ok(multiplied / 10_000)
}
