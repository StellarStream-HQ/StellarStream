// #921: Standardized event emission for the V3 Splitter.
//
// soroban-sdk 22 does not export a `contractevent` macro — events are
// published directly via `env.events().publish(topics, data)`.
// Topics are kept short (symbol_short!) so they fit in the 4-symbol limit.

use soroban_sdk::{symbol_short, Address, Env};

// ── Publish helpers ───────────────────────────────────────────────────────────

/// Emit a top-level split-executed event.
/// Topics: ("splitter", "executed", sender)   Data: (amount, timestamp)
pub fn emit_split_executed(env: &Env, sender: &Address, amount: i128) {
    env.events().publish(
        (
            symbol_short!("splitter"),
            symbol_short!("executed"),
            sender.clone(),
        ),
        (amount, env.ledger().timestamp()),
    );
}

/// Emit a per-recipient payment event.
/// Topics: ("payment", recipient, asset)   Data: (amount, bps, timestamp)
pub fn emit_individual_payment(
    env: &Env,
    recipient: &Address,
    asset: &Address,
    amount: i128,
    bps: u32,
) {
    env.events().publish(
        (
            symbol_short!("payment"),
            recipient.clone(),
            asset.clone(),
        ),
        (amount, bps, env.ledger().timestamp()),
    );
}
