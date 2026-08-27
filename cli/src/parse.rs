//! Parsing and validation for user-supplied values.
//!
//! Everything here runs before a transaction is built, so a typo costs an error
//! message rather than a failed submission and a wasted fee.

use crate::error::{CliError, Result};

/// Parse a human duration such as `30d`, `12h`, `90m`, `45s` into seconds.
///
/// A bare number is read as seconds. Compound forms (`1d12h`) are supported so
/// that durations can be written the way people say them.
pub fn parse_duration(input: &str) -> Result<u64> {
    let text = input.trim().to_lowercase();
    if text.is_empty() {
        return Err(CliError::invalid_duration(input, "it is empty"));
    }

    // A bare number means seconds.
    if let Ok(seconds) = text.parse::<u64>() {
        if seconds == 0 {
            return Err(CliError::invalid_duration(
                input,
                "a stream cannot last 0 seconds",
            ));
        }
        return Ok(seconds);
    }

    let mut total: u64 = 0;
    let mut digits = String::new();
    let mut saw_unit = false;

    for ch in text.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }
        let multiplier = match ch {
            's' => 1,
            'm' => 60,
            'h' => 3_600,
            'd' => 86_400,
            'w' => 604_800,
            _ => {
                return Err(CliError::invalid_duration(
                    input,
                    &format!("'{ch}' is not a known unit (use s, m, h, d or w)"),
                ))
            }
        };
        if digits.is_empty() {
            return Err(CliError::invalid_duration(
                input,
                &format!("'{ch}' has no number in front of it"),
            ));
        }
        let value: u64 = digits
            .parse()
            .map_err(|_| CliError::invalid_duration(input, "the number is too large"))?;
        total = total
            .checked_add(
                value
                    .checked_mul(multiplier)
                    .ok_or_else(|| CliError::invalid_duration(input, "the duration is too large"))?,
            )
            .ok_or_else(|| CliError::invalid_duration(input, "the duration is too large"))?;
        digits.clear();
        saw_unit = true;
    }

    if !digits.is_empty() {
        return Err(CliError::invalid_duration(
            input,
            &format!("'{digits}' is missing a unit (use s, m, h, d or w)"),
        ));
    }
    if !saw_unit || total == 0 {
        return Err(CliError::invalid_duration(
            input,
            "a stream cannot last 0 seconds",
        ));
    }
    Ok(total)
}

/// Render a number of seconds the way [`parse_duration`] would accept it.
pub fn format_duration(seconds: u64) -> String {
    if seconds == 0 {
        return "0s".to_string();
    }
    let units = [("d", 86_400u64), ("h", 3_600), ("m", 60), ("s", 1)];
    let mut left = seconds;
    let mut parts = Vec::new();
    for (suffix, size) in units {
        let count = left / size;
        if count > 0 {
            parts.push(format!("{count}{suffix}"));
            left -= count * size;
        }
    }
    parts.join("")
}

/// Parse a token amount. Accepts `1000`, `1_000` and `1,000`.
pub fn parse_amount(input: &str) -> Result<i128> {
    let cleaned: String = input
        .trim()
        .chars()
        .filter(|c| *c != '_' && *c != ',')
        .collect();
    let amount: i128 = cleaned
        .parse()
        .map_err(|_| CliError::invalid_amount(input, "it is not a whole number"))?;
    if amount <= 0 {
        return Err(CliError::invalid_amount(input, "it must be greater than 0"));
    }
    Ok(amount)
}

/// Validate a Stellar account (`G...`) or contract (`C...`) address.
pub fn parse_address(input: &str) -> Result<String> {
    let text = input.trim();
    if let Ok(parsed) = stellar_strkey::Strkey::from_string(text) {
        if let stellar_strkey::Strkey::PrivateKeyEd25519(_) = parsed {
            return Err(CliError::invalid_address(
                text,
                "that is a secret key — pass a public address here",
            ));
        }
        return Ok(text.to_string());
    }
    let hint = match text.chars().next() {
        Some('G') => "it looks like an account address but the checksum does not match",
        Some('C') => "it looks like a contract address but the checksum does not match",
        Some('S') => "that is a secret key — pass a public address here",
        _ => "expected an account address (G...) or contract address (C...)",
    };
    Err(CliError::invalid_address(text, hint))
}

/// Validate a contract address specifically.
pub fn parse_contract_id(input: &str) -> Result<String> {
    let address = parse_address(input)?;
    if !address.starts_with('C') {
        return Err(CliError::invalid_address(
            &address,
            "a contract address starts with C",
        ));
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_unit_durations() {
        assert_eq!(parse_duration("30d").unwrap(), 30 * 86_400);
        assert_eq!(parse_duration("12h").unwrap(), 12 * 3_600);
        assert_eq!(parse_duration("90m").unwrap(), 5_400);
        assert_eq!(parse_duration("45s").unwrap(), 45);
        assert_eq!(parse_duration("2w").unwrap(), 14 * 86_400);
    }

    #[test]
    fn parses_compound_and_bare_durations() {
        assert_eq!(parse_duration("1d12h").unwrap(), 86_400 + 43_200);
        assert_eq!(parse_duration("1h30m").unwrap(), 5_400);
        assert_eq!(parse_duration("3600").unwrap(), 3_600);
        assert_eq!(parse_duration(" 30D ").unwrap(), 30 * 86_400);
    }

    #[test]
    fn a_bare_number_is_seconds() {
        assert_eq!(parse_duration("12").unwrap(), 12);
    }

    #[test]
    fn rejects_bad_durations_with_a_reason() {
        for bad in ["", "30x", "d", "0", "0s"] {
            assert!(parse_duration(bad).is_err(), "{bad:?} should be rejected");
        }
        let message = parse_duration("30x").unwrap_err().to_string();
        assert!(message.contains("not a known unit"), "got: {message}");
        let message = parse_duration("30d5").unwrap_err().to_string();
        assert!(message.contains("missing a unit"), "got: {message}");
    }

    #[test]
    fn formats_durations_round_trip() {
        for seconds in [45u64, 5_400, 86_400, 30 * 86_400, 86_400 + 43_200] {
            let text = format_duration(seconds);
            assert_eq!(parse_duration(&text).unwrap(), seconds, "round trip {text}");
        }
    }

    #[test]
    fn parses_amounts_with_separators() {
        assert_eq!(parse_amount("1000").unwrap(), 1000);
        assert_eq!(parse_amount("1_000").unwrap(), 1000);
        assert_eq!(parse_amount("1,000,000").unwrap(), 1_000_000);
    }

    #[test]
    fn rejects_non_positive_amounts() {
        assert!(parse_amount("0").is_err());
        assert!(parse_amount("-5").is_err());
        assert!(parse_amount("1.5").is_err());
        assert!(parse_amount("abc").is_err());
    }

    #[test]
    fn rejects_a_malformed_address() {
        assert!(parse_address("not-an-address").is_err());
        assert!(parse_address("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").is_err());
    }
}
