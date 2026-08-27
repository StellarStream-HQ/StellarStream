//! User-facing stream commands: create, withdraw, cancel, query, list.

use soroban_client::xdr::{ScAddress, ScVal};
use std::str::FromStr;

use super::{i128_arg, sc_to_i128, sc_to_u32, sc_to_u64, sc_to_u64_vec};
use crate::cli::{CreateArgs, ListArgs, StreamIdArgs};
use crate::client::ContractClient;
use crate::error::{CliError, Result};
use crate::output::{self, StreamView};
use crate::parse::{format_duration, parse_address, parse_amount, parse_contract_id, parse_duration};
use crate::progress::Progress;
use crate::prompt;
use crate::settings::Settings;
use crate::signer::Signer;

/// Convert an address string into a contract argument.
fn address_arg(address: &str) -> Result<ScVal> {
    let parsed = ScAddress::from_str(address)
        .map_err(|_| CliError::invalid_address(address, "it could not be encoded"))?;
    Ok(ScVal::Address(parsed))
}

/// `stellarstream create`
pub async fn create(
    args: CreateArgs,
    settings: &Settings,
    resolve_signer: &dyn Fn() -> Result<Signer>,
    client: &ContractClient,
    assume_yes: bool,
) -> Result<String> {
    // Anything not given on the command line is asked for.
    let sender = parse_address(&prompt::text_or_prompt(
        args.sender,
        "Sender address",
        "--sender",
    )?)?;
    let receiver = parse_address(&prompt::text_or_prompt(
        args.receiver,
        "Receiver address",
        "--receiver",
    )?)?;
    let token = parse_contract_id(&prompt::text_or_prompt(
        args.token,
        "Token contract address",
        "--token",
    )?)?;
    let amount = parse_amount(&prompt::text_or_prompt(
        args.amount,
        "Amount",
        "--amount",
    )?)?;
    let duration = parse_duration(&prompt::text_or_prompt(
        args.duration,
        "Duration (e.g. 30d)",
        "--duration",
    )?)?;

    let start = args.start.unwrap_or_else(now);
    let end = start.checked_add(duration).ok_or_else(|| {
        CliError::new("the stream would end after the maximum representable time")
    })?;

    if settings.network.is_live() {
        let question = format!(
            "Create a {} stream of {} on mainnet, running {}?",
            output::abbreviate(&token),
            output::format_units(amount),
            format_duration(duration)
        );
        if !prompt::confirm(&question, assume_yes)? {
            return Err(CliError::new("cancelled"));
        }
    }

    // Only ask for a signing key once every argument has been accepted, so a
    // typo is reported before the user is prompted for a secret.
    let signer = resolve_signer()?;

    let progress = Progress::for_output(settings.json);
    let outcome = client
        .invoke(
            "create_stream",
            vec![
                address_arg(&sender)?,
                address_arg(&receiver)?,
                address_arg(&token)?,
                i128_arg(amount),
                ScVal::U64(start),
                ScVal::U64(end),
                ScVal::U32(args.curve.as_u32()),
                ScVal::Bool(args.soulbound),
            ],
            &signer,
            &progress,
        )
        .await?;
    progress.finish();

    let stream_id = outcome
        .return_value
        .as_ref()
        .map(sc_to_u64)
        .transpose()?
        .unwrap_or_default();

    if settings.json {
        return output::to_json(&serde_json::json!({
            "stream_id": stream_id,
            "transaction": outcome.hash,
            "sender": sender,
            "receiver": receiver,
            "token": token,
            "amount": amount.to_string(),
            "start_time": start,
            "end_time": end,
        }));
    }

    Ok(format!(
        "{}\n  Stream ID:   {}\n  Amount:      {}\n  Duration:    {}\n  Receiver:    {}\n  Transaction: {}",
        output::success("Stream created"),
        stream_id,
        output::format_units(amount),
        format_duration(duration),
        receiver,
        outcome.hash
    ))
}

/// `stellarstream withdraw`
pub async fn withdraw(
    args: StreamIdArgs,
    settings: &Settings,
    resolve_signer: &dyn Fn() -> Result<Signer>,
    client: &ContractClient,
) -> Result<String> {
    let account = match &args.account {
        Some(address) => parse_address(address)?,
        None => String::new(),
    };
    let signer = resolve_signer()?;
    let account = if account.is_empty() {
        signer.public_key()
    } else {
        account
    };

    let progress = Progress::for_output(settings.json);
    let outcome = client
        .invoke(
            "withdraw",
            vec![ScVal::U64(args.stream_id), address_arg(&account)?],
            &signer,
            &progress,
        )
        .await?;
    progress.finish();

    let withdrawn = outcome
        .return_value
        .as_ref()
        .map(sc_to_i128)
        .transpose()?
        .unwrap_or_default();

    if settings.json {
        return output::to_json(&serde_json::json!({
            "stream_id": args.stream_id,
            "withdrawn": withdrawn.to_string(),
            "transaction": outcome.hash,
        }));
    }

    if withdrawn == 0 {
        return Ok(format!(
            "{}\n  Nothing has unlocked yet on stream {}.",
            output::warning("No funds withdrawn"),
            args.stream_id
        ));
    }

    Ok(format!(
        "{}\n  Amount:      {}\n  Stream:      {}\n  Transaction: {}",
        output::success("Withdrawal complete"),
        output::format_units(withdrawn),
        args.stream_id,
        outcome.hash
    ))
}

/// `stellarstream cancel`
pub async fn cancel(
    args: StreamIdArgs,
    settings: &Settings,
    resolve_signer: &dyn Fn() -> Result<Signer>,
    client: &ContractClient,
    assume_yes: bool,
) -> Result<String> {
    let explicit_account = match &args.account {
        Some(address) => Some(parse_address(address)?),
        None => None,
    };

    // Cancelling cannot be undone, so always ask -- before asking for a key.
    let question = format!("Cancel stream {}? This cannot be undone.", args.stream_id);
    if !prompt::confirm(&question, assume_yes)? {
        return Err(CliError::new("cancelled"));
    }

    let signer = resolve_signer()?;
    let account = explicit_account.unwrap_or_else(|| signer.public_key());

    let progress = Progress::for_output(settings.json);
    let outcome = client
        .invoke(
            "cancel_stream",
            vec![ScVal::U64(args.stream_id), address_arg(&account)?],
            &signer,
            &progress,
        )
        .await?;
    progress.finish();

    if settings.json {
        return output::to_json(&serde_json::json!({
            "stream_id": args.stream_id,
            "cancelled": true,
            "transaction": outcome.hash,
        }));
    }

    Ok(format!(
        "{}\n  Stream:      {}\n  Transaction: {}",
        output::success("Stream cancelled"),
        args.stream_id,
        outcome.hash
    ))
}

/// `stellarstream query`
pub async fn query(
    args: StreamIdArgs,
    settings: &Settings,
    client: &ContractClient,
) -> Result<String> {
    let progress = Progress::for_output(settings.json);
    progress.step("Reading stream");
    let value = client
        .read("get_stream", vec![ScVal::U64(args.stream_id)])
        .await?;
    progress.finish();

    let stream = decode_stream(&value)?;
    if settings.json {
        return output::to_json(&stream);
    }
    Ok(output::render_stream(&stream))
}

/// `stellarstream list`
pub async fn list(args: ListArgs, settings: &Settings, client: &ContractClient) -> Result<String> {
    let user = parse_address(&args.user)?;

    let progress = Progress::for_output(settings.json);
    progress.step("Reading stream ids");
    let ids = sc_to_u64_vec(&client.read("get_user_streams", vec![address_arg(&user)?]).await?)?;

    let mut streams = Vec::with_capacity(ids.len());
    for (index, id) in ids.iter().enumerate() {
        progress.step(&format!("Reading stream {} of {}", index + 1, ids.len()));
        let value = client.read("get_stream", vec![ScVal::U64(*id)]).await?;
        streams.push(decode_stream(&value)?);
    }
    progress.finish();

    if settings.json {
        return output::to_json(&streams);
    }
    Ok(output::render_stream_list(&streams))
}

/// Decode the contract's `Stream` struct.
///
/// Fields are matched by name rather than position, so adding a field to the
/// contract does not silently shift everything here.
fn decode_stream(value: &ScVal) -> Result<StreamView> {
    let map = match value {
        ScVal::Map(Some(map)) => map,
        other => {
            return Err(CliError::Contract(format!(
                "expected a stream struct, got {other:?}"
            )))
        }
    };

    let field = |name: &str| -> Option<&ScVal> {
        map.iter().find_map(|entry| match &entry.key {
            ScVal::Symbol(symbol) if symbol.to_string() == name => Some(&entry.val),
            _ => None,
        })
    };
    let require = |name: &str| -> Result<&ScVal> {
        field(name).ok_or_else(|| CliError::Contract(format!("stream is missing field '{name}'")))
    };

    let address_of = |name: &str| -> Result<String> {
        match require(name)? {
            ScVal::Address(address) => Ok(address.to_string()),
            other => Err(CliError::Contract(format!(
                "field '{name}' is not an address: {other:?}"
            ))),
        }
    };

    Ok(StreamView {
        id: sc_to_u64(require("id")?)?,
        sender: address_of("sender")?,
        receiver: address_of("receiver")?,
        token: address_of("token")?,
        total_amount: sc_to_i128(require("total_amount")?)?,
        withdrawn_amount: sc_to_i128(require("withdrawn_amount")?)?,
        start_time: sc_to_u64(require("start_time")?)?,
        end_time: sc_to_u64(require("end_time")?)?,
        state: output::state_name(sc_to_u32(require("state")?)?).to_string(),
        curve: output::curve_name(sc_to_u32(require("curve_type")?)?).to_string(),
    })
}

/// Current unix time.
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_client::xdr::{ScMap, ScMapEntry, ScSymbol, StringM};

    fn symbol(name: &str) -> ScVal {
        ScVal::Symbol(ScSymbol(StringM::try_from(name.as_bytes().to_vec()).unwrap()))
    }

    fn entry(key: &str, value: ScVal) -> ScMapEntry {
        ScMapEntry {
            key: symbol(key),
            val: value,
        }
    }

    /// A stream map shaped the way the contract returns it.
    fn stream_map() -> ScVal {
        let address = ScAddress::from_str(
            "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N",
        )
        .unwrap();
        let token = ScAddress::from_str(
            "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
        )
        .unwrap();

        // Entries must be sorted by key, as the host requires.
        let mut entries = vec![
            entry("id", ScVal::U64(7)),
            entry("sender", ScVal::Address(address.clone())),
            entry("receiver", ScVal::Address(address.clone())),
            entry("token", ScVal::Address(token)),
            entry("total_amount", i128_arg(1_000_000)),
            entry("withdrawn_amount", i128_arg(250_000)),
            entry("start_time", ScVal::U64(0)),
            entry("end_time", ScVal::U64(2_592_000)),
            entry("state", ScVal::U32(0)),
            entry("curve_type", ScVal::U32(0)),
        ];
        entries.sort_by(|a, b| format!("{:?}", a.key).cmp(&format!("{:?}", b.key)));
        ScVal::Map(Some(ScMap(entries.try_into().unwrap())))
    }

    #[test]
    fn decodes_a_stream_struct_by_field_name() {
        let stream = decode_stream(&stream_map()).unwrap();
        assert_eq!(stream.id, 7);
        assert_eq!(stream.total_amount, 1_000_000);
        assert_eq!(stream.withdrawn_amount, 250_000);
        assert_eq!(stream.state, "active");
        assert_eq!(stream.curve, "linear");
        assert_eq!(stream.progress_percent(), 25);
        assert_eq!(stream.duration_seconds(), 2_592_000);
    }

    #[test]
    fn a_missing_field_is_named_in_the_error() {
        let ScVal::Map(Some(ScMap(entries))) = stream_map() else {
            unreachable!()
        };
        let kept: Vec<_> = entries
            .to_vec()
            .into_iter()
            .filter(|e| !matches!(&e.key, ScVal::Symbol(s) if s.to_string() == "total_amount"))
            .collect();
        let truncated = ScVal::Map(Some(ScMap(kept.try_into().unwrap())));

        let err = decode_stream(&truncated).unwrap_err();
        assert!(err.to_string().contains("total_amount"), "got: {err}");
    }

    #[test]
    fn a_non_struct_response_is_rejected() {
        assert!(decode_stream(&ScVal::U64(1)).is_err());
    }

    #[test]
    fn builds_an_address_argument() {
        assert!(address_arg("GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N").is_ok());
        assert!(address_arg("nonsense").is_err());
    }
}
