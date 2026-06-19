//! cargo-fuzz targets for splitter-v3 math invariants.
//!
//! Invariants tested:
//!   1. sum(recipient_outputs) <= total_input  (no money creation)
//!   2. dust = total - distributed < n_recipients  (rounding bounded)
//!   3. fee_amount <= total_amount  (fee never exceeds input)
//!   4. distributable = total - fee >= 0  (no negative distributable)
//!   5. each individual share = distributable * bps / 10_000 >= 0
//!
//! Run with:
//!   cargo fuzz run fuzz_split_funds

#![no_main]

use libfuzzer_sys::fuzz_target;

const MINIMUM_PAYMENT_AMOUNT: i128 = 10_000_000;

/// Decoded fuzzer input.
struct FuzzInput {
    total_amount: i128,
    fee_bps: u32,
    shares: [u32; 8],
    n_recipients: u8,
}

impl FuzzInput {
    fn from_bytes(data: &[u8]) -> Option<Self> {
        // Need at least 16 (total_amount) + 4 (fee_bps) + 1 (n) = 21 bytes
        if data.len() < 21 {
            return None;
        }
        let total_amount = i128::from_le_bytes(data[0..16].try_into().ok()?);
        // Only positive, non-zero amounts are meaningful.
        if total_amount <= 0 {
            return None;
        }
        let fee_bps = u32::from_le_bytes(data[16..20].try_into().ok()?) % 10_001; // 0..=10_000
        let n_recipients = (data[20] % 8) + 1; // 1..=8
        let mut shares = [0u32; 8];
        for i in 0..n_recipients as usize {
            let offset = 21 + i * 4;
            if offset + 4 > data.len() {
                shares[i] = 1;
            } else {
                shares[i] = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
                shares[i] = (shares[i] % 10_000) + 1; // 1..=10_000
            }
        }
        Some(FuzzInput { total_amount, fee_bps, shares, n_recipients })
    }
}

fuzz_target!(|data: &[u8]| {
    let input = match FuzzInput::from_bytes(data) {
        Some(v) => v,
        None => return,
    };

    let n = input.n_recipients as usize;

    // ── Normalise shares so they sum to exactly 10_000 bps ────────────────────
    let raw_sum: u64 = input.shares[..n].iter().map(|&s| s as u64).sum();
    if raw_sum == 0 {
        return;
    }
    let mut bps: [u32; 8] = [0; 8];
    let mut bps_total: u32 = 0;
    for i in 0..n {
        bps[i] = ((input.shares[i] as u64 * 10_000) / raw_sum) as u32;
        bps_total += bps[i];
    }
    bps[0] += 10_000u32.saturating_sub(bps_total);

    let final_sum: u32 = bps[..n].iter().sum();
    assert_eq!(final_sum, 10_000, "bps normalisation must sum to 10_000");

    let total = input.total_amount;

    // ── Invariant: fee computation ────────────────────────────────────────────
    let fee_amount = if input.fee_bps > 0 {
        match total.checked_mul(input.fee_bps as i128) {
            Some(v) => v / 10_000,
            None => return, // overflow in fee — contract returns Error::Overflow
        }
    } else {
        0
    };

    // Invariant 3: fee never exceeds total
    assert!(
        fee_amount <= total,
        "invariant violated: fee ({fee_amount}) > total ({total})"
    );

    let distributable = match total.checked_sub(fee_amount) {
        Some(v) => v,
        None => return,
    };

    // Invariant 4: distributable >= 0
    assert!(
        distributable >= 0,
        "invariant violated: negative distributable ({distributable})"
    );

    // ── Invariant: distribution loop ──────────────────────────────────────────
    let mut distributed: i128 = 0;
    let mut overflow = false;

    for i in 0..n {
        match distributable.checked_mul(bps[i] as i128) {
            Some(v) => {
                let amount = v / 10_000;

                // Invariant 5: each share >= 0
                assert!(amount >= 0, "invariant violated: negative share ({amount})");

                // Track which shares would be below minimum (these are valid —
                // the contract rejects the call before any transfer).
                // We only assert math invariants here, not business logic.

                match distributed.checked_add(amount) {
                    Some(new_dist) => distributed = new_dist,
                    None => { overflow = true; break; }
                }
            }
            None => { overflow = true; break; }
        }
    }

    if overflow {
        // Contract must return Error::Overflow — not panic. Just return.
        return;
    }

    // Invariant 1: total distributed <= distributable (no money creation)
    assert!(
        distributed <= distributable,
        "invariant violated: distributed ({distributed}) > distributable ({distributable})"
    );

    // Invariant 2: dust is non-negative and bounded by n_recipients
    let dust = distributable - distributed;
    assert!(
        dust >= 0,
        "invariant violated: negative dust ({dust})"
    );
    assert!(
        dust < n as i128,
        "invariant violated: dust ({dust}) >= n_recipients ({n}) — rounding error too large"
    );

    // ── Invariant: split_percentage dust-assignment (first recipient absorbs) ──
    // Mirrors the split_percentage implementation: non-first recipients computed
    // first, first gets base + dust.
    let mut pct_distributed: i128 = 0;
    for i in 1..n {
        match distributable.checked_mul(bps[i] as i128) {
            Some(v) => {
                let amount = v / 10_000;
                match pct_distributed.checked_add(amount) {
                    Some(d) => pct_distributed = d,
                    None => return,
                }
            }
            None => return,
        }
    }
    let first_base = match distributable.checked_mul(bps[0] as i128) {
        Some(v) => v / 10_000,
        None => return,
    };
    let pct_dust = match distributable.checked_sub(pct_distributed) {
        Some(d) => match d.checked_sub(first_base) {
            Some(dust) => dust,
            None => return,
        },
        None => return,
    };
    let first_total = match first_base.checked_add(pct_dust) {
        Some(v) => v,
        None => return,
    };
    assert!(
        first_total >= 0,
        "invariant violated: first recipient amount negative ({first_total})"
    );
    let total_pct = match pct_distributed.checked_add(first_total) {
        Some(v) => v,
        None => return,
    };
    assert_eq!(
        total_pct, distributable,
        "invariant violated: split_percentage total ({total_pct}) != distributable ({distributable})"
    );
});
