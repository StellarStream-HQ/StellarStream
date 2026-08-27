//! StellarStream CLI.
//!
//! Split into a library so the parsing, configuration, formatting and decoding
//! logic can be tested directly, while `main.rs` stays a thin entry point.

pub mod cli;
pub mod client;
pub mod commands;
pub mod config;
pub mod error;
pub mod network;
pub mod output;
pub mod parse;
pub mod progress;
pub mod prompt;
pub mod settings;
pub mod signer;
