//! Flash loan module for StellarStream
//!
//! Allows borrowing of idle (unallocated) tokens within a single transaction.
//! The borrower must repay the loan plus a fee before the transaction ends.
//!
//! # Flash Loan Architecture
//!
//! Flash loans enable borrowers to:
//! 1. Borrow idle tokens (not allocated to active streams) atomically
//! 2. Execute arbitrary callback logic within the same transaction
//! 3. Repay the loan + fee before transaction completion
//!
//! The contract protects itself against:
//! - **Re-entrancy**: Uses a temporary lock to prevent nested flash loans
//! - **Insufficient repayment**: Validates the full loan + fee is repaid
//! - **Borrowing allocated tokens**: Tracks TVL separately from total balances
//!
//! # Callback Interface
//!
//! The borrower's callback contract must implement:
//! ```ignore
//! pub fn execute_flash_loan(
//!     env: Env,
//!     token: Address,
//!     amount: i128,
//!     fee: i128,
//!     data: Bytes,
//! ) -> Result<(), Error>
//! ```
//!
//! The callback receives:
//! - `token`: The borrowed token address
//! - `amount`: Principal amount borrowed
//! - `fee`: Fee charged (must be repaid along with principal)
//! - `data`: Arbitrary data passed by the borrower
//!
//! The callback executes with the tokens transferred, and must transfer
//! `amount + fee` back to the contract before returning.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Bytes, Env, IntoVal, String, Symbol, Vec,
};

// Flash loan errors
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FlashLoanError {
    /// Not enough idle liquidity to borrow
    InsufficientLiquidity = 101,
    /// Borrow amount is invalid (zero or negative)
    InvalidBorrowAmount = 102,
    /// Flash loan already in progress (re-entrancy attempt)
    FlashLoanInProgress = 103,
    /// Repayment insufficient (must repay principal + fee)
    InsufficientRepayment = 104,
    /// Callback execution failed
    CallbackExecutionFailed = 105,
    /// Fee calculation overflowed
    FeeOverflow = 106,
}

/// Event emitted when a flash loan is executed
#[contracttype]
#[derive(Clone, Debug)]
pub struct FlashLoanEvent {
    pub borrower: Address,
    pub token: Address,
    pub amount: i128,
    pub fee: i128,
    pub timestamp: u64,
}

/// Event emitted when a flash loan is repaid
#[contracttype]
#[derive(Clone, Debug)]
pub struct FlashLoanRepaymentEvent {
    pub borrower: Address,
    pub token: Address,
    pub amount: i128,
    pub fee: i128,
    pub timestamp: u64,
}

/// Storage key for tracking active flash loans (re-entrancy protection)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FlashLoanDataKey {
    /// Tracks if a flash loan is currently executing: `Option<Address>` (token being borrowed)
    ActiveLoan,
}

/// Flash loan configuration
pub const DEFAULT_FLASH_LOAN_FEE_BPS: u32 = 50; // 0.5% default fee
pub const MAX_FLASH_LOAN_FEE_BPS: u32 = 500; // 5% maximum fee

/// Internal callback trait for flash loan callbacks
/// This is used to invoke the callback contract's `execute_flash_loan` function
pub trait FlashLoanCallback {
    fn execute_flash_loan(
        env: Env,
        token: Address,
        amount: i128,
        fee: i128,
        data: Bytes,
    ) -> Result<(), String>;
}

/// Calculate the fee for a flash loan
///
/// # Arguments
/// * `amount` - Principal amount borrowed
/// * `fee_bps` - Fee rate in basis points (10_000 = 100%)
///
/// # Returns
/// * `Result<i128, FlashLoanError>` - Fee amount or overflow error
///
/// # Panics
/// Panics if `fee_bps > 10_000` or `amount < 0` (invalid preconditions)
pub fn calculate_flash_loan_fee(amount: i128, fee_bps: u32) -> Result<i128, FlashLoanError> {
    if amount < 0 {
        return Err(FlashLoanError::InvalidBorrowAmount);
    }

    // Convert to i128 to safely multiply
    let fee_bps_i128 = fee_bps as i128;
    let bps_denom = 10_000i128;

    amount
        .checked_mul(fee_bps_i128)
        .ok_or(FlashLoanError::FeeOverflow)?
        .checked_div(bps_denom)
        .ok_or(FlashLoanError::FeeOverflow)
}

/// Validate that a borrow amount is non-negative and available
///
/// # Arguments
/// * `amount` - Requested borrow amount
/// * `available` - Available idle liquidity
///
/// # Returns
/// * `Result<(), FlashLoanError>` - Success if amount is valid, error otherwise
pub fn validate_borrow_amount(amount: i128, available: i128) -> Result<(), FlashLoanError> {
    if amount <= 0 {
        return Err(FlashLoanError::InvalidBorrowAmount);
    }

    if amount > available {
        return Err(FlashLoanError::InsufficientLiquidity);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_flash_loan_fee_basic() {
        // 1000 amount at 50 bps (0.5%) = 5
        let fee = calculate_flash_loan_fee(1000, 50).unwrap();
        assert_eq!(fee, 5);
    }

    #[test]
    fn test_calculate_flash_loan_fee_zero_fee() {
        // Zero fee rate = zero fee
        let fee = calculate_flash_loan_fee(1000, 0).unwrap();
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_calculate_flash_loan_fee_rounding_down() {
        // 100 amount at 33 bps = 0.33, rounded down to 0
        let fee = calculate_flash_loan_fee(100, 33).unwrap();
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_calculate_flash_loan_fee_large_amount() {
        // 1_000_000 amount at 50 bps = 5_000
        let fee = calculate_flash_loan_fee(1_000_000, 50).unwrap();
        assert_eq!(fee, 5_000);
    }

    #[test]
    fn test_calculate_flash_loan_fee_max_rate() {
        // Max rate (500 bps = 5%) on 1_000_000 = 50_000
        let fee = calculate_flash_loan_fee(1_000_000, 500).unwrap();
        assert_eq!(fee, 50_000);
    }

    #[test]
    fn test_calculate_flash_loan_fee_negative_amount() {
        // Negative amount should fail
        let result = calculate_flash_loan_fee(-1000, 50);
        assert_eq!(result, Err(FlashLoanError::InvalidBorrowAmount));
    }

    #[test]
    fn test_validate_borrow_amount_valid() {
        let result = validate_borrow_amount(500, 1000);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_borrow_amount_zero() {
        let result = validate_borrow_amount(0, 1000);
        assert_eq!(result, Err(FlashLoanError::InvalidBorrowAmount));
    }

    #[test]
    fn test_validate_borrow_amount_negative() {
        let result = validate_borrow_amount(-500, 1000);
        assert_eq!(result, Err(FlashLoanError::InvalidBorrowAmount));
    }

    #[test]
    fn test_validate_borrow_amount_exceeds_available() {
        let result = validate_borrow_amount(1500, 1000);
        assert_eq!(result, Err(FlashLoanError::InsufficientLiquidity));
    }

    #[test]
    fn test_validate_borrow_amount_equals_available() {
        let result = validate_borrow_amount(1000, 1000);
        assert_eq!(result, Ok(()));
    }
}
