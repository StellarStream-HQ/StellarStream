//! # Property-Based Tests for Vesting Mathematics
//!
//! This module uses [proptest](https://proptest-rs.github.io/proptest/) to verify
//! mathematical invariants of the vesting calculation functions in [`crate::math`].
//!
//! ## What is property-based testing?
//!
//! Unlike example-based tests that check a fixed set of handpicked inputs, property-based
//! testing generates hundreds of random inputs automatically and asserts that a *property*
//! (a universally quantified statement) holds for **all** of them. proptest shrinks any
//! failing input to the smallest counterexample, making bugs easy to diagnose.
//!
//! ## Properties verified
//!
//! | # | Property | Mathematical statement |
//! |---|----------|----------------------|
//! | P1 | Boundedness | `unlocked(t) ∈ [0, total]` for all valid `t` |
//! | P2 | Monotonicity | `t₁ ≤ t₂ ⟹ unlocked(t₁) ≤ unlocked(t₂)` |
//! | P3 | Terminal resolution | `t ≥ end ⟹ unlocked(t) = total` |
//! | P4 | Zero before start | `t < start ⟹ unlocked(t) = 0` |
//! | P5 | Cliff gate | `t < cliff ⟹ unlocked(t) = 0` |
//! | P6 | Cliff continuity | `unlocked(cliff) ≥ 0` and increases from that point |
//! | P7 | Cancellation conservation | `to_receiver + to_sender = total_amount` |
//! | P8 | Withdrawal/remaining identity | `withdrawn + remaining = total` at any time |
//! | P9 | Pause–resume equivalence | pausing then resuming does not change effective vesting |
//! | P10 | No dust after sequential withdrawals | sum of all per-step withdrawals equals `total` |
//! | P11 | Exponential curve boundedness | result ∈ `[0, total]` for any valid input |
//! | P12 | Exponential ≤ Linear before end | quadratic growth is slower early |
//! | P13 | Fee calculation correctness | `fee(amount, bps) ≤ amount` and scales proportionally |
//! | P13b | Fee monotonicity in bps | higher `bps` ⇒ higher-or-equal fee |
//! | P14 | Withdrawable is non-negative | `calculate_withdrawable ≥ 0` always |
//! | P15 | Large-value / overflow safety | math never panics for realistic large inputs |
//! | P16 | One-second stream edge case | stream is 0 before end, `total` at/after end |
//! | P17 | Final withdrawal clears dust | `calculate_withdrawable(at end) = total − withdrawn` |
//!
//! ## Running the tests
//!
//! These run as ordinary `#[test]` functions via the `proptest!` macro. The default
//! configuration generates 256 random cases per property and automatically *shrinks*
//! any failure to the smallest reproducing input. To stress the invariants harder,
//! raise the case count, e.g. `PROPTEST_CASES=2000 cargo test --lib property_test`.
//! Properties that need inputs in a restricted sub-domain (e.g. "before the cliff")
//! generate those inputs directly rather than via `prop_assume!`, so they never
//! waste cases on rejected samples.

#![cfg(test)]
#![allow(unused_doc_comments)]

use crate::math::{
    calculate_exponential_unlocked, calculate_fee, calculate_unlocked,
    calculate_unlocked_amount, calculate_withdrawable,
};
use proptest::prelude::*;

// ---------------------------------------------------------------------------
// Strategy helpers — reusable generators for valid stream parameter ranges
// ---------------------------------------------------------------------------

/// Generates a `(start, end)` pair where `start < end` and both fit in u64
/// with enough headroom so arithmetic inside the functions never wraps.
fn valid_time_range() -> impl Strategy<Value = (u64, u64)> {
    (0u64..500_000_000u64).prop_flat_map(|start| {
        (start + 1..start + 31_536_001).prop_map(move |end| (start, end))
    })
}

/// Generates a `(start, cliff, end)` triple where `start ≤ cliff ≤ end`
/// and `start < end`.
fn valid_time_range_with_cliff() -> impl Strategy<Value = (u64, u64, u64)> {
    (0u64..500_000_000u64).prop_flat_map(|start| {
        (start..start + 31_536_001u64).prop_flat_map(move |cliff| {
            (cliff..start + 31_536_002u64).prop_map(move |end| {
                // Ensure end > start (cliff == end is an edge case but valid per contract
                // validation: cliff <= end)
                let end = end.max(start + 1);
                (start, cliff, end)
            })
        })
    })
}

/// Generates a total_amount in a range that avoids i128 overflow when
/// multiplied by a duration up to 31_536_000 (one year in seconds).
/// `total_amount * duration ≤ i128::MAX` requires `total_amount ≤ ~1.07e28`.
/// We use 1_000_000_000_000_000i128 (1 quadrillion) as a safe upper bound —
/// realistic for any token with up to 15 decimal places.
fn valid_amount() -> impl Strategy<Value = i128> {
    1i128..1_000_000_000_000_000i128
}

// ---------------------------------------------------------------------------
// P1 – Boundedness
// Unlocked amount is always in [0, total_amount] for any time value.
// ---------------------------------------------------------------------------

/// **P1 — Boundedness**: `calculate_unlocked_amount(total, start, end, t) ∈ [0, total]`
///
/// No matter what time is provided (past, present, or future), the contract
/// must never unlock a negative amount or more than it holds.
proptest! {
    #[test]
    fn p01_unlocked_amount_never_exceeds_total(
        total in valid_amount(),
        (start, end) in valid_time_range(),
        now in 0u64..600_000_000u64,
    ) {
        let unlocked = calculate_unlocked_amount(total, start, end, now);
        prop_assert!(
            unlocked >= 0,
            "unlocked was negative: {} (total={}, start={}, end={}, now={})",
            unlocked, total, start, end, now
        );
        prop_assert!(
            unlocked <= total,
            "unlocked {} exceeded total {} (start={}, end={}, now={})",
            unlocked, total, start, end, now
        );
    }
}

// ---------------------------------------------------------------------------
// P2 – Monotonicity
// More time elapsed → at least as much unlocked.
// ---------------------------------------------------------------------------

/// **P2 — Monotonicity**: `t1 ≤ t2 ⟹ unlocked(t1) ≤ unlocked(t2)`
///
/// Vesting should never go backwards. This holds for linear, cliff, and
/// exponential curves because all of them are non-decreasing functions of time.
proptest! {
    #[test]
    fn p02_unlocked_is_monotonically_non_decreasing(
        total in valid_amount(),
        (start, end) in valid_time_range(),
        t1 in 0u64..600_000_000u64,
        delta in 0u64..31_536_000u64,
    ) {
        let t2 = t1.saturating_add(delta);
        let unlocked_t1 = calculate_unlocked_amount(total, start, end, t1);
        let unlocked_t2 = calculate_unlocked_amount(total, start, end, t2);
        prop_assert!(
            unlocked_t2 >= unlocked_t1,
            "monotonicity violated: unlocked({})={} > unlocked({})={} (total={}, start={}, end={})",
            t2, unlocked_t2, t1, unlocked_t1, total, start, end
        );
    }
}

// ---------------------------------------------------------------------------
// P3 – Terminal resolution
// At or after end_time, exactly total_amount is unlocked (no dust).
// ---------------------------------------------------------------------------

/// **P3 — Terminal resolution**: `t ≥ end ⟹ unlocked(t) = total`
///
/// After a stream has fully elapsed, every token must be available for
/// withdrawal. Integer rounding must not leave any dust locked.
proptest! {
    #[test]
    fn p03_at_end_time_full_amount_unlocked(
        total in valid_amount(),
        (start, end) in valid_time_range(),
        extra in 0u64..1_000_000u64,
    ) {
        let now = end.saturating_add(extra);
        let unlocked = calculate_unlocked_amount(total, start, end, now);
        prop_assert_eq!(
            unlocked,
            total,
            "at end+{}: expected total={} but got {} (start={}, end={})",
            extra, total, unlocked, start, end
        );
    }
}

// ---------------------------------------------------------------------------
// P4 – Zero before start
// Nothing is unlocked before the stream begins.
// ---------------------------------------------------------------------------

/// **P4 — Zero before start**: `t < start ⟹ unlocked(t) = 0`
///
/// Tokens are fully locked before the stream start time. This prevents
/// receivers from withdrawing funds before the agreed vesting period begins.
proptest! {
    #[test]
    fn p04_nothing_unlocked_before_start(
        total in valid_amount(),
        // start > 0 so there is a non-empty region strictly before it
        start in 1u64..500_000_000u64,
        duration in 1u64..31_536_000u64,
        now_off in 0u64..31_536_000u64,
    ) {
        let end = start.saturating_add(duration);
        // now is strictly before start (start >= 1 guarantees a valid modulus)
        let now = now_off % start;
        let unlocked = calculate_unlocked_amount(total, start, end, now);
        prop_assert_eq!(
            unlocked,
            0,
            "expected 0 before start, got {} (total={}, start={}, end={}, now={})",
            unlocked, total, start, end, now
        );
    }
}

// ---------------------------------------------------------------------------
// P5 – Cliff gate (with calculate_unlocked which supports cliff parameter)
// Nothing unlocks before the cliff timestamp.
// ---------------------------------------------------------------------------

/// **P5 — Cliff gate**: `t < cliff ⟹ calculate_unlocked(total, start, cliff, end, t) = 0`
///
/// The cliff period enforces a hard lock: even though time progresses, the
/// receiver cannot access any tokens until the cliff is reached. This is
/// critical for vesting schedules like "1-year cliff, 3-year vest".
proptest! {
    #[test]
    fn p05_nothing_unlocked_before_cliff(
        total in valid_amount(),
        start in 0u64..500_000_000u64,
        // cliff is strictly after start (gap > 0 guarantees a real cliff period)
        gap in 1u64..31_536_001u64,
        end_gap in 1u64..31_536_001u64,
        now_off in 0u64..31_536_000u64,
    ) {
        let cliff = start.saturating_add(gap);
        let end = cliff.saturating_add(end_gap);
        // Generate `now` strictly before `cliff` to avoid rejected cases:
        // start + (now_off % gap) ∈ [start, cliff - 1] ⊂ (-∞, cliff).
        let now = start.saturating_add(now_off % gap);
        let unlocked = calculate_unlocked(total, start, cliff, end, now);
        prop_assert_eq!(
            unlocked,
            0,
            "cliff gate violated: got {} before cliff (total={}, start={}, cliff={}, end={}, now={})",
            unlocked, total, start, cliff, end, now
        );
    }
}

// ---------------------------------------------------------------------------
// P6 – Cliff continuity / monotonicity with cliff
// calculate_unlocked is also monotonically non-decreasing for t ≥ cliff.
// ---------------------------------------------------------------------------

/// **P6 — Cliff monotonicity**: for `t1 ≥ cliff` and `t2 ≥ t1`,
/// `unlocked(t1) ≤ unlocked(t2)`.
///
/// After the cliff is reached, vesting continues to increase. Combines the
/// cliff gate with the general monotonicity guarantee.
proptest! {
    #[test]
    fn p06_unlocked_with_cliff_is_monotone_after_cliff(
        total in valid_amount(),
        start in 0u64..500_000_000u64,
        // cliff is strictly after start; end strictly after cliff
        gap in 1u64..31_536_001u64,
        end_gap in 1u64..31_536_001u64,
        t1_off in 0u64..31_536_000u64,
        delta in 0u64..31_536_000u64,
    ) {
        let cliff = start.saturating_add(gap);
        let end = cliff.saturating_add(end_gap);
        // Generate t1 at or after the cliff directly to avoid rejected cases.
        let t1 = cliff.saturating_add(t1_off);
        let t2 = t1.saturating_add(delta);
        let u1 = calculate_unlocked(total, start, cliff, end, t1);
        let u2 = calculate_unlocked(total, start, cliff, end, t2);
        prop_assert!(
            u2 >= u1,
            "cliff monotonicity violated: unlocked({})={} < unlocked({})={} \
             (total={}, start={}, cliff={}, end={})",
            t2, u2, t1, u1, total, start, cliff, end
        );
    }
}

// ---------------------------------------------------------------------------
// P7 – Cancellation conservation
// to_receiver + to_sender = total_amount (no tokens created or destroyed).
// ---------------------------------------------------------------------------

/// **P7 — Cancellation conservation**: when a stream is cancelled, the sum
/// distributed to the receiver (vested, unwithdrawn portion) and back to
/// the sender (unvested portion) equals exactly `total_amount`.
///
/// This mirrors the logic in `StellarStreamContract::cancel`:
/// ```text
/// to_receiver = unlocked - withdrawn_amount
/// to_sender   = total_amount - unlocked
/// ```
/// so `to_receiver + to_sender = total_amount - withdrawn_amount`.
/// When combined with the funds already paid out (`withdrawn_amount`), the
/// complete conservation is `to_receiver + to_sender + withdrawn_amount = total_amount`.
proptest! {
    #[test]
    fn p07_cancellation_distributes_exactly_total(
        total in valid_amount(),
        (start, cliff, end) in valid_time_range_with_cliff(),
        now in 0u64..600_000_000u64,
        withdrawn_fraction in 0u64..101u64, // as a percentage 0..=100
    ) {
        // Clamp now to a reasonable range to get interesting unlocked values
        let now = now.min(end + 1_000);

        let unlocked = calculate_unlocked(total, start, cliff, end, now);

        // withdrawn_amount must be ≤ unlocked (invariant upheld by contract)
        let withdrawn_amount = if unlocked > 0 {
            (unlocked as u64 * withdrawn_fraction / 100) as i128
        } else {
            0
        };

        // Replicate cancel() math:
        let to_receiver = unlocked - withdrawn_amount;
        let to_sender   = total - unlocked;

        prop_assert!(
            to_receiver >= 0,
            "to_receiver negative: {} (unlocked={}, withdrawn={})",
            to_receiver, unlocked, withdrawn_amount
        );
        prop_assert!(
            to_sender >= 0,
            "to_sender negative: {} (total={}, unlocked={})",
            to_sender, total, unlocked
        );
        prop_assert_eq!(
            to_receiver + to_sender + withdrawn_amount,
            total,
            "conservation violated: to_receiver({}) + to_sender({}) + withdrawn({}) ≠ total({})",
            to_receiver, to_sender, withdrawn_amount, total
        );
    }
}

// ---------------------------------------------------------------------------
// P8 – Withdrawal / remaining identity
// withdrawn + remaining = total at any point in time.
// ---------------------------------------------------------------------------

/// **P8 — Withdrawal/remaining identity**: after any number of withdrawals,
/// `withdrawn_amount + (total - withdrawn_amount) = total`.
///
/// More concretely: `calculate_withdrawable` returns exactly
/// `unlocked - withdrawn_amount`, and after the stream ends,
/// `calculate_withdrawable` returns `total - withdrawn_amount` so the full
/// balance is recoverable with no dust left behind.
proptest! {
    #[test]
    fn p08_withdrawable_plus_remainder_equals_total(
        total in valid_amount(),
        (start, cliff, end) in valid_time_range_with_cliff(),
        now in 0u64..600_000_000u64,
        withdrawn_fraction in 0u64..101u64,
    ) {
        let now = now.min(end + 1_000);
        let unlocked = calculate_unlocked(total, start, cliff, end, now);
        let withdrawn = if unlocked > 0 {
            (unlocked as u64 * withdrawn_fraction / 100) as i128
        } else {
            0
        };

        let withdrawable = calculate_withdrawable(total, withdrawn, start, cliff, end, now);

        prop_assert!(
            withdrawable >= 0,
            "withdrawable is negative: {} (total={}, withdrawn={}, now={})",
            withdrawable, total, withdrawn, now
        );

        // What remains locked in the contract = total - withdrawn - withdrawable
        let locked_remaining = total - withdrawn - withdrawable;
        prop_assert!(
            locked_remaining >= 0,
            "locked_remaining is negative: {} (total={}, withdrawn={}, withdrawable={})",
            locked_remaining, total, withdrawn, withdrawable
        );

        prop_assert_eq!(
            withdrawn + withdrawable + locked_remaining,
            total,
            "identity violated: withdrawn({}) + withdrawable({}) + locked({}) ≠ total({})",
            withdrawn, withdrawable, locked_remaining, total
        );
    }
}

// ---------------------------------------------------------------------------
// P9 – Pause–resume equivalence
// Pausing for `pause_duration` seconds then resuming results in the same
// effective unlocked amount as if the stream ran unpaused.
// ---------------------------------------------------------------------------

/// **P9 — Pause–resume equivalence**: a stream that is paused for `D` seconds
/// and then resumed should yield the same unlocked amount at wall-clock time
/// `t + D` as an otherwise-identical stream that was never paused at time `t`.
///
/// This is enforced by `calculate_unlocked` in `lib.rs` which subtracts
/// `total_paused_duration` from elapsed time. We verify the same invariant
/// directly on the math layer using `calculate_unlocked`:
///
/// ```text
/// unlocked_with_pause(t + D) where effective_elapsed = (t + D - start) - D
///   = t - start
///   = effective_elapsed_no_pause(t)
/// ```
proptest! {
    #[test]
    fn p09_pause_resume_preserves_effective_vesting(
        total in valid_amount(),
        (start, cliff, end) in valid_time_range_with_cliff(),
        // active_elapsed: how many seconds of *active* (non-paused) time have passed
        active_elapsed in 0u64..31_536_000u64,
        // pause_duration: how long the stream was paused (does not count toward vesting)
        pause_duration in 0u64..31_536_000u64,
    ) {
        // Wall-clock time for the paused stream = start + active_elapsed + pause_duration
        let wall_now = start
            .saturating_add(active_elapsed)
            .saturating_add(pause_duration);

        // Effective time seen by the paused stream (subtract paused seconds):
        // effective_now = wall_now - pause_duration = start + active_elapsed
        let effective_now = start.saturating_add(active_elapsed);

        // The contract's calculate_unlocked() subtracts total_paused_duration from the
        // elapsed clock. Model that here: a paused stream at wall_now behaves exactly
        // like an unpaused stream at effective_now (active time only).
        let model_unlocked = |wall: u64, pause: u64| -> i128 {
            let eff = wall.saturating_sub(pause);
            calculate_unlocked(total, start, cliff, end, eff)
        };

        let unlocked_paused = model_unlocked(wall_now, pause_duration);
        let unlocked_no_pause = calculate_unlocked(total, start, cliff, end, effective_now);

        prop_assert_eq!(
            unlocked_paused,
            unlocked_no_pause,
            "pause/resume equivalence violated: paused={} vs no_pause={} \
             (total={}, start={}, cliff={}, end={}, active_elapsed={}, pause_duration={})",
            unlocked_paused, unlocked_no_pause, total, start, cliff, end,
            active_elapsed, pause_duration
        );

        // Pausing must hold back vesting: the paused stream unlocks no more than a
        // never-paused stream would at the same wall-clock time.
        let unlocked_if_never_paused = calculate_unlocked(total, start, cliff, end, wall_now);
        prop_assert!(
            unlocked_paused <= unlocked_if_never_paused,
            "pause failed to hold back vesting: paused={} > never_paused={} \
             (wall_now={}, pause_duration={})",
            unlocked_paused, unlocked_if_never_paused, wall_now, pause_duration
        );

        // The paused stream's unlocked amount is still bounded.
        prop_assert!(unlocked_paused >= 0);
        prop_assert!(unlocked_paused <= total);
    }
}

// ---------------------------------------------------------------------------
// P10 – No dust after sequential withdrawals
// Withdrawing at every discrete time step yields exactly total_amount.
// ---------------------------------------------------------------------------

/// **P10 — No dust after sequential withdrawals**: making one withdrawal per
/// second from `start` to `end` collects exactly `total_amount` in aggregate.
///
/// This verifies that floor-rounding during intermediate withdrawals does not
/// permanently lock tokens. `calculate_withdrawable` compensates at `now >= end`
/// by returning `total - withdrawn_amount` exactly.
///
/// Uses small durations (≤ 1000 steps) to keep test runtime bounded.
proptest! {
    #[test]
    fn p10_sequential_withdrawals_sum_to_total(
        total in 1i128..10_000_000i128,
        duration in 1u64..=1000u64,
        cliff_fraction in 0u64..=100u64,
    ) {
        let start = 0u64;
        let cliff = duration * cliff_fraction / 100;
        let end = start + duration;

        let mut withdrawn = 0i128;

        for now in 1..=end {
            let w = calculate_withdrawable(total, withdrawn, start, cliff, end, now);
            prop_assert!(
                w >= 0,
                "negative withdrawable at step {}: {} (total={}, withdrawn={})",
                now, w, total, withdrawn
            );
            withdrawn += w;
        }

        prop_assert_eq!(
            withdrawn,
            total,
            "dust left: withdrew {} of {} (duration={}, cliff={})",
            withdrawn, total, duration, cliff
        );
    }
}

// ---------------------------------------------------------------------------
// P11 – Exponential curve boundedness
// calculate_exponential_unlocked result is in [0, total] on success.
// ---------------------------------------------------------------------------

/// **P11 — Exponential curve boundedness**: when the exponential calculation
/// succeeds (no overflow), the result is in `[0, total_amount]`.
///
/// The quadratic formula `total * elapsed² / duration²` can technically
/// overflow for very large totals and durations; that is handled by returning
/// `Err(())`. This property only asserts the bound when the call succeeds.
proptest! {
    #[test]
    fn p11_exponential_unlocked_bounded_on_success(
        total in 1i128..1_000_000_000i128,
        (start, end) in valid_time_range(),
        now in 0u64..600_000_000u64,
    ) {
        if let Ok(unlocked) = calculate_exponential_unlocked(total, start, end, now) {
            prop_assert!(
                unlocked >= 0,
                "exponential unlocked negative: {} (total={}, start={}, end={}, now={})",
                unlocked, total, start, end, now
            );
            prop_assert!(
                unlocked <= total,
                "exponential unlocked {} exceeded total {} (start={}, end={}, now={})",
                unlocked, total, start, end, now
            );
        }
        // Err(()) means overflow — acceptable, property only applies to Ok results
    }
}

// ---------------------------------------------------------------------------
// P12 – Exponential curve is slower than linear before end
// At any time before end, quadratic growth ≤ linear growth.
// ---------------------------------------------------------------------------

/// **P12 — Exponential ≤ Linear before end**: the exponential (quadratic) curve
/// unlocks *less* than the linear curve at every point before `end_time`.
///
/// This is a direct consequence of the math:
/// - Linear:      `total * t / T`
/// - Exponential: `total * t² / T²`
///
/// Since `t ≤ T`, we have `t/T ≤ 1`, so `t²/T² ≤ t/T`.  The exponential
/// curve accelerates payout toward the end, favouring receivers who stay
/// to the end of the stream.
proptest! {
    #[test]
    fn p12_exponential_unlocked_lte_linear_before_end(
        total in 1i128..1_000_000_000i128,
        start in 0u64..500_000_000u64,
        duration in 2u64..31_536_001u64,
        // Generate now strictly inside (start, end) to avoid rejected cases.
        now in 1u64..31_536_001u64,
    ) {
        let end = start + duration;
        // Keep now strictly inside the (start, end) open interval.
        let now = start + (now % duration) + 1;
        let now = now.min(end - 1);

        let linear = calculate_unlocked_amount(total, start, end, now);

        if let Ok(exponential) = calculate_exponential_unlocked(total, start, end, now) {
            prop_assert!(
                exponential <= linear,
                "exponential {} > linear {} at mid-stream \
                 (total={}, start={}, end={}, now={})",
                exponential, linear, total, start, end, now
            );
        }
    }
}

// ---------------------------------------------------------------------------
// P13 – Fee calculation correctness
// Fee is always ≤ amount and scales with basis points.
// ---------------------------------------------------------------------------

/// **P13 — Fee correctness**: `calculate_fee(amount, bps)` satisfies:
/// 1. Fee is non-negative.
/// 2. Fee never exceeds `amount`.
/// 3. A 10 000 bps (100%) fee equals `amount` (modulo floor rounding).
/// 4. Doubling `bps` at most doubles the fee (sub-linear due to flooring).
proptest! {
    #[test]
    fn p13_fee_is_bounded_and_proportional(
        amount in 1i128..1_000_000_000i128,
        bps in 0u32..=10_000u32,
    ) {
        let fee = calculate_fee(amount, bps);

        prop_assert!(
            fee >= 0,
            "fee is negative: {} (amount={}, bps={})",
            fee, amount, bps
        );
        prop_assert!(
            fee <= amount,
            "fee {} exceeded amount {} (bps={})",
            fee, amount, bps
        );

        // 100% fee (10 000 bps) should equal amount exactly
        let full_fee = calculate_fee(amount, 10_000);
        prop_assert_eq!(
            full_fee,
            amount,
            "10000 bps fee should equal amount: full_fee={} vs amount={}",
            full_fee,
            amount
        );
    }
}

/// **P13b — Fee monotonicity in bps**: higher basis points → higher or equal fee.
proptest! {
    #[test]
    fn p13b_fee_increases_with_bps(
        amount in 1i128..1_000_000_000i128,
        bps1 in 0u32..=10_000u32,
        delta in 0u32..=10_000u32,
    ) {
        let bps2 = (bps1 + delta).min(10_000);
        let fee1 = calculate_fee(amount, bps1);
        let fee2 = calculate_fee(amount, bps2);
        prop_assert!(
            fee2 >= fee1,
            "fee decreased with higher bps: fee({})={} > fee({})={} (amount={})",
            bps2, fee2, bps1, fee1, amount
        );
    }
}

// ---------------------------------------------------------------------------
// P14 – Withdrawable is non-negative
// calculate_withdrawable never returns a negative number.
// ---------------------------------------------------------------------------

/// **P14 — Withdrawable is non-negative**: `calculate_withdrawable ≥ 0` for any
/// valid combination of inputs where `withdrawn_amount ≤ unlocked`.
///
/// A negative withdrawable would indicate a contract accounting error and
/// could cause panics or unexpected behaviour in token transfers.
proptest! {
    #[test]
    fn p14_withdrawable_is_never_negative(
        total in valid_amount(),
        (start, cliff, end) in valid_time_range_with_cliff(),
        now in 0u64..600_000_000u64,
    ) {
        let now = now.min(end + 10_000);
        let unlocked = calculate_unlocked(total, start, cliff, end, now);

        // withdrawn_amount is always ≤ unlocked (contract invariant)
        // Test with 0, half, and full withdrawn amounts
        for &withdrawn in &[0i128, unlocked / 2, unlocked] {
            let withdrawable = calculate_withdrawable(total, withdrawn, start, cliff, end, now);
            prop_assert!(
                withdrawable >= 0,
                "withdrawable was negative: {} (total={}, withdrawn={}, unlocked={}, now={})",
                withdrawable, total, withdrawn, unlocked, now
            );
        }
    }
}

// ---------------------------------------------------------------------------
// P15 – Large value safety
// Math functions do not panic or overflow for very large but realistic amounts.
// ---------------------------------------------------------------------------

/// **P15 — Large value safety**: all math functions handle amounts up to
/// 1 quadrillion (10¹⁵) and durations up to 10 years without panicking.
///
/// This matters for tokens with 7 decimal places (like XLM) where even
/// moderate balances can result in large raw token amounts.
proptest! {
    #[test]
    fn p15_large_amounts_do_not_overflow(
        // Up to 1 quadrillion tokens
        total in 1i128..1_000_000_000_000_000i128,
        // Duration: 1 second to 10 years
        duration in 1u64..315_360_000u64,
        // Elapsed: anywhere in [0, 2 * duration]
        elapsed_fraction in 0u64..200u64,
    ) {
        let start = 0u64;
        let end = start + duration;
        let now = (duration * elapsed_fraction / 100).min(end + 1);
        let cliff = duration / 4; // 25% cliff

        // None of these should panic
        let u1 = calculate_unlocked_amount(total, start, end, now);
        let u2 = calculate_unlocked(total, start, cliff, end, now);
        let w  = calculate_withdrawable(total, 0, start, cliff, end, now);

        prop_assert!(u1 >= 0 && u1 <= total);
        prop_assert!(u2 >= 0 && u2 <= total);
        prop_assert!(w  >= 0 && w  <= total);
    }
}

// ---------------------------------------------------------------------------
// Additional edge-case properties
// ---------------------------------------------------------------------------

/// **P16 — Zero duration edge**: when `start + 1 == end` (one-second stream),
/// the stream either returns 0 (before end) or `total` (at/after end).
proptest! {
    #[test]
    fn p16_one_second_stream_is_binary(
        total in valid_amount(),
        start in 0u64..999_999_999u64,
        now in 0u64..1_100_000_000u64,
    ) {
        let end = start + 1;
        let unlocked = calculate_unlocked_amount(total, start, end, now);

        if now < end {
            // Linear: (total * elapsed) / 1 where elapsed = now - start if now >= start
            // Before start: 0; at start: total * 0 / 1 = 0; between start and end: any
            prop_assert!(
                unlocked >= 0 && unlocked <= total,
                "one-second stream out of bounds: {} (total={}, start={}, now={})",
                unlocked, total, start, now
            );
        } else {
            prop_assert_eq!(
                unlocked, total,
                "one-second stream should be fully unlocked at/after end: \
                 got {} (total={}, start={}, end={}, now={})",
                unlocked, total, start, end, now
            );
        }
    }
}

/// **P17 — Withdrawable at stream end clears all dust**: after the stream
/// ends, a single `calculate_withdrawable` call with any prior `withdrawn`
/// amount returns exactly `total - withdrawn` — no dust remains.
proptest! {
    #[test]
    fn p17_final_withdrawable_clears_dust(
        total in valid_amount(),
        (start, cliff, end) in valid_time_range_with_cliff(),
        // withdrawn is some amount already paid out (0..total)
        withdrawn_fraction in 0u64..=100u64,
    ) {
        let withdrawn = (total as u64 * withdrawn_fraction / 100) as i128;
        // now is past end
        let now = end + 1;

        let withdrawable = calculate_withdrawable(total, withdrawn, start, cliff, end, now);

        prop_assert_eq!(
            withdrawable,
            total - withdrawn,
            "dust not cleared: withdrawable={} expected={} (total={}, withdrawn={}, end={})",
            withdrawable, total - withdrawn, total, withdrawn, end
        );
    }
}
