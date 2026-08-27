//! Errors, written to tell the user what to do next.
//!
//! Every variant carries the offending value and a concrete remedy. A CLI that
//! says "invalid input" makes the user guess; these say what was wrong and what
//! would have worked.

use owo_colors::OwoColorize;

pub type Result<T> = std::result::Result<T, CliError>;

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("{message}")]
    Message { message: String, hint: Option<String> },

    #[error("network error: {0}")]
    Network(String),

    #[error("contract call failed: {0}")]
    Contract(String),
}

impl CliError {
    pub fn new(message: impl Into<String>) -> Self {
        CliError::Message {
            message: message.into(),
            hint: None,
        }
    }

    pub fn with_hint(message: impl Into<String>, hint: impl Into<String>) -> Self {
        CliError::Message {
            message: message.into(),
            hint: Some(hint.into()),
        }
    }

    pub fn invalid_duration(input: &str, reason: &str) -> Self {
        CliError::with_hint(
            format!("'{input}' is not a valid duration: {reason}"),
            "durations look like 30d, 12h, 90m, 45s, or 1d12h",
        )
    }

    pub fn invalid_amount(input: &str, reason: &str) -> Self {
        CliError::with_hint(
            format!("'{input}' is not a valid amount: {reason}"),
            "amounts are whole token units, for example 1000 or 1_000_000",
        )
    }

    pub fn invalid_address(input: &str, reason: &str) -> Self {
        CliError::with_hint(
            format!("'{input}' is not a valid address: {reason}"),
            "account addresses start with G, contract addresses with C",
        )
    }

    pub fn missing_contract() -> Self {
        CliError::with_hint(
            "no contract id configured for this network",
            "pass --contract-id C..., set STELLARSTREAM_CONTRACT_ID, or run: stellarstream config set contract_id C...",
        )
    }

    pub fn missing_signer() -> Self {
        CliError::with_hint(
            "no signing key available",
            "set STELLARSTREAM_SECRET_KEY, or pass --secret-key-env NAME to read a different variable. \
             Secrets are never written to the config file.",
        )
    }

    /// The hint shown under the error, if any.
    pub fn hint(&self) -> Option<&str> {
        match self {
            CliError::Message { hint, .. } => hint.as_deref(),
            _ => None,
        }
    }

    /// Render for the terminal: what went wrong, then what to do about it.
    pub fn render(&self) -> String {
        let mut out = format!("{} {}", "error:".red().bold(), self);
        if let Some(hint) = self.hint() {
            out.push_str(&format!("\n{} {}", "hint:".yellow().bold(), hint));
        }
        out
    }
}

impl From<std::io::Error> for CliError {
    fn from(err: std::io::Error) -> Self {
        CliError::new(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_carry_an_actionable_hint() {
        let err = CliError::invalid_duration("30x", "'x' is not a known unit");
        assert!(err.to_string().contains("30x"));
        assert!(err.hint().unwrap().contains("30d"));
    }

    #[test]
    fn the_signer_hint_says_secrets_stay_out_of_config() {
        let hint = CliError::missing_signer().hint().unwrap().to_string();
        assert!(hint.contains("STELLARSTREAM_SECRET_KEY"));
        assert!(hint.contains("never written to the config"));
    }

    #[test]
    fn the_contract_hint_lists_every_way_to_supply_one() {
        let hint = CliError::missing_contract().hint().unwrap().to_string();
        assert!(hint.contains("--contract-id"));
        assert!(hint.contains("STELLARSTREAM_CONTRACT_ID"));
        assert!(hint.contains("config set"));
    }
}
