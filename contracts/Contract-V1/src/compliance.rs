//! OFAC compliance module for the StellarStream contract.
//!
//! Manages the restricted-address denylist, preventing sanctioned addresses
//! from interacting with the protocol.
//!
//! # Enforcement points
//!
//! Restriction checks are evaluated at:
//! - **Stream creation** — both sender and receiver are checked.
//! - **Proposal creation** — both sender and receiver are checked.
//! - **Withdraw** — the receiver is checked before tokens are released.
//!
//! # Storage
//!
//! The restricted-address list is stored as `Map<Address, bool>` in
//! **instance storage** under [`DataKey::RestrictedAddresses`], consistent
//! with the upstream architecture for this key.
//!
//! # Events
//!
//! - `("complnc", "restrict")` → target address on restriction
//! - `("complnc", "unrestct")` → target address on unrestriction

use soroban_sdk::{symbol_short, Address, Env, Map};

use crate::{storage::DataKey, Error};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Load the restricted-address map from instance storage.
pub(crate) fn load_restricted(env: &Env) -> Map<Address, bool> {
    env.storage()
        .instance()
        .get(&DataKey::RestrictedAddresses)
        .unwrap_or_else(|| Map::new(env))
}

/// Persist the restricted-address map back to instance storage.
fn save_restricted(env: &Env, map: &Map<Address, bool>) {
    env.storage()
        .instance()
        .set(&DataKey::RestrictedAddresses, map);
}

// ---------------------------------------------------------------------------
// Public functions (called from lib.rs #[contractimpl])
// ---------------------------------------------------------------------------

/// Returns `true` if `address` is currently on the restricted list.
pub fn is_restricted(env: &Env, address: &Address) -> bool {
    load_restricted(env).get(address.clone()).unwrap_or(false)
}

/// Panics with [`Error::AddressRestricted`] if `address` is restricted.
pub fn require_not_restricted(env: &Env, address: &Address) {
    if is_restricted(env, address) {
        soroban_sdk::panic_with_error!(env, Error::AddressRestricted);
    }
}

/// Adds `target` to the restricted-address list. Idempotent.
///
/// Emits `("complnc", "restrict")` → `target`.
pub fn restrict_address(env: &Env, target: &Address) {
    let mut map = load_restricted(env);
    map.set(target.clone(), true);
    save_restricted(env, &map);
    env.events().publish(
        (symbol_short!("complnc"), symbol_short!("restrict")),
        target.clone(),
    );
}

/// Removes `target` from the restricted-address list. Idempotent.
///
/// Emits `("complnc", "unrestct")` → `target`.
pub fn unrestrict_address(env: &Env, target: &Address) {
    let mut map = load_restricted(env);
    map.remove(target.clone());
    save_restricted(env, &map);
    env.events().publish(
        (symbol_short!("complnc"), symbol_short!("unrestct")),
        target.clone(),
    );
}
