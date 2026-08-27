//! Interactive prompts for parameters left off the command line.
//!
//! A stream has five required parameters; asking for the missing ones beats
//! failing with a usage error and making the user retype the whole command.
//! Prompting is skipped when stdin is not a terminal, so scripts get a clear
//! error instead of hanging on input that will never arrive.

use dialoguer::{Confirm, Input, Password};

use crate::error::{CliError, Result};

/// Whether we can ask the user anything.
pub fn is_interactive() -> bool {
    std::io::IsTerminal::is_terminal(&std::io::stdin())
}

fn require_interactive(what: &str, flag: &str) -> Result<()> {
    if is_interactive() {
        return Ok(());
    }
    Err(CliError::with_hint(
        format!("{what} is required"),
        format!("pass {flag}, or run this in a terminal to be prompted"),
    ))
}

/// Return `value` if given, otherwise ask for it.
pub fn text_or_prompt(value: Option<String>, label: &str, flag: &str) -> Result<String> {
    if let Some(value) = value {
        return Ok(value);
    }
    require_interactive(label, flag)?;
    Input::<String>::new()
        .with_prompt(label)
        .interact_text()
        .map_err(|e| CliError::new(format!("could not read {label}: {e}")))
}

/// Ask for a secret without echoing it.
pub fn secret_prompt(label: &str) -> Result<String> {
    require_interactive(label, "--secret-key-env NAME")?;
    Password::new()
        .with_prompt(label)
        .interact()
        .map_err(|e| CliError::new(format!("could not read {label}: {e}")))
}

/// Ask for confirmation before something irreversible.
///
/// Returns `true` when `assume_yes` is set, so `--yes` works in scripts. When
/// there is no terminal and no `--yes`, this refuses rather than assuming.
pub fn confirm(question: &str, assume_yes: bool) -> Result<bool> {
    if assume_yes {
        return Ok(true);
    }
    if !is_interactive() {
        return Err(CliError::with_hint(
            format!("{question} — refusing to assume an answer"),
            "pass --yes to confirm non-interactively",
        ));
    }
    Confirm::new()
        .with_prompt(question)
        .default(false)
        .interact()
        .map_err(|e| CliError::new(format!("could not read confirmation: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_supplied_value_is_returned_without_prompting() {
        let value = text_or_prompt(Some("GABC".into()), "Sender", "--sender").unwrap();
        assert_eq!(value, "GABC");
    }

    #[test]
    fn yes_confirms_without_a_terminal() {
        assert!(confirm("Cancel stream 1?", true).unwrap());
    }

    #[test]
    fn a_missing_value_without_a_terminal_names_the_flag() {
        // Tests run without a terminal on stdin, so this exercises the
        // non-interactive path.
        if is_interactive() {
            return;
        }
        let err = text_or_prompt(None, "Sender", "--sender").unwrap_err();
        assert!(err.hint().unwrap().contains("--sender"));
    }

    #[test]
    fn refuses_to_assume_confirmation_without_a_terminal() {
        if is_interactive() {
            return;
        }
        let err = confirm("Cancel stream 1?", false).unwrap_err();
        assert!(err.hint().unwrap().contains("--yes"));
    }
}
