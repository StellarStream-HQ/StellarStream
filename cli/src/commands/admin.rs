//! Administrative commands.
//!
//! These sign with privileged keys, so both of them confirm before submitting
//! on a live network.

use soroban_client::xdr::{ScAddress, ScVal};
use std::str::FromStr;

use crate::cli::{GrantRoleArgs, SetFeeArgs};
use crate::client::ContractClient;
use crate::error::{CliError, Result};
use crate::output;
use crate::parse::parse_address;
use crate::progress::Progress;
use crate::prompt;
use crate::settings::Settings;
use crate::signer::Signer;

/// Highest fee the contract accepts, mirrored here so a typo is caught before
/// it costs a transaction.
const MAX_FEE_BPS: u32 = 1_000;

fn address_arg(address: &str) -> Result<ScVal> {
    let parsed = ScAddress::from_str(address)
        .map_err(|_| CliError::invalid_address(address, "it could not be encoded"))?;
    Ok(ScVal::Address(parsed))
}

/// `stellarstream admin grant-role`
pub async fn grant_role(
    args: GrantRoleArgs,
    settings: &Settings,
    resolve_signer: &dyn Fn() -> Result<Signer>,
    client: &ContractClient,
    assume_yes: bool,
) -> Result<String> {
    let account = parse_address(&args.account)?;
    let role = args.role;

    let question = format!(
        "Grant {:?} to {} on {}?",
        role,
        output::abbreviate(&account),
        settings.network
    );
    if !prompt::confirm(&question, assume_yes)? {
        return Err(CliError::new("cancelled"));
    }

    let signer = resolve_signer()?;
    let progress = Progress::for_output(settings.json);
    let outcome = client
        .invoke(
            "grant_role",
            vec![
                address_arg(&signer.public_key())?,
                address_arg(&account)?,
                ScVal::U32(role.as_u32()),
            ],
            &signer,
            &progress,
        )
        .await?;
    progress.finish();

    if settings.json {
        return output::to_json(&serde_json::json!({
            "account": account,
            "role": format!("{role:?}"),
            "transaction": outcome.hash,
        }));
    }

    Ok(format!(
        "{}\n  Account:     {}\n  Role:        {:?}\n  Transaction: {}",
        output::success("Role granted"),
        account,
        role,
        outcome.hash
    ))
}

/// `stellarstream admin set-fee`
pub async fn set_fee(
    args: SetFeeArgs,
    settings: &Settings,
    resolve_signer: &dyn Fn() -> Result<Signer>,
    client: &ContractClient,
    assume_yes: bool,
) -> Result<String> {
    if args.bps > MAX_FEE_BPS {
        return Err(CliError::with_hint(
            format!("{} bps is above the contract's cap", args.bps),
            format!("the maximum is {MAX_FEE_BPS} bps ({}%)", MAX_FEE_BPS / 100),
        ));
    }

    let percent = args.bps as f64 / 100.0;
    let question = format!(
        "Set the protocol fee to {} bps ({percent}%) on {}?",
        args.bps, settings.network
    );
    if !prompt::confirm(&question, assume_yes)? {
        return Err(CliError::new("cancelled"));
    }

    let signer = resolve_signer()?;
    let progress = Progress::for_output(settings.json);
    let outcome = client
        .invoke(
            "set_protocol_fee",
            vec![address_arg(&signer.public_key())?, ScVal::U32(args.bps)],
            &signer,
            &progress,
        )
        .await?;
    progress.finish();

    if settings.json {
        return output::to_json(&serde_json::json!({
            "fee_bps": args.bps,
            "transaction": outcome.hash,
        }));
    }

    Ok(format!(
        "{}\n  Fee:         {} bps ({percent}%)\n  Transaction: {}",
        output::success("Protocol fee updated"),
        args.bps,
        outcome.hash
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fee_cap_matches_the_contract() {
        assert_eq!(MAX_FEE_BPS, 1_000, "contract caps the fee at 1000 bps");
    }

    #[test]
    fn builds_an_address_argument() {
        assert!(address_arg("GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N").is_ok());
        assert!(address_arg("nope").is_err());
    }
}
