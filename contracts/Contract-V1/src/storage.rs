//! Storage key constants for the Contract-V1 token streaming contract.
//!
//! Each constant is a short [`Symbol`] used as (part of) an instance-storage key.
//! Composite keys are formed by tupling one of these symbols with an identifier,
//! e.g. `(RECEIPT, stream_id)`.

use soroban_sdk::{symbol_short, Symbol};

/// Key for the counter tracking the total number of streams ever created.
pub const STREAM_COUNT: Symbol = symbol_short!("STR_CNT");
/// Key for the counter tracking the total number of governance proposals ever created.
pub const PROPOSAL_COUNT: Symbol = symbol_short!("PROP_CNT");
/// Key prefix for a stream's NFT-style ownership receipt, keyed by stream ID.
pub const RECEIPT: Symbol = symbol_short!("RECEIPT");
/// Key for the list of addresses restricted from receiving streams (compliance/OFAC list).
pub const RESTRICTED_ADDRESSES: Symbol = symbol_short!("RESTR_LST");
/// Key prefix for the flash loan reentrancy lock, keyed by token address.
#[allow(dead_code)]
pub const FLASH_LOAN_LOCK: Symbol = symbol_short!("FL_LOCK");
/// Key prefix for the configured flash loan fee, keyed by token address.
#[allow(dead_code)]
pub const FLASH_LOAN_FEE: Symbol = symbol_short!("FL_FEE");
/// Key for the counter tracking outstanding flash loan requests.
#[allow(dead_code)]
pub const REQUEST_COUNT: Symbol = symbol_short!("REQ_CNT");
/// Key for the counter tracking the total number of upgrade proposals ever created.
pub const UPGRADE_PROPOSAL_COUNT: Symbol = symbol_short!("UPG_CNT");
/// Key for the log of executed contract upgrades.
pub const UPGRADE_HISTORY: Symbol = symbol_short!("UPG_HIST");
/// Per-token TVL tracking key prefix
pub const TOKEN_TVL: Symbol = symbol_short!("TOKEN_TVL");
/// Key for the counter tracking the total number of disputes ever raised.
pub const DISPUTE_COUNT: Symbol = symbol_short!("DISP_CNT");
/// Key prefix for a dispute record, keyed by dispute ID.
pub const DISPUTE: Symbol = symbol_short!("DISPUTE");
/// Key prefix for the list of authorized arbitrators.
pub const ARBITRATORS: Symbol = symbol_short!("ARB_LST");
