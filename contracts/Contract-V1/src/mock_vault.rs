//! Test-only mock of an external lending vault, used to exercise the [`VaultInterface`]
//! integration in [`vault`](crate::vault) without a real money-market protocol.
#![cfg(test)]

use soroban_sdk::{contract, contractimpl, contracterror, symbol_short, token, Address, Env};

/// Error conditions returned by [`MockVault`] entry points.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VaultError {
    /// Withdrawals are currently paused by the vault admin.
    WithdrawalsPaused = 1,
    /// The caller does not have enough balance to withdraw the requested amount.
    InsufficientBalance = 2,
    /// The caller is not the vault admin.
    Unauthorized = 3,
}

/// Mock vault contract for testing external yield integration.
///
/// Simulates a lending pool that tracks per-depositor balances, can apply a
/// configurable yield rate, and can pause/resume withdrawals.
#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    /// Initialize the vault
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&symbol_short!("admin"), &admin);
        env.storage().instance().set(&symbol_short!("paused"), &false);
    }

    /// Deposit tokens into the vault
    /// Returns the amount deposited
    pub fn deposit(env: Env, from: Address, token: Address, amount: i128) -> Result<i128, VaultError> {
        from.require_auth();

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);

        // Track balance for this depositor
        let balance_key = (symbol_short!("balance"), from.clone());
        let current_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        let new_balance = current_balance + amount;
        env.storage().instance().set(&balance_key, &new_balance);

        Ok(new_balance)
    }

    /// Withdraw tokens from the vault
    /// Fails if withdrawals are paused
    pub fn withdraw(env: Env, to: Address, token: Address, amount: i128) -> Result<i128, VaultError> {
        to.require_auth();

        // Check if withdrawals are paused
        let is_paused: bool = env.storage().instance().get(&symbol_short!("paused")).unwrap_or(false);
        if is_paused {
            return Err(VaultError::WithdrawalsPaused);
        }

        // Check balance
        let balance_key = (symbol_short!("balance"), to.clone());
        let current_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        
        if current_balance < amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Update balance
        let new_balance = current_balance - amount;
        env.storage().instance().set(&balance_key, &new_balance);

        // Transfer tokens
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        Ok(new_balance)
    }

    /// Get the current balance for an address (including simulated yield)
    pub fn get_balance(env: Env, address: Address) -> i128 {
        let balance_key = (symbol_short!("balance"), address);
        let base_balance: i128 = env.storage().instance().get(&balance_key).unwrap_or(0);
        
        // Apply yield multiplier if set
        let yield_rate: i128 = env.storage().instance().get(&symbol_short!("yield")).unwrap_or(0);
        if yield_rate > 0 {
            base_balance + (base_balance * yield_rate / 10000) // basis points
        } else {
            base_balance
        }
    }

    /// Pause withdrawals (admin only)
    pub fn pause_withdrawals(env: Env, admin: Address) -> Result<(), VaultError> {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&symbol_short!("admin"))
            .ok_or(VaultError::Unauthorized)?;
        
        if stored_admin != admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage().instance().set(&symbol_short!("paused"), &true);
        Ok(())
    }

    /// Resume withdrawals (admin only)
    pub fn resume_withdrawals(env: Env, admin: Address) -> Result<(), VaultError> {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&symbol_short!("admin"))
            .ok_or(VaultError::Unauthorized)?;
        
        if stored_admin != admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage().instance().set(&symbol_short!("paused"), &false);
        Ok(())
    }

    /// Set yield rate in basis points (e.g., 500 = 5%)
    /// This simulates yield generation
    pub fn set_yield_rate(env: Env, admin: Address, rate_bps: i128) -> Result<(), VaultError> {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&symbol_short!("admin"))
            .ok_or(VaultError::Unauthorized)?;
        
        if stored_admin != admin {
            return Err(VaultError::Unauthorized);
        }

        env.storage().instance().set(&symbol_short!("yield"), &rate_bps);
        Ok(())
    }

    /// Check if withdrawals are paused
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&symbol_short!("paused")).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, token, Env};

    fn setup_vault_test() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_admin = Address::generate(&env);

        // Deploy token
        let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let token_client = token::StellarAssetClient::new(&env, &token_address);
        token_client.mint(&user, &10000);

        // Deploy vault
        let vault_id = env.register(MockVault, ());
        let vault_client = MockVaultClient::new(&env, &vault_id);
        vault_client.initialize(&admin);

        (env, admin, user, token_address, vault_id)
    }

    #[test]
    fn test_deposit_and_withdraw() {
        let (_env, _admin, user, token_address, vault_id) = setup_vault_test();
        let vault = MockVaultClient::new(&_env, &vault_id);

        // Deposit
        let balance = vault.deposit(&user, &token_address, &1000).unwrap();
        assert_eq!(balance, 1000);

        // Check balance
        let stored_balance = vault.get_balance(&user);
        assert_eq!(stored_balance, 1000);

        // Withdraw
        let result = vault.withdraw(&user, &token_address, &500);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 500);
    }

    #[test]
    fn test_pause_withdrawals() {
        let (_env, admin, user, token_address, vault_id) = setup_vault_test();
        let vault = MockVaultClient::new(&_env, &vault_id);

        // Deposit
        vault.deposit(&user, &token_address, &1000).unwrap();

        // Pause withdrawals
        let result = vault.pause_withdrawals(&admin);
        assert!(result.is_ok());
        assert!(vault.is_paused());

        // Try to withdraw - should fail
        let withdraw_result = vault.withdraw(&user, &token_address, &500);
        assert!(withdraw_result.is_err());
    }

    #[test]
    fn test_yield_generation() {
        let (_env, admin, user, token_address, vault_id) = setup_vault_test();
        let vault = MockVaultClient::new(&_env, &vault_id);

        // Deposit
        vault.deposit(&user, &token_address, &1000).unwrap();

        // Set 10% yield (1000 basis points)
        vault.set_yield_rate(&admin, &1000).unwrap();

        // Check balance with yield
        let balance_with_yield = vault.get_balance(&user);
        assert_eq!(balance_with_yield, 1100); // 1000 + 10%
    }
}
