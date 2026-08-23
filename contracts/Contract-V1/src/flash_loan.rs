//! Flash loan receiver interface.
//!
//! Contracts that wish to borrow via Contract-V1's flash loan facility implement
//! [`FlashLoanReceiver`] so the lending contract can hand control back to them mid-transaction.

use soroban_sdk::{Address, Bytes, Env};

/// Callback interface for contracts that receive Contract-V1 flash loans.
///
/// The lending contract transfers the borrowed amount to the receiver, invokes
/// [`execute_operation`](FlashLoanReceiver::execute_operation), and then requires the
/// receiver to have transferred back `amount + fee` before the transaction ends —
/// otherwise the whole transaction (including the initial transfer) is rolled back.
#[allow(dead_code)]
pub trait FlashLoanReceiver {
    /// Invoked by the lending contract after the borrowed funds have been transferred.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `initiator` - Address that initiated the flash loan
    /// * `token` - Address of the token contract being borrowed
    /// * `amount` - Principal amount borrowed
    /// * `fee` - Fee owed in addition to the principal
    /// * `params` - Opaque, caller-defined parameters forwarded from the loan request
    ///
    /// # Returns
    /// `true` if the receiver accepts the loan and will repay `amount + fee` before the
    /// transaction ends; `false` (or a panic) aborts the loan.
    fn execute_operation(
        env: Env,
        initiator: Address,
        token: Address,
        amount: i128,
        fee: i128,
        params: Bytes,
    ) -> bool;
}
