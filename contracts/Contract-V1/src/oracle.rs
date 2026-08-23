//! Price oracle integration used for USD-denominated stream calculations.

use soroban_sdk::{Address, Env};

/// Fetches the latest price from an external oracle contract, rejecting stale or
/// non-positive readings.
///
/// # Arguments
/// * `env` - The contract execution environment
/// * `oracle` - Address of the oracle contract to query; must expose a `price()`
///   function returning `(price: i128, timestamp: u64)`
/// * `max_staleness` - Maximum allowed age, in seconds, of the oracle's reported price
///
/// # Returns
/// The current price (7 decimals) on success.
///
/// # Errors
/// Returns `Err(())` if the reported price is older than `max_staleness` or if the
/// price is zero or negative.
#[allow(dead_code)]
pub fn get_price(env: &Env, oracle: &Address, max_staleness: u64) -> Result<i128, ()> {
    // Call oracle contract to get latest price
    // Oracle interface: get_price() -> (price: i128, timestamp: u64)
    let current_time = env.ledger().timestamp();

    // Invoke oracle contract
    let result: (i128, u64) = env.invoke_contract(
        oracle,
        &soroban_sdk::symbol_short!("price"),
        soroban_sdk::vec![env],
    );

    let (price, timestamp) = result;

    // Check staleness
    if current_time - timestamp > max_staleness {
        return Err(());
    }

    // Validate price is positive
    if price <= 0 {
        return Err(());
    }

    Ok(price)
}

/// Converts a USD amount into a token amount at a given price.
///
/// # Arguments
/// * `usd_amount` - USD value, with 7 decimals
/// * `price` - Token price in USD, with 7 decimals (as returned by [`get_price`])
///
/// # Returns
/// The equivalent token amount, with 7 decimals.
///
/// # Errors
/// Returns `Err(())` if `price` is zero or negative, or if `usd_amount * 10^7` overflows.
#[allow(dead_code)]
pub fn calculate_token_amount(usd_amount: i128, price: i128) -> Result<i128, ()> {
    if price <= 0 {
        return Err(());
    }

    // token_amount = (usd_amount * 10^7) / price
    // Both are in 7 decimals, so we multiply by 10^7 to maintain precision
    let numerator = usd_amount.checked_mul(10_000_000).ok_or(())?;
    Ok(numerator / price)
}
