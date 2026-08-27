//! Progress indicators for multi-step transactions.
//!
//! An invocation takes several seconds across simulate, sign, submit and
//! confirm. Without feedback the tool looks hung, so each step is announced.
//! In `--json` mode the spinner is suppressed so stdout stays parseable.

use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;

/// A spinner, or a silent no-op when output must stay machine-readable.
pub struct Progress {
    bar: Option<ProgressBar>,
}

impl Progress {
    /// A visible spinner.
    pub fn spinner() -> Self {
        let bar = ProgressBar::new_spinner();
        bar.enable_steady_tick(Duration::from_millis(100));
        bar.set_style(
            ProgressStyle::with_template("{spinner:.cyan} {msg}")
                .unwrap_or_else(|_| ProgressStyle::default_spinner()),
        );
        Progress { bar: Some(bar) }
    }

    /// A silent indicator, for `--json` and tests.
    pub fn silent() -> Self {
        Progress { bar: None }
    }

    /// Choose based on whether stdout has to stay parseable.
    pub fn for_output(json: bool) -> Self {
        if json {
            Self::silent()
        } else {
            Self::spinner()
        }
    }

    /// Announce the step now in progress.
    pub fn step(&self, message: &str) {
        if let Some(bar) = &self.bar {
            bar.set_message(message.to_string());
        }
    }

    /// Clear the spinner, leaving the line free for the result.
    pub fn finish(&self) {
        if let Some(bar) = &self.bar {
            bar.finish_and_clear();
        }
    }
}

impl Drop for Progress {
    fn drop(&mut self) {
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_mode_is_silent() {
        let progress = Progress::for_output(true);
        assert!(progress.bar.is_none());
    }

    #[test]
    fn human_mode_shows_a_spinner() {
        let progress = Progress::for_output(false);
        assert!(progress.bar.is_some());
    }

    #[test]
    fn stepping_a_silent_progress_is_harmless() {
        let progress = Progress::silent();
        progress.step("Simulating");
        progress.finish();
    }
}
