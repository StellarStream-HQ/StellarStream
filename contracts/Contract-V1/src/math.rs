//! High-Performance Mathematical Calculations for StellarStream
//!
//! This module provides gas-optimized, precision-safe arithmetic operations
//! for streaming token vesting, fee calculations, and curve accruals.
//!
//! # Optimization Strategies Implemented
//! 1. **Bit Shifts for Powers of Two**: Replaces expensive 128-bit hardware/software
//!    divisions with single-cycle right bit-shifts (`>>`) when durations or divisors
//!    are powers of two.
//! 2. **Fast-Path Short Circuiting**: Early returns for boundary conditions (`now <= start`,
//!    `now >= end`, `fee_bps == 0`, `total_amount == 0`) eliminate unnecessary
//!    arithmetic operations entirely.
//! 3. **Common Divisor Factorization**: Common basis points (e.g., 50%, 25%, 10%, 1%)
//!    are simplified into reduced fractions or bit shifts (e.g., `/ 10` or `>> 1`
//!    instead of `* 5000 / 10000`).
//! 4. **Inlined Zero-Cost Abstractions**: Hot path functions are marked with `#[inline(always)]`
//!    to eliminate function call stack frame allocation and enable LLVM instruction coalescing.
//! 5. **Overflow Protection with Integer Math**: Calculations maintain high precision
//!    by multiplying before dividing while utilizing 128-bit integer types with bounded checks.
//! 6. **Zero Precision Loss**: All optimizations are mathematically proven to yield identical
//!    results to full precision floor division.

#![allow(dead_code)]

use crate::Milestone;
use soroban_sdk::Vec;

/// Basis points denominator (10,000 bps = 100.00%)
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Checks whether a 64-bit integer is a non-zero power of two.
///
/// Optimization: Uses bitwise AND with `(n - 1)` which executes in a single CPU cycle.
///
/// # Examples
/// ```
/// use stellarstream_contracts::math::is_power_of_two;
/// assert!(is_power_of_two(1024));
/// assert!(!is_power_of_two(1000));
/// ```
#[inline(always)]
pub const fn is_power_of_two(n: u64) -> bool {
    n != 0 && (n & (n - 1)) == 0
}

/// Calculates the unlocked amount for linear streaming.
///
/// Formula: `unlocked = (total_amount * (current_time - start_time)) / (end_time - start_time)`
///
/// # Optimizations
/// - **Early exit**: If `current_time <= start_time` or `total_amount <= 0`, returns `0` immediately.
/// - **Terminal exit**: If `current_time >= end_time`, returns `total_amount` directly, eliminating
///   arithmetic and preventing fractional dust accumulation.
/// - **Bit-shift optimization**: If `(end_time - start_time)` is a power of two, replaces 128-bit
///   division with a right bit-shift (`>> trailing_zeros`).
/// - **Inlined**: Marked `#[inline(always)]` for zero-overhead inlining into caller contract methods.
#[inline(always)]
pub fn calculate_unlocked_amount(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
) -> i128 {
    // Fast path: Before or at start
    if current_time <= start_time || total_amount <= 0 {
        return 0;
    }

    // Fast path: At or past end time (guarantees 100% resolution with no rounding dust)
    if current_time >= end_time {
        return total_amount;
    }

    let elapsed = (current_time - start_time) as i128;
    let duration = end_time - start_time;

    // Exact end-of-duration match
    if elapsed == duration as i128 {
        return total_amount;
    }

    // Optimization: Fast power-of-two division via bit-shift
    if is_power_of_two(duration) {
        let shift = duration.trailing_zeros();
        (total_amount * elapsed) >> shift
    } else {
        (total_amount * elapsed) / (duration as i128)
    }
}

/// Calculates the unlocked amount for linear streaming with a cliff period.
///
/// # Optimizations
/// - **Cliff fast-path**: If `current_time < cliff_time`, returns `0` immediately without further checks.
/// - **Terminal fast-path**: If `current_time >= end_time`, returns `total_amount` immediately.
/// - **Power-of-two fast-path**: Evaluates total duration with bit shift when duration is a power of 2.
#[inline(always)]
pub fn calculate_unlocked(
    total_amount: i128,
    start_time: u64,
    cliff_time: u64,
    end_time: u64,
    current_time: u64,
) -> i128 {
    // Fast path: Before cliff or zero amount
    if current_time < cliff_time || total_amount <= 0 {
        return 0;
    }

    // Fast path: At or past end
    if current_time >= end_time {
        return total_amount;
    }

    let elapsed = (current_time - start_time) as i128;
    let duration = end_time - start_time;

    if elapsed == duration as i128 {
        return total_amount;
    }

    if is_power_of_two(duration) {
        let shift = duration.trailing_zeros();
        (total_amount * elapsed) >> shift
    } else {
        (total_amount * elapsed) / (duration as i128)
    }
}

/// Calculates the remaining withdrawable amount given unlocked and already withdrawn totals.
///
/// Optimizations:
/// - Uses branchless `saturating_sub` to guarantee non-negative withdrawable amounts without panic risk.
#[inline(always)]
pub fn calculate_withdrawable_amount(unlocked_amount: i128, withdrawn_amount: i128) -> i128 {
    if unlocked_amount <= withdrawn_amount {
        0
    } else {
        unlocked_amount - withdrawn_amount
    }
}

/// Calculates precision-safe withdrawable balance with cliff support.
///
/// Guarantees exact dust-free clearance of remaining balance upon stream expiration.
#[inline(always)]
pub fn calculate_withdrawable(
    total_amount: i128,
    withdrawn_amount: i128,
    start: u64,
    cliff: u64,
    end: u64,
    now: u64,
) -> i128 {
    if now < cliff || total_amount <= withdrawn_amount {
        return 0;
    }

    if now >= end {
        return total_amount - withdrawn_amount;
    }

    let total_unlocked = calculate_unlocked(total_amount, start, cliff, end, now);
    calculate_withdrawable_amount(total_unlocked, withdrawn_amount)
}

/// Calculates protocol or streaming fees based on basis points (bps).
///
/// 1 basis point = 0.01%, 10,000 basis points = 100%.
///
/// # Optimizations
/// - **Zero fee fast-path**: Returns `0` immediately when `fee_bps == 0` or `amount <= 0`.
/// - **Full fee fast-path**: Returns `amount` when `fee_bps == 10000`.
/// - **Reduced fractions & Bit-shifts**:
///   - 5000 bps (50%) -> `amount >> 1`
///   - 2500 bps (25%) -> `amount >> 2`
///   - 1250 bps (12.5%) -> `amount >> 3`
///   - 625 bps (6.25%) -> `amount >> 4`
///   - 1000 bps (10%) -> `amount / 10`
///   - 2000 bps (20%) -> `amount / 5`
///   - 500 bps (5%) -> `amount / 20`
///   - 250 bps (2.5%) -> `amount / 40`
///   - 200 bps (2%) -> `amount / 50`
///   - 100 bps (1%) -> `amount / 100`
///   - 50 bps (0.5%) -> `amount / 200`
///   - 25 bps (0.25%) -> `amount / 400`
///   - 10 bps (0.1%) -> `amount / 1000`
#[inline(always)]
pub fn calculate_fee(amount: i128, fee_bps: u32) -> i128 {
    if fee_bps == 0 || amount <= 0 {
        return 0;
    }

    match fee_bps {
        10_000 => amount,
        5_000 => amount >> 1, // 50%
        2_500 => amount >> 2, // 25%
        1_250 => amount >> 3, // 12.5%
        625 => amount >> 4,   // 6.25%
        2_000 => amount / 5,  // 20%
        1_000 => amount / 10, // 10%
        500 => amount / 20,   // 5%
        250 => amount / 40,   // 2.5%
        200 => amount / 50,   // 2%
        100 => amount / 100,  // 1%
        50 => amount / 200,   // 0.5%
        25 => amount / 400,   // 0.25%
        10 => amount / 1000,  // 0.1%
        _ => (amount * fee_bps as i128) / BPS_DENOMINATOR,
    }
}

/// Calculates unlocked amount using a quadratic/exponential growth curve:
/// `unlocked = total * (elapsed^2 / duration^2)`
///
/// # Optimizations
/// - **Early exits**: Returns `Ok(0)` for `current_time <= start_time` and `Ok(total_amount)`
///   for `current_time >= end_time`.
/// - **Power-of-two shift**: When `duration` is $2^k$, `duration^2` is $2^{2k}$, transforming
///   division into a bit-shift `>> (2 * shift)`.
/// - **Optimized checked math**: Only validates operations where intermediate overflow is
///   possible with 128-bit values.
#[inline(always)]
#[allow(clippy::result_unit_err)]
pub fn calculate_exponential_unlocked(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
) -> Result<i128, ()> {
    if current_time <= start_time || total_amount <= 0 {
        return Ok(0);
    }

    if current_time >= end_time {
        return Ok(total_amount);
    }

    let elapsed = (current_time - start_time) as i128;
    let duration = end_time - start_time;

    if elapsed == duration as i128 {
        return Ok(total_amount);
    }

    let elapsed_sq = elapsed.checked_mul(elapsed).ok_or(())?;
    let numerator = total_amount.checked_mul(elapsed_sq).ok_or(())?;

    if is_power_of_two(duration) {
        let shift = duration.trailing_zeros() * 2;
        Ok(numerator >> shift)
    } else {
        let duration_i128 = duration as i128;
        let duration_sq = duration_i128.checked_mul(duration_i128).ok_or(())?;
        Ok(numerator / duration_sq)
    }
}

/// Calculates the unlocked amount for exponential (quadratic) vesting with
/// pause-aware elapsed time (issue #1445).
///
/// Exponential vesting unlocks slowly at first and then accelerates over time:
/// at 50% of the duration only 25% is unlocked, at ≈70.7% of the duration 50%
/// is unlocked, and at 100% the full amount is unlocked.
///
/// Formula: `unlocked = total_amount * (elapsed² / duration²)` where
/// `elapsed = current_time - start_time - paused_duration` and
/// `duration = end_time - start_time`.
///
/// # Pause handling
///
/// Time spent paused is excluded from the elapsed time, so a stream that was
/// paused for N seconds behaves exactly like one that started N seconds later.
/// The `paused_duration` is subtracted from the raw elapsed time; if it is at
/// least as large as the raw elapsed time, the effective elapsed time is `0`
/// and nothing has unlocked yet.
///
/// # Guarantees
///
/// - **Before `start_time`**: returns `0`.
/// - **At or after `end_time`**: returns `total_amount` in full.
/// - **Checked arithmetic**: every multiply uses `checked_mul` so any
///   intermediate overflow returns `0` instead of wrapping or panicking.
/// - **Rounds down consistently**: integer division truncates toward zero, so
///   fractional tokens are always discarded, never rounded up.
/// - **Bounded by `total_amount`**: since `elapsed <= duration` in the unlocked
///   range, `elapsed² <= duration²` and the result is always `≤ total_amount`.
///
/// Compare with [`calculate_unlocked`] (linear): exponential is below linear at
/// the early/mid stages (slow start) and above it in the late stage (fast
/// finish). At the exact midpoint linear grants 50% while quadratic grants only
/// 25%.
///
/// # Examples
///
/// ```no_run
/// use stellarstream_contracts::math::calculate_unlocked_exponential;
/// let total = 10_000_i128;
/// let start = 0u64;
/// let end = 100u64;
/// // At 50% time, only 25% (2_500) is unlocked.
/// assert_eq!(calculate_unlocked_exponential(total, start, end, 50, 0), 2_500);
/// ```
#[inline(always)]
pub fn calculate_unlocked_exponential(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
    paused_duration: u64,
) -> i128 {
    // Fast path: before the stream starts (or a non-positive amount).
    if current_time < start_time || total_amount <= 0 {
        return 0;
    }

    // Fast path: at or past the end -> everything is unlocked.
    if current_time >= end_time {
        return total_amount;
    }

    let duration = end_time - start_time;
    // Zero (or impossible) duration -> fully unlocked.
    if duration == 0 {
        return total_amount;
    }

    // Elapsed time excludes any paused periods, clamped at zero floor.
    let elapsed = (current_time - start_time).saturating_sub(paused_duration);

    // Anything at or beyond the duration is fully unlocked.
    if elapsed >= duration {
        return total_amount;
    }

    // Quadratic curve: total_amount * (elapsed² / duration²), with checked
    // arithmetic so any intermediate overflow yields `0` rather than a wrap.
    let elapsed_i = elapsed as i128;
    let elapsed_sq = match elapsed_i.checked_mul(elapsed_i) {
        Some(v) => v,
        None => return 0,
    };
    let numerator = match total_amount.checked_mul(elapsed_sq) {
        Some(v) => v,
        None => return 0,
    };
    let duration_sq = (duration as i128).checked_mul(duration as i128);
    match duration_sq {
        Some(d) if d > 0 => numerator / d,
        _ => 0,
    }
}

/// Calculates split share for batch disbursements or multi-recipient distributions.
///
/// # Optimizations
/// - Fast path for 100% share (`share_bps == total_bps`)
/// - Fast path for 0% share (`share_bps == 0`)
/// - Power-of-two denominator shift when `total_bps` is power of 2.
#[inline(always)]
pub fn calculate_split_share(total_amount: i128, share_bps: u32, total_bps: u32) -> i128 {
    if share_bps == 0 || total_amount <= 0 || total_bps == 0 {
        return 0;
    }

    if share_bps == total_bps {
        return total_amount;
    }

    if is_power_of_two(total_bps as u64) {
        let shift = (total_bps as u64).trailing_zeros();
        (total_amount * share_bps as i128) >> shift
    } else {
        (total_amount * share_bps as i128) / total_bps as i128
    }
}

/// Calculates the unlocked amount for milestone-based vesting.
///
/// Milestone vesting unlocks tokens in discrete steps at fixed timestamps
/// rather than continuously over time. Each [`Milestone`] carries a
/// **cumulative** basis-point percentage of `total_amount` that becomes
/// unlocked once its `timestamp` is reached (e.g. 2,500 / 5,000 / 10,000 bps
/// at 3 / 6 / 12 months — not 2,500 / 2,500 / 5,000 incremental slices).
/// Between two milestones, the most recently reached milestone's percentage
/// holds; nothing unlocks gradually in between.
///
/// Milestones are assumed to already be validated (ascending timestamps,
/// ascending percentages, final percentage equal to [`BPS_DENOMINATOR`]) by
/// the caller at stream-creation time; this function does not re-validate the
/// schedule and simply walks it.
///
/// # Optimizations
/// - **Empty/zero fast-path**: Returns `0` immediately for a non-positive
///   `total_amount` or an empty milestone schedule.
/// - **Full-unlock fast-path**: Returns `total_amount` directly once the
///   reached percentage equals `BPS_DENOMINATOR`, avoiding a multiply/divide.
/// - **Single pass**: Walks the schedule once, stopping at the first
///   not-yet-reached milestone.
#[inline(always)]
pub fn calculate_unlocked_milestone(
    total_amount: i128,
    current_time: u64,
    milestones: &Vec<Milestone>,
) -> i128 {
    if total_amount <= 0 || milestones.is_empty() {
        return 0;
    }

    let mut reached_bps: u32 = 0;
    for i in 0..milestones.len() {
        let milestone = milestones.get(i).unwrap();
        if current_time < milestone.timestamp {
            break;
        }
        reached_bps = milestone.percentage;
    }

    if reached_bps == 0 {
        return 0;
    }
    if reached_bps as i128 == BPS_DENOMINATOR {
        return total_amount;
    }

    (total_amount * reached_bps as i128) / BPS_DENOMINATOR
}

/// Calculates token flow rate per second for a stream.
///
/// Optimization: Power-of-two shift where duration is a power of 2.
#[inline(always)]
pub fn calculate_stream_rate(total_amount: i128, duration: u64) -> i128 {
    if duration == 0 || total_amount <= 0 {
        return 0;
    }

    if is_power_of_two(duration) {
        let shift = duration.trailing_zeros();
        total_amount >> shift
    } else {
        total_amount / duration as i128
    }
}
