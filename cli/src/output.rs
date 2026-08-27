//! Output formatting.
//!
//! Every command can render either a human table or `--json`, so the tool is
//! usable at a terminal and in a script without a second code path.

use comfy_table::{presets::UTF8_FULL, Attribute, Cell, ContentArrangement, Table};
use owo_colors::OwoColorize;
use serde::Serialize;

use crate::error::Result;
use crate::parse::format_duration;

/// A stream as the CLI reports it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct StreamView {
    pub id: u64,
    pub sender: String,
    pub receiver: String,
    pub token: String,
    pub total_amount: i128,
    pub withdrawn_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub state: String,
    pub curve: String,
}

impl StreamView {
    pub fn duration_seconds(&self) -> u64 {
        self.end_time.saturating_sub(self.start_time)
    }

    pub fn remaining(&self) -> i128 {
        (self.total_amount - self.withdrawn_amount).max(0)
    }

    /// Percentage withdrawn, 0-100.
    pub fn progress_percent(&self) -> u32 {
        if self.total_amount <= 0 {
            return 0;
        }
        ((self.withdrawn_amount.max(0) as f64 / self.total_amount as f64) * 100.0).round() as u32
    }
}

/// Map the contract's numeric state to a readable word.
pub fn state_name(state: u32) -> &'static str {
    match state {
        0 => "active",
        1 => "paused",
        2 => "closed",
        _ => "unknown",
    }
}

/// Map the contract's numeric curve to a readable word.
pub fn curve_name(curve: u32) -> &'static str {
    match curve {
        0 => "linear",
        1 => "exponential",
        _ => "unknown",
    }
}

/// Render one stream as a key/value table.
pub fn render_stream(stream: &StreamView) -> String {
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(vec![
        Cell::new("Field").add_attribute(Attribute::Bold),
        Cell::new("Value").add_attribute(Attribute::Bold),
    ]);

    let rows: Vec<(&str, String)> = vec![
        ("Stream ID", stream.id.to_string()),
        ("State", stream.state.clone()),
        ("Sender", stream.sender.clone()),
        ("Receiver", stream.receiver.clone()),
        ("Token", stream.token.clone()),
        ("Total", format_units(stream.total_amount)),
        ("Withdrawn", format_units(stream.withdrawn_amount)),
        ("Remaining", format_units(stream.remaining())),
        ("Progress", format!("{}%", stream.progress_percent())),
        ("Duration", format_duration(stream.duration_seconds())),
        ("Curve", stream.curve.clone()),
    ];
    for (key, value) in rows {
        table.add_row(vec![Cell::new(key), Cell::new(value)]);
    }
    table.to_string()
}

/// Render many streams as one row each.
pub fn render_stream_list(streams: &[StreamView]) -> String {
    if streams.is_empty() {
        return "No streams found.".to_string();
    }
    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(vec![
        Cell::new("ID").add_attribute(Attribute::Bold),
        Cell::new("State").add_attribute(Attribute::Bold),
        Cell::new("Total").add_attribute(Attribute::Bold),
        Cell::new("Withdrawn").add_attribute(Attribute::Bold),
        Cell::new("Progress").add_attribute(Attribute::Bold),
        Cell::new("Receiver").add_attribute(Attribute::Bold),
    ]);
    for stream in streams {
        table.add_row(vec![
            Cell::new(stream.id),
            Cell::new(&stream.state),
            Cell::new(format_units(stream.total_amount)),
            Cell::new(format_units(stream.withdrawn_amount)),
            Cell::new(format!("{}%", stream.progress_percent())),
            Cell::new(abbreviate(&stream.receiver)),
        ]);
    }
    table.to_string()
}

/// Group digits so large amounts stay readable.
pub fn format_units(amount: i128) -> String {
    let negative = amount < 0;
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    if negative {
        format!("-{grouped}")
    } else {
        grouped
    }
}

/// Shorten an address for table cells.
pub fn abbreviate(address: &str) -> String {
    if address.len() <= 12 {
        return address.to_string();
    }
    format!("{}...{}", &address[..6], &address[address.len() - 4..])
}

pub fn success(message: &str) -> String {
    format!("{} {}", "✓".green().bold(), message)
}

pub fn warning(message: &str) -> String {
    format!("{} {}", "!".yellow().bold(), message)
}

/// Serialise as pretty JSON for `--json`.
pub fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string_pretty(value)
        .map_err(|e| crate::error::CliError::new(format!("could not serialise output: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> StreamView {
        StreamView {
            id: 7,
            sender: "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N".into(),
            receiver: "GAFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQWCYLBMFQXPMH".into(),
            token: "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3".into(),
            total_amount: 1_000_000,
            withdrawn_amount: 250_000,
            start_time: 0,
            end_time: 2_592_000,
            state: "active".into(),
            curve: "linear".into(),
        }
    }

    #[test]
    fn groups_large_amounts() {
        assert_eq!(format_units(1_000_000), "1,000,000");
        assert_eq!(format_units(999), "999");
        assert_eq!(format_units(1_000), "1,000");
        assert_eq!(format_units(0), "0");
        assert_eq!(format_units(-1_234), "-1,234");
    }

    #[test]
    fn computes_progress_and_remaining() {
        let stream = sample();
        assert_eq!(stream.progress_percent(), 25);
        assert_eq!(stream.remaining(), 750_000);
        assert_eq!(stream.duration_seconds(), 2_592_000);
    }

    #[test]
    fn a_zero_amount_stream_does_not_divide_by_zero() {
        let mut stream = sample();
        stream.total_amount = 0;
        stream.withdrawn_amount = 0;
        assert_eq!(stream.progress_percent(), 0);
        assert_eq!(stream.remaining(), 0);
    }

    #[test]
    fn abbreviates_long_addresses_only() {
        assert_eq!(abbreviate("short"), "short");
        let long = sample().sender;
        let short = abbreviate(&long);
        assert!(short.contains("..."));
        assert!(short.len() < long.len());
    }

    #[test]
    fn the_detail_table_shows_the_headline_fields() {
        let rendered = render_stream(&sample());
        assert!(rendered.contains("Stream ID"));
        assert!(rendered.contains("1,000,000"));
        assert!(rendered.contains("25%"));
        assert!(rendered.contains("30d"), "duration should be humanised");
    }

    #[test]
    fn an_empty_list_says_so_instead_of_printing_an_empty_table() {
        assert_eq!(render_stream_list(&[]), "No streams found.");
    }

    #[test]
    fn the_list_table_has_one_row_per_stream() {
        let mut second = sample();
        second.id = 8;
        let rendered = render_stream_list(&[sample(), second]);
        assert!(rendered.contains(" 7 "));
        assert!(rendered.contains(" 8 "));
    }

    #[test]
    fn json_output_round_trips() {
        let json = to_json(&sample()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], 7);
        assert_eq!(parsed["total_amount"], 1_000_000);
    }

    #[test]
    fn maps_contract_enums_to_words() {
        assert_eq!(state_name(0), "active");
        assert_eq!(state_name(2), "closed");
        assert_eq!(state_name(99), "unknown");
        assert_eq!(curve_name(1), "exponential");
    }
}
