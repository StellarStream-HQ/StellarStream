//! Resolving the signing key.
//!
//! Admin commands (`grant-role`, `set-fee`) sign with privileged keys, so where
//! that key comes from is the security-critical decision in this tool. The rule
//! is simple: **the config file never holds secrets.** A key is read from an
//! environment variable, or prompted for interactively and kept only in memory
//! for the life of the process.

use soroban_client::keypair::{Keypair, KeypairBehavior};

use crate::error::{CliError, Result};

/// Where a signing key came from, for display.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignerSource {
    /// Read from an environment variable.
    Environment,
    /// Typed at an interactive prompt.
    Prompt,
}

/// A resolved signing key.
pub struct Signer {
    keypair: Keypair,
    pub source: SignerSource,
}

/// Redacting `Debug`, so a stray `{:?}` can never print signing material.
impl std::fmt::Debug for Signer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Signer")
            .field("public_key", &self.public_key())
            .field("source", &self.source)
            .field("secret", &"<redacted>")
            .finish()
    }
}

impl Signer {
    pub fn keypair(&self) -> &Keypair {
        &self.keypair
    }

    pub fn public_key(&self) -> String {
        self.keypair.public_key()
    }

    /// Build from a secret seed, validating it before use.
    pub fn from_secret(secret: &str, source: SignerSource) -> Result<Self> {
        let trimmed = secret.trim();
        if trimmed.is_empty() {
            return Err(CliError::missing_signer());
        }
        if !trimmed.starts_with('S') {
            return Err(CliError::with_hint(
                "that does not look like a secret key",
                "secret keys start with S; public addresses start with G and cannot sign",
            ));
        }
        // Validate the strkey ourselves first: `Keypair::from_secret` panics on
        // a malformed seed, and a typo in an environment variable should be an
        // error message, not a backtrace.
        stellar_strkey::ed25519::PrivateKey::from_string(trimmed).map_err(|_| {
            CliError::with_hint(
                "the secret key could not be parsed",
                "check it was copied in full — a secret key is 56 characters starting with S",
            )
        })?;
        let keypair = Keypair::from_secret(trimmed).map_err(|_| {
            CliError::with_hint(
                "the secret key could not be parsed",
                "check it was copied in full — a secret key is 56 characters starting with S",
            )
        })?;
        Ok(Signer {
            keypair,
            source,
        })
    }

    /// Resolve a key from `var_name`, falling back to an interactive prompt.
    ///
    /// `read_env` and `prompt` are injected so the resolution order can be
    /// tested without touching the real environment or a terminal.
    pub fn resolve(
        var_name: &str,
        read_env: &dyn Fn(&str) -> Option<String>,
        prompt: &dyn Fn() -> Result<String>,
    ) -> Result<Self> {
        if let Some(secret) = read_env(var_name) {
            if !secret.trim().is_empty() {
                return Self::from_secret(&secret, SignerSource::Environment);
            }
        }
        let typed = prompt()?;
        Self::from_secret(&typed, SignerSource::Prompt)
    }

    /// How the key was obtained, for the transaction summary.
    pub fn describe(&self, var_name: &str) -> String {
        match self.source {
            SignerSource::Environment => format!("${var_name}"),
            SignerSource::Prompt => "interactive prompt".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // An obviously-fake key (seed = 0x07 repeated), used only to exercise
    // parsing. It controls no account on any network.
    const SECRET: &str = "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X";
    const PUBLIC: &str = "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N";

    fn no_env() -> impl Fn(&str) -> Option<String> {
        |_: &str| None
    }

    #[test]
    fn reads_the_key_from_the_environment() {
        let signer = Signer::resolve(
            "STELLARSTREAM_SECRET_KEY",
            &|name| {
                (name == "STELLARSTREAM_SECRET_KEY").then(|| SECRET.to_string())
            },
            &|| panic!("must not prompt when the variable is set"),
        )
        .unwrap();
        assert_eq!(signer.source, SignerSource::Environment);
        assert!(signer.public_key().starts_with('G'));
    }

    #[test]
    fn falls_back_to_the_prompt_when_unset() {
        let signer = Signer::resolve(
            "STELLARSTREAM_SECRET_KEY",
            &no_env(),
            &|| Ok(SECRET.to_string()),
        )
        .unwrap();
        assert_eq!(signer.source, SignerSource::Prompt);
    }

    #[test]
    fn an_empty_variable_falls_through_to_the_prompt() {
        let signer = Signer::resolve(
            "STELLARSTREAM_SECRET_KEY",
            &|_| Some("   ".to_string()),
            &|| Ok(SECRET.to_string()),
        )
        .unwrap();
        assert_eq!(signer.source, SignerSource::Prompt);
    }

    #[test]
    fn a_public_address_is_rejected_as_a_signing_key() {
        let err = Signer::from_secret(PUBLIC, SignerSource::Environment).unwrap_err();
        assert!(err.hint().unwrap().contains("cannot sign"));
    }

    #[test]
    fn a_truncated_secret_is_rejected_without_panicking() {
        // `Keypair::from_secret` panics on a malformed seed, so this also
        // covers the guard that keeps a user typo from crashing the tool.
        let err = Signer::from_secret("SADQOBYHA4DQ", SignerSource::Environment).unwrap_err();
        assert!(err.hint().unwrap().contains("56 characters"));
    }

    #[test]
    fn a_secret_with_a_bad_checksum_is_rejected_without_panicking() {
        let mut corrupted = SECRET.to_string();
        corrupted.pop();
        corrupted.push('A');
        assert!(Signer::from_secret(&corrupted, SignerSource::Environment).is_err());
    }

    #[test]
    fn debug_output_never_contains_the_secret() {
        let signer = Signer::from_secret(SECRET, SignerSource::Environment).unwrap();
        let rendered = format!("{signer:?}");
        assert!(!rendered.contains(SECRET), "secret leaked into Debug output");
        assert!(rendered.contains("<redacted>"));
        assert!(rendered.contains(&signer.public_key()));
    }

    #[test]
    fn describes_where_the_key_came_from() {
        let from_env = Signer::from_secret(SECRET, SignerSource::Environment).unwrap();
        assert_eq!(from_env.describe("MY_KEY"), "$MY_KEY");

        let typed = Signer::from_secret(SECRET, SignerSource::Prompt).unwrap();
        assert_eq!(typed.describe("MY_KEY"), "interactive prompt");
    }
}
