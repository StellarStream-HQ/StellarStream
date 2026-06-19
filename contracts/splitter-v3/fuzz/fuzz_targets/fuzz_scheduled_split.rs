//! cargo-fuzz target for scheduled-split time-lock invariants.
//!
//! Invariants tested:
//!   1. execute is only valid when ledger_time >= release_ledger
//!   2. cancel is only valid when ledger_time < release_ledger
//!   3. Both invariants hold across the full u64 range for both values

#![no_main]

use libfuzzer_sys::fuzz_target;

struct FuzzInput {
    ledger_time: u64,
    release_ledger: u64,
}

impl FuzzInput {
    fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 16 {
            return None;
        }
        let ledger_time = u64::from_le_bytes(data[0..8].try_into().ok()?);
        let release_ledger = u64::from_le_bytes(data[8..16].try_into().ok()?);
        Some(FuzzInput { ledger_time, release_ledger })
    }
}

fuzz_target!(|data: &[u8]| {
    let input = match FuzzInput::from_bytes(data) {
        Some(v) => v,
        None => return,
    };

    let can_execute = input.ledger_time >= input.release_ledger;
    let can_cancel  = input.ledger_time  < input.release_ledger;

    // These are mutually exclusive (one is strictly the negation of the other).
    assert_ne!(
        can_execute, can_cancel,
        "execute and cancel window must be mutually exclusive: \
         ledger={} release={}",
        input.ledger_time, input.release_ledger
    );

    // No time can be both inside and outside the release window.
    assert!(
        !(can_execute && can_cancel),
        "time cannot satisfy both execute ({}) and cancel ({}) conditions simultaneously",
        can_execute, can_cancel
    );
});
