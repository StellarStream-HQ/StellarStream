//! The contract invocation pipeline.
//!
//! Every write goes through one path — build, simulate, assemble with the
//! footprint and resource fee the simulation reported, sign, submit, then poll
//! for confirmation. Submitting without simulating first is how you get
//! transactions that fail on-chain after the fee has been taken, so there is
//! deliberately no shortcut around it.
//!
//! Reads use the same builder but stop after simulation, so querying costs
//! nothing and needs no key.

use std::time::Duration;

use soroban_client::account::Account;
use soroban_client::contract::{ContractBehavior, Contracts};
use soroban_client::keypair::KeypairBehavior;
use soroban_client::transaction::{AccountBehavior, TransactionBehavior, TransactionBuilderBehavior};
use soroban_client::transaction_builder::{TransactionBuilder, TIMEOUT_INFINITE};
use soroban_client::xdr::ScVal;
use soroban_client::soroban_rpc::TransactionStatus;
use soroban_client::{Options, Server};

use crate::error::{CliError, Result};
use crate::progress::Progress;
use crate::settings::Settings;
use crate::signer::Signer;

/// How long to wait for a submitted transaction to be confirmed.
const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(60);

/// Base fee in stroops. Simulation raises this with the resource fee.
const BASE_FEE: u32 = 1_000;

/// A connection to one contract on one network.
pub struct ContractClient {
    server: Server,
    contract: Contracts,
    passphrase: String,
}

impl ContractClient {
    pub fn new(settings: &Settings) -> Result<Self> {
        let contract_id = settings.require_contract_id()?;
        let server = Server::new(
            &settings.rpc_url,
            Options {
                allow_http: settings.rpc_url.starts_with("http://"),
                ..Default::default()
            },
        )
        .map_err(|e| {
            CliError::with_hint(
                format!("could not reach the RPC endpoint: {e}"),
                format!("check --rpc-url (currently {})", settings.rpc_url),
            )
        })?;

        let contract = Contracts::new(contract_id).map_err(|_| {
            CliError::invalid_address(contract_id, "it is not a valid contract address")
        })?;

        Ok(ContractClient {
            server,
            contract,
            passphrase: settings.network.passphrase().to_string(),
        })
    }

    /// Call a read-only method by simulating it. No key, no fee, no submission.
    pub async fn read(&self, method: &str, args: Vec<ScVal>) -> Result<ScVal> {
        // Simulation needs a source account but never a signature.
        let placeholder = soroban_client::keypair::Keypair::random()
            .map_err(|e| CliError::Network(format!("could not build a simulation source: {e}")))?;
        let mut account = Account::new(&placeholder.public_key(), "0")
            .map_err(|e| CliError::Network(format!("could not build a simulation source: {e}")))?;

        let tx = TransactionBuilder::new(&mut account, &self.passphrase, None)
            .fee(BASE_FEE)
            .add_operation(self.contract.call(method, Some(args)))
            .set_timeout(TIMEOUT_INFINITE)
            .map_err(|e| CliError::Network(format!("could not build the call: {e}")))?
            .build();

        let simulation = self
            .server
            .simulate_transaction(&tx, None)
            .await
            .map_err(|e| CliError::Network(format!("simulation failed: {e}")))?;

        if let Some(error) = simulation.error.clone() {
            return Err(contract_error(method, &error));
        }

        simulation
            .to_result()
            .map(|(value, _auth)| value)
            .ok_or_else(|| CliError::Contract(format!("{method} returned no value")))
    }

    /// Invoke a state-changing method: simulate, assemble, sign, submit, poll.
    pub async fn invoke(
        &self,
        method: &str,
        args: Vec<ScVal>,
        signer: &Signer,
        progress: &Progress,
    ) -> Result<InvokeOutcome> {
        progress.step("Loading account");
        let account_id = signer.public_key();
        let account = self
            .server
            .get_account(&account_id)
            .await
            .map_err(|e| {
                CliError::with_hint(
                    format!("could not load account {account_id}: {e}"),
                    "on testnet, fund it first: https://friendbot.stellar.org",
                )
            })?;
        let mut account = account;

        let tx = TransactionBuilder::new(&mut account, &self.passphrase, None)
            .fee(BASE_FEE)
            .add_operation(self.contract.call(method, Some(args)))
            .set_timeout(TIMEOUT_INFINITE)
            .map_err(|e| CliError::Network(format!("could not build the call: {e}")))?
            .build();

        // Simulate and assemble: this is what attaches the footprint and the
        // resource fee. Skipping it produces transactions that fail on-chain.
        progress.step("Simulating");
        let mut prepared = self
            .server
            .prepare_transaction(&tx)
            .await
            .map_err(|e| contract_error(method, &e.to_string()))?;

        progress.step("Signing");
        prepared.sign(&[signer.keypair().clone()]);

        progress.step("Submitting");
        let sent = self
            .server
            .send_transaction(prepared)
            .await
            .map_err(|e| CliError::Network(format!("submission failed: {e}")))?;
        let hash = sent.hash.clone();

        progress.step("Waiting for confirmation");
        let confirmed = self
            .server
            .wait_transaction(&hash, CONFIRMATION_TIMEOUT)
            .await
            .map_err(|(e, _)| {
                CliError::with_hint(
                    format!("could not confirm transaction {hash}: {e}"),
                    format!("it may still land — check the hash {hash} in an explorer"),
                )
            })?;

        if confirmed.status == TransactionStatus::Failed {
            return Err(CliError::with_hint(
                format!("{method} was submitted but failed on-chain"),
                format!("inspect transaction {hash} for the failure detail"),
            ));
        }

        // The contract's return value lives in the transaction meta, not the
        // result.
        let return_value = confirmed.to_result_meta().and_then(|(_meta, value)| value);
        Ok(InvokeOutcome { hash, return_value })
    }
}

/// The result of a submitted invocation.
pub struct InvokeOutcome {
    pub hash: String,
    pub return_value: Option<ScVal>,
}

/// Turn a raw contract failure into something a user can act on.
///
/// Soroban reports contract errors by numeric code, which is meaningless on its
/// own, so the codes this contract defines are named here.
fn contract_error(method: &str, raw: &str) -> CliError {
    if let Some(code) = extract_error_code(raw) {
        if let Some(explanation) = describe_contract_error(code) {
            return CliError::with_hint(
                format!("{method} failed: {explanation}"),
                format!("contract error #{code}"),
            );
        }
    }
    CliError::Contract(format!("{method} failed: {raw}"))
}

/// Pull `Error(Contract, #N)` out of an RPC error string.
fn extract_error_code(raw: &str) -> Option<u32> {
    let marker = raw.find('#')?;
    let digits: String = raw[marker + 1..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Names for the contract's error codes, from `contracts/Contract-V1/src/lib.rs`.
fn describe_contract_error(code: u32) -> Option<&'static str> {
    Some(match code {
        1 => "the contract is already initialized",
        2 => "the start time must be before the end time",
        3 => "the amount must be greater than zero",
        4 => "no stream with that id exists",
        5 => "this account is not allowed to do that",
        6 => "the stream is already cancelled",
        7 => "insufficient balance",
        8 => "already paused",
        9 => "not paused",
        10 => "the contract is paused",
        11 => "re-entrancy was detected",
        12 => "this account is not an admin",
        13 => "this account is not a pauser",
        14 => "the stream is paused",
        15 => "the withdrawal is larger than the unlocked amount",
        16 => "unknown vesting curve",
        17 => "unknown role",
        21 => "the stream is soulbound and cannot be transferred",
        22 => "this address is restricted",
        26 => "the stream is not paused",
        27 => "the calculation overflowed",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_contract_error_code() {
        assert_eq!(
            extract_error_code("HostError: Error(Contract, #4)"),
            Some(4)
        );
        assert_eq!(extract_error_code("no code here"), None);
    }

    #[test]
    fn names_the_codes_the_contract_defines() {
        assert_eq!(
            describe_contract_error(4),
            Some("no stream with that id exists")
        );
        assert_eq!(
            describe_contract_error(10),
            Some("the contract is paused")
        );
        assert_eq!(describe_contract_error(999), None);
    }

    #[test]
    fn a_known_code_becomes_a_readable_message() {
        let err = contract_error("withdraw", "HostError: Error(Contract, #4)");
        assert!(err.to_string().contains("no stream with that id exists"));
        assert!(err.hint().unwrap().contains("#4"));
    }

    #[test]
    fn an_unknown_failure_keeps_the_raw_detail() {
        let err = contract_error("withdraw", "connection reset");
        assert!(err.to_string().contains("connection reset"));
    }
}
