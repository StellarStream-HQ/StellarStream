//! Integration with external lending vaults used to earn yield on idle stream principal.

use soroban_sdk::{contractclient, Address, Env};

/// Standard Soroban lending vault interface, compatible with common money-market
/// protocols. [`VaultClient`] is the generated client used to call implementers of
/// this trait.
#[allow(dead_code)]
#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    /// Deposits `amount` tokens from `from` into the vault.
    ///
    /// # Returns
    /// The number of shares/receipt tokens minted for the deposit.
    fn deposit(env: Env, from: Address, amount: i128) -> i128;

    /// Redeems `shares` from the vault, sending the underlying tokens to `to`.
    ///
    /// # Returns
    /// The amount of underlying tokens withdrawn.
    fn withdraw(env: Env, to: Address, shares: i128) -> i128;

    /// Returns the current value of `shares` in underlying tokens.
    fn get_value(env: Env, shares: i128) -> i128;
}

/// Deposits stream principal into an approved vault to earn yield.
///
/// Transfers `amount` of `token` from this contract to `vault`, then calls
/// [`VaultInterface::deposit`] on the vault to mint shares owned by this contract.
///
/// # Arguments
/// * `env` - The contract execution environment
/// * `vault` - Address of the vault contract implementing [`VaultInterface`]
/// * `token` - Address of the token being deposited
/// * `amount` - Amount to deposit; must be greater than zero
///
/// # Returns
/// The number of vault shares received.
///
/// # Errors
/// Returns `Err(())` if `amount` is not positive or the vault returns zero or
/// negative shares.
pub fn deposit_to_vault(
    env: &Env,
    vault: &Address,
    token: &Address,
    amount: i128,
) -> Result<i128, ()> {
    if amount <= 0 {
        return Err(());
    }

    // Transfer tokens to vault via contract
    let token_client = crate::token::Client::new(env, token);
    token_client.transfer(&env.current_contract_address(), vault, &amount);

    // Call vault deposit and get shares
    let vault_client = VaultClient::new(env, vault);
    let shares = vault_client.deposit(&env.current_contract_address(), &amount);

    if shares <= 0 {
        return Err(());
    }

    Ok(shares)
}

/// Redeems vault shares back into the underlying token.
///
/// # Arguments
/// * `env` - The contract execution environment
/// * `vault` - Address of the vault contract implementing [`VaultInterface`]
/// * `shares` - Number of shares to redeem; must be greater than zero
///
/// # Returns
/// The amount of underlying tokens received.
///
/// # Errors
/// Returns `Err(())` if `shares` is not positive or the vault returns a zero or
/// negative amount.
#[allow(dead_code)]
pub fn withdraw_from_vault(env: &Env, vault: &Address, shares: i128) -> Result<i128, ()> {
    if shares <= 0 {
        return Err(());
    }

    let vault_client = VaultClient::new(env, vault);
    let amount = vault_client.withdraw(&env.current_contract_address(), &shares);

    if amount <= 0 {
        return Err(());
    }

    Ok(amount)
}

/// Queries the current underlying-token value of a number of vault shares.
///
/// # Arguments
/// * `env` - The contract execution environment
/// * `vault` - Address of the vault contract implementing [`VaultInterface`]
/// * `shares` - Number of shares to value
///
/// # Returns
/// `0` if `shares` is not positive; otherwise the vault-reported value. This
/// function is infallible and never returns `Err`.
#[allow(dead_code)]
pub fn get_vault_value(env: &Env, vault: &Address, shares: i128) -> Result<i128, ()> {
    if shares <= 0 {
        return Ok(0);
    }

    let vault_client = VaultClient::new(env, vault);
    let value = vault_client.get_value(&shares);

    Ok(value)
}
