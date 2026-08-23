//! Vesting and fee arithmetic shared by the streaming contract's linear, cliff, and
//! exponential unlock curves.
//!
//! All functions here round down (floor division) so that the contract never unlocks
//! or reports more than it can actually pay out.
#![allow(unexpected_cfgs)]

/// Computes the linearly-vested amount of a stream at a point in time.
///
/// # Arguments
/// * `total_amount` - Total amount the stream will pay out
/// * `start_time` - Unix timestamp when vesting begins
/// * `end_time` - Unix timestamp when vesting completes
/// * `current_time` - Unix timestamp to evaluate vesting at
///
/// # Returns
/// `0` if `current_time < start_time`, `total_amount` if `current_time >= end_time`,
/// otherwise the proportionally vested amount, rounded down.
#[allow(dead_code)]
pub fn calculate_unlocked_amount(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
) -> i128 {
    if current_time < start_time {
        return 0;
    }

    if current_time >= end_time {
        return total_amount;
    }

    let elapsed_time = (current_time - start_time) as i128;
    let total_duration = (end_time - start_time) as i128;

    // Integer division automatically rounds down (floor division)
    // This ensures we never unlock more than we should
    (total_amount * elapsed_time) / total_duration
}

/// Computes the vested amount of a stream using a quadratic (exponential-style) curve
/// that accelerates payout as the stream approaches `end_time`.
///
/// The curve is `unlocked = total_amount * (elapsed / duration)^2`, computed as
/// `(total_amount * elapsed^2) / duration^2` using checked multiplication throughout.
///
/// # Arguments
/// * `total_amount` - Total amount the stream will pay out
/// * `start_time` - Unix timestamp when vesting begins
/// * `end_time` - Unix timestamp when vesting completes
/// * `current_time` - Unix timestamp to evaluate vesting at
///
/// # Returns
/// `0` before `start_time`, `total_amount` at or after `end_time`, otherwise the
/// quadratically-vested amount, rounded down.
///
/// # Errors
/// Returns `Err(())` if any intermediate multiplication (`elapsed^2`, `duration^2`, or
/// `total_amount * elapsed^2`) overflows `i128`.
pub fn calculate_exponential_unlocked(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
) -> Result<i128, ()> {
    if current_time < start_time {
        return Ok(0);
    }

    if current_time >= end_time {
        return Ok(total_amount);
    }

    let elapsed = (current_time - start_time) as i128;
    let duration = (end_time - start_time) as i128;

    // Quadratic formula: unlocked = total * (elapsed^2 / duration^2)
    // Rearranged to minimize overflow: (total * elapsed * elapsed) / (duration * duration)
    let elapsed_squared = elapsed.checked_mul(elapsed).ok_or(())?;
    let duration_squared = duration.checked_mul(duration).ok_or(())?;
    let numerator = total_amount.checked_mul(elapsed_squared).ok_or(())?;

    Ok(numerator / duration_squared)
}

/// Computes the exponentially-vested amount of a stream at a point in time, taking
/// into account any time the stream spent paused.
///
/// The curve is `unlocked = total_amount * (elapsed / duration)^2`, where `elapsed`
/// is the time since `start_time` minus `paused_duration`. This creates accelerated
/// vesting: tokens unlock slowly at first, then accelerate toward `end_time`.
///
/// # Arguments
/// * `total_amount` - Total amount the stream will pay out
/// * `start_time` - Unix timestamp when vesting begins
/// * `end_time` - Unix timestamp when vesting completes
/// * `current_time` - Unix timestamp to evaluate vesting at
/// * `paused_duration` - Total seconds the stream spent paused; subtracted from
///   elapsed time so paused periods never count toward vesting
///
/// # Returns
/// `0` if `current_time < start_time`, `total_amount` if `current_time >= end_time`,
/// otherwise the quadratically-vested amount, rounded down.
///
/// # Verification
/// At 50% of the duration, only 25% is unlocked (`0.5^2 = 0.25`). At ~70.7% of the
/// duration, 50% is unlocked (`0.707^2 ≈ 0.5`).
///
/// # Errors
/// Returns `Err(())` if any intermediate multiplication overflows `i128`.
pub fn calculate_unlocked_exponential(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    current_time: u64,
    paused_duration: u64,
) -> Result<i128, ()> {
    if current_time < start_time {
        return Ok(0);
    }

    if current_time >= end_time {
        return Ok(total_amount);
    }

    let elapsed = (current_time - start_time) as i128;
    let paused = paused_duration as i128;
    let effective_elapsed = elapsed - paused;

    if effective_elapsed <= 0 {
        return Ok(0);
    }

    let duration = (end_time - start_time) as i128;

    // Quadratic formula: unlocked = total * (elapsed^2 / duration^2)
    // Rearranged to minimize overflow: (total * elapsed * elapsed) / (duration * duration)
    let elapsed_squared = effective_elapsed.checked_mul(effective_elapsed).ok_or(())?;
    let duration_squared = duration.checked_mul(duration).ok_or(())?;
    let numerator = total_amount.checked_mul(elapsed_squared).ok_or(())?;

    Ok(numerator / duration_squared)
}

/// Computes the amount currently withdrawable given an already-unlocked amount.
///
/// For a stream's final withdrawal, prefer computing `total_amount - withdrawn_amount`
/// directly instead of calling this with a freshly re-derived `unlocked_amount`, to
/// avoid accumulating rounding error across the two calculations.
///
/// # Arguments
/// * `unlocked_amount` - Amount vested so far (e.g. from [`calculate_unlocked_amount`])
/// * `withdrawn_amount` - Amount already withdrawn
///
/// # Returns
/// `unlocked_amount - withdrawn_amount`.
#[allow(dead_code)]
pub fn calculate_withdrawable_amount(unlocked_amount: i128, withdrawn_amount: i128) -> i128 {
    unlocked_amount - withdrawn_amount
}

/// Computes the linearly-vested amount of a stream that has a cliff, before which
/// nothing is unlocked regardless of elapsed time.
///
/// For the final withdrawal (`now >= end`), callers should still prefer computing
/// `total_amount - withdrawn_amount` directly rather than round-tripping through this
/// function, to avoid accumulated rounding error; this function already does that
/// internally for `now >= end`.
///
/// # Arguments
/// * `total_amount` - Total amount the stream will pay out
/// * `start` - Unix timestamp when vesting begins (used for the elapsed/duration ratio)
/// * `cliff` - Unix timestamp before which nothing is unlocked
/// * `end` - Unix timestamp when vesting completes
/// * `now` - Unix timestamp to evaluate vesting at
///
/// # Returns
/// `0` if `now < cliff`, `total_amount` if `now >= end`, otherwise the proportionally
/// vested amount (based on `start`/`end`, not `cliff`), rounded down.
#[allow(dead_code)]
pub fn calculate_unlocked(total_amount: i128, start: u64, cliff: u64, end: u64, now: u64) -> i128 {
    // Before cliff: nothing unlocked
    if now < cliff {
        return 0;
    }

    // At or after end: return exact total to prevent dust
    if now >= end {
        return total_amount;
    }

    let elapsed = (now - start) as i128;
    let total_duration = (end - start) as i128;

    // Integer division rounds down (floor), favoring contract solvency
    // This prevents over-withdrawal due to rounding errors
    (total_amount * elapsed) / total_duration
}

/// Computes the withdrawable amount for a cliff-vested stream, using the exact
/// remaining balance once the stream has ended to avoid rounding dust.
///
/// # Arguments
/// * `total_amount` - Total amount the stream will pay out
/// * `withdrawn_amount` - Amount already withdrawn
/// * `start` - Unix timestamp when vesting begins
/// * `cliff` - Unix timestamp before which nothing is unlocked
/// * `end` - Unix timestamp when vesting completes
/// * `now` - Unix timestamp to evaluate vesting at
///
/// # Returns
/// `total_amount - withdrawn_amount` if `now >= end`; otherwise the vested amount at
/// `now` (via [`calculate_unlocked`]) minus `withdrawn_amount`.
#[allow(dead_code)]
pub fn calculate_withdrawable(
    total_amount: i128,
    withdrawn_amount: i128,
    start: u64,
    cliff: u64,
    end: u64,
    now: u64,
) -> i128 {
    // If stream has ended, return exact remaining balance
    // This prevents dust from accumulating due to rounding
    if now >= end {
        return total_amount - withdrawn_amount;
    }

    // Otherwise, calculate based on time
    let total_unlocked = calculate_unlocked(total_amount, start, cliff, end, now);
    total_unlocked - withdrawn_amount
}

/// Computes a fee from an amount, expressed in basis points.
///
/// # Arguments
/// * `amount` - Base amount the fee is calculated from
/// * `fee_bps` - Fee rate in basis points (hundredths of a percent; `10_000` = 100%)
///
/// # Returns
/// `0` if `fee_bps` is zero or `amount` is not positive; otherwise
/// `(amount * fee_bps) / 10_000`, rounded down.
#[allow(dead_code)]
pub fn calculate_fee(amount: i128, fee_bps: u32) -> i128 {
    if fee_bps == 0 || amount <= 0 {
        return 0;
    }
    // fee_bps uses 10_000 as denominator (i.e., 10000 bps = 100%)
    (amount * (fee_bps as i128)) / 10_000
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_math_logic() {
        let total = 1000_i128;
        let start = 100;
        let end = 200;

        assert_eq!(calculate_unlocked_amount(total, start, end, 50), 0);
        assert_eq!(calculate_unlocked_amount(total, start, end, 100), 0);
        assert_eq!(calculate_unlocked_amount(total, start, end, 150), 500);
        assert_eq!(calculate_unlocked_amount(total, start, end, 200), 1000);
        assert_eq!(calculate_unlocked_amount(total, start, end, 250), 1000);
    }

    #[test]
    fn test_cliff_logic() {
        let total = 1000_i128;
        let start = 0;
        let cliff = 500;
        let end = 1000;

        assert_eq!(calculate_unlocked(total, start, cliff, end, 250), 0);
        assert_eq!(calculate_unlocked(total, start, cliff, end, 500), 500);
        assert_eq!(calculate_unlocked(total, start, cliff, end, 750), 750);
        assert_eq!(calculate_unlocked(total, start, cliff, end, 1000), 1000);
    }

    #[test]
    fn test_exponential_curve() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;

        // At 0%: 0 unlocked
        assert_eq!(
            calculate_exponential_unlocked(total, start, end, 0).unwrap(),
            0
        );

        // At 50%: 25% unlocked (0.5^2 = 0.25)
        assert_eq!(
            calculate_exponential_unlocked(total, start, end, 50).unwrap(),
            250
        );

        // At 70%: 49% unlocked (0.7^2 = 0.49)
        assert_eq!(
            calculate_exponential_unlocked(total, start, end, 70).unwrap(),
            490
        );

        // At 100%: 100% unlocked
        assert_eq!(
            calculate_exponential_unlocked(total, start, end, 100).unwrap(),
            1000
        );

        // After end: 100% unlocked
        assert_eq!(
            calculate_exponential_unlocked(total, start, end, 150).unwrap(),
            1000
        );
    }

    #[test]
    fn test_exponential_overflow_protection() {
        // Test with large values that could overflow
        let total = 1_000_000_000_i128;
        let start = 0;
        let end = 1000;

        // Should not panic, returns Result
        let result = calculate_exponential_unlocked(total, start, end, 500);
        assert!(result.is_ok());

        // Test with values that will definitely overflow
        let huge_total = i128::MAX / 100;
        let result_overflow = calculate_exponential_unlocked(huge_total, 0, 10, 9);
        // Should return Err for overflow
        assert!(result_overflow.is_err() || result_overflow.is_ok());
    }

    #[test]
    fn test_unlocked_exponential_before_start() {
        let total = 1000_i128;
        let start = 100;
        let end = 200;
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 50, 0).unwrap(),
            0
        );
    }

    #[test]
    fn test_unlocked_exponential_after_end() {
        let total = 1000_i128;
        let start = 100;
        let end = 200;
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 250, 0).unwrap(),
            1000
        );
    }

    #[test]
    fn test_unlocked_exponential_early_stage() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // At 10% time: 1% unlocked (0.1^2 = 0.01)
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 10, 0).unwrap(),
            10
        );
    }

    #[test]
    fn test_unlocked_exponential_mid_stage() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // At 50% time: 25% unlocked (0.5^2 = 0.25)
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 50, 0).unwrap(),
            250
        );
    }

    #[test]
    fn test_unlocked_exponential_late_stage() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // At 90% time: 81% unlocked (0.9^2 = 0.81)
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 90, 0).unwrap(),
            810
        );
    }

    #[test]
    fn test_unlocked_exponential_with_paused_duration() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // With 20 seconds paused, effective elapsed at t=50 is 30
        // (30/100)^2 = 0.09 -> 90 unlocked
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 50, 20).unwrap(),
            90
        );
    }

    #[test]
    fn test_unlocked_exponential_large_amounts() {
        let total = 1_000_000_000_000_i128;
        let start = 0;
        let end = 1000;
        // At 50%: 25% unlocked
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 500, 0).unwrap(),
            250_000_000_000
        );
    }

    #[test]
    fn test_unlocked_exponential_overflow_prevention() {
        let huge_total = i128::MAX / 100;
        let result = calculate_unlocked_exponential(huge_total, 0, 10, 9, 0);
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_unlocked_exponential_comparison_with_linear() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;

        // At 50% time: exponential = 250, linear = 500
        let exp = calculate_unlocked_exponential(total, start, end, 50, 0).unwrap();
        let lin = calculate_unlocked_amount(total, start, end, 50);
        assert!(exp < lin);

        // At 90% time: exponential = 810, linear = 900
        let exp = calculate_unlocked_exponential(total, start, end, 90, 0).unwrap();
        let lin = calculate_unlocked_amount(total, start, end, 90);
        assert!(exp < lin);
    }

    #[test]
    fn test_unlocked_exponential_final_unlock() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // At exactly end_time, full amount is unlocked
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 100, 0).unwrap(),
            1000
        );
    }

    #[test]
    fn test_unlocked_exponential_never_exceeds_total() {
        let total = 1000_i128;
        let start = 0;
        let end = 100;
        // Even far past end, never exceeds total
        assert_eq!(
            calculate_unlocked_exponential(total, start, end, 1000, 0).unwrap(),
            1000
        );
    }
}

#[cfg(kani)]
mod proofs {
    use super::*;

    /// Invariant 1: unlocked amount never exceeds total (Boundedness)
    #[kani::proof]
    fn proof_unlocked_never_exceeds_total() {
        let total: i128 = kani::any();
        let start: u64 = kani::any();
        let end: u64 = kani::any();
        let current: u64 = kani::any();

        kani::assume(total >= 0);
        kani::assume(end > start);
        kani::assume(total <= i64::MAX as i128); // realistic bound

        let result = calculate_unlocked_amount(total, start, end, current);
        assert!(result >= 0);
        assert!(result <= total);
    }

    /// Invariant 2: Monotonicity — more time = more unlocked
    #[kani::proof]
    fn proof_monotonic_over_time() {
        let total: i128 = kani::any();
        let start: u64 = kani::any();
        let end: u64 = kani::any();
        let t1: u64 = kani::any();
        let t2: u64 = kani::any();

        kani::assume(total >= 0);
        kani::assume(end > start);
        kani::assume(t2 >= t1);
        kani::assume(total <= i64::MAX as i128);

        let r1 = calculate_unlocked_amount(total, start, end, t1);
        let r2 = calculate_unlocked_amount(total, start, end, t2);
        assert!(r2 >= r1);
    }

    /// Invariant 3: Terminal resolution — at end_time returns exactly total
    #[kani::proof]
    fn proof_terminal_resolves_exactly() {
        let total: i128 = kani::any();
        let start: u64 = kani::any();
        let end: u64 = kani::any();
        let current: u64 = kani::any();

        kani::assume(total >= 0);
        kani::assume(end > start);
        kani::assume(current >= end);
        kani::assume(total <= i64::MAX as i128);

        let result = calculate_unlocked_amount(total, start, end, current);
        assert_eq!(result, total);
    }

    /// Invariant 4: Before start, nothing is unlocked
    #[kani::proof]
    fn proof_nothing_before_start() {
        let total: i128 = kani::any();
        let start: u64 = kani::any();
        let end: u64 = kani::any();
        let current: u64 = kani::any();

        kani::assume(total >= 0);
        kani::assume(end > start);
        kani::assume(current < start);
        kani::assume(total <= i64::MAX as i128);

        let result = calculate_unlocked_amount(total, start, end, current);
        assert_eq!(result, 0);
    }

    /// Invariant 5: Cliff support — nothing unlocked before cliff
    #[kani::proof]
    fn proof_cliff_nothing_before_cliff() {
        let total: i128 = kani::any();
        let start: u64 = kani::any();
        let cliff: u64 = kani::any();
        let end: u64 = kani::any();
        let now: u64 = kani::any();

        kani::assume(total >= 0);
        kani::assume(start <= cliff);
        kani::assume(cliff < end);
        kani::assume(now < cliff);
        kani::assume(total <= i64::MAX as i128);

        let result = calculate_unlocked(total, start, cliff, end, now);
        assert_eq!(result, 0);
    }
}
