use soroban_sdk::{symbol_short, Symbol};

pub const STREAM_COUNT: Symbol = symbol_short!("STR_CNT");
pub const PROPOSAL_COUNT: Symbol = symbol_short!("PROP_CNT");
pub const RECEIPT: Symbol = symbol_short!("RECEIPT");
pub const RESTRICTED_ADDRESSES: Symbol = symbol_short!("RESTR_LST");
#[allow(dead_code)]
pub const FLASH_LOAN_LOCK: Symbol = symbol_short!("FL_LOCK");
#[allow(dead_code)]
pub const FLASH_LOAN_FEE: Symbol = symbol_short!("FL_FEE");
#[allow(dead_code)]
pub const REQUEST_COUNT: Symbol = symbol_short!("REQ_CNT");
/// Upgrade proposal counter key
pub const UPGRADE_PROPOSAL_COUNT: Symbol = symbol_short!("UPG_CNT");
/// Upgrade history key
pub const UPGRADE_HISTORY: Symbol = symbol_short!("UPG_HIST");
