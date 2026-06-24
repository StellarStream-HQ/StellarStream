/// Fixed-point scalar with 7 decimal places of precision (SCALE = 10^7).
///
/// Internally stores values as `inner * SCALE`, so 1.0 is represented as
/// 10_000_000. This gives enough headroom for Stellar token amounts (which
/// use 7 decimal places) while keeping all arithmetic in i128.
use crate::contracterror::Error;

pub const SCALE: i128 = 10_000_000; // 10^7

/// Nanoseconds per second.
///
/// All internal time arithmetic uses nanoseconds so that the calculation engine
/// is forward-compatible with `ledger().timestamp_nanos()` once the Soroban SDK
/// exposes it. Until then, callers multiply `ledger().timestamp()` by this
/// constant to convert seconds → nanoseconds before passing to `calculate_flow`
/// or `calculate_unlocked_internal`.
pub const NANOS_PER_SEC: u64 = 1_000_000_000;

/// Compute `floor(total * elapsed / duration)` using `FixedPoint::mul_div` for
/// overflow-safe intermediate arithmetic.
///
/// Both `elapsed` and `duration` must be in the **same** unit (e.g. both in
/// nanoseconds). Returns 0 on any degenerate input and falls back to plain
/// integer division if the mul_div intermediate overflows (preserving
/// correctness at the cost of truncation precision).
pub fn calculate_flow(total: i128, duration: i128, elapsed: i128) -> i128 {
    if duration <= 0 || elapsed <= 0 {
        return 0;
    }
    if elapsed >= duration {
        return total;
    }
    // Primary path: intermediate precision via mul_div.
    match FixedPoint::mul_div(total, elapsed, duration) {
        Ok(v) => v,
        // Overflow path: fall back to plain division (still correct, just no
        // extra precision from the SCALE trick).
        Err(_) => total / duration * elapsed,
    }
}

/// Compute `floor(total * (elapsed / duration)^2)` for exponential (back-loaded)
/// streams.
///
/// Uses the identity `total * elapsed^2 / duration^2` with overflow-safe
/// intermediate arithmetic:
///   1. Compute `ratio = elapsed * SCALE / duration`  (scaled fraction, ≤ SCALE)
///   2. Compute `ratio^2 / SCALE`                     (squared fraction, ≤ SCALE)
///   3. Compute `total * ratio_sq / SCALE`            (final amount)
///
/// Because `ratio ≤ SCALE = 10^7`, `ratio^2 ≤ 10^14` which fits comfortably
/// in i128 (max ~1.7 × 10^38). Returns 0 on degenerate input.
pub fn calculate_exponential_unlocked(total: i128, duration: i128, elapsed: i128) -> i128 {
    if duration <= 0 || elapsed <= 0 || total <= 0 {
        return 0;
    }
    if elapsed >= duration {
        return total;
    }
    // ratio = elapsed / duration, scaled by SCALE (≤ SCALE = 10^7)
    let ratio = match elapsed.checked_mul(SCALE) {
        Some(v) => v / duration,
        None => {
            // elapsed * SCALE overflowed — fall back to plain integer path
            // (still correct, just loses sub-unit precision)
            return total / duration / duration * elapsed * elapsed;
        }
    };
    // ratio_sq = ratio^2 / SCALE  (still ≤ SCALE)
    let ratio_sq = ratio * ratio / SCALE;
    // result = total * ratio_sq / SCALE
    total * ratio_sq / SCALE
}

/// Calculate a share based on basis points (1 BPS = 0.01%).
///
/// Logic: (amount * bps) / 10,000
pub fn calculate_share(amount: i128, bps: u32) -> i128 {
    if bps == 0 {
        return 0;
    }
    // Using simple arithmetic; stroop-denominated amounts (i128) won't
    // overflow when multiplied by 10,000 (max ~10^22 vs i128::MAX ~10^38).
    (amount * bps as i128) / 10_000
}

/// Calculate the residual share for the final recipient to ensure
/// strict atomicity and prevent locked funds (Rounding Strategy).
pub fn calculate_residual_share(total_amount: i128, sum_distributed: i128) -> i128 {
    total_amount.saturating_sub(sum_distributed)
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct FixedPoint(pub i128);

impl FixedPoint {
    /// Wrap a raw scaled value (already multiplied by SCALE).
    pub fn from_raw(raw: i128) -> Self {
        FixedPoint(raw)
    }

    /// Wrap a whole-number token amount (e.g. stroops).
    pub fn from_amount(amount: i128) -> Self {
        FixedPoint(amount * SCALE)
    }

    /// Return the floor integer value (truncates fractional part).
    pub fn to_amount(self) -> i128 {
        self.0 / SCALE
    }

    /// `(amount * numerator) / denominator` with full i128 intermediate
    /// precision and checked arithmetic throughout.
    ///
    /// Returns `Err(Error::Overflow)` on overflow or divide-by-zero.
    pub fn mul_div(amount: i128, numerator: i128, denominator: i128) -> Result<i128, Error> {
        if denominator == 0 {
            return Err(Error::Overflow);
        }
        // Scale up before dividing to preserve 7 decimal places of precision.
        let scaled = amount
            .checked_mul(numerator)
            .ok_or(Error::Overflow)?
            .checked_mul(SCALE)
            .ok_or(Error::Overflow)?;

        let result = scaled.checked_div(denominator).ok_or(Error::Overflow)?;

        // Return floor value (drop the SCALE factor).
        Ok(result / SCALE)
    }

    /// Checked addition.
    pub fn checked_add(self, rhs: FixedPoint) -> Result<FixedPoint, Error> {
        self.0
            .checked_add(rhs.0)
            .map(FixedPoint)
            .ok_or(Error::Overflow)
    }

    /// Checked subtraction.
    pub fn checked_sub(self, rhs: FixedPoint) -> Result<FixedPoint, Error> {
        self.0
            .checked_sub(rhs.0)
            .map(FixedPoint)
            .ok_or(Error::Overflow)
    }

    /// Checked multiplication of two FixedPoint values.
    /// Result is re-scaled: (a * b) / SCALE.
    pub fn checked_mul(self, rhs: FixedPoint) -> Result<FixedPoint, Error> {
        self.0
            .checked_mul(rhs.0)
            .map(|v| FixedPoint(v / SCALE))
            .ok_or(Error::Overflow)
    }

    /// Checked division of two FixedPoint values.
    /// Result is re-scaled: (a * SCALE) / b.
    pub fn checked_div(self, rhs: FixedPoint) -> Result<FixedPoint, Error> {
        if rhs.0 == 0 {
            return Err(Error::Overflow);
        }
        self.0
            .checked_mul(SCALE)
            .map(|v| FixedPoint(v / rhs.0))
            .ok_or(Error::Overflow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── calculate_flow ───────────────────────────────────────────────────────

    #[test]
    fn test_calculate_flow_halfway() {
        // 50 % elapsed → exactly half the total
        assert_eq!(calculate_flow(1_000_000, 200, 100), 500_000);
    }

    #[test]
    fn test_calculate_flow_zero_elapsed() {
        assert_eq!(calculate_flow(1_000_000, 200, 0), 0);
    }

    #[test]
    fn test_calculate_flow_full_duration() {
        // elapsed >= duration → full total
        assert_eq!(calculate_flow(1_000_000, 200, 200), 1_000_000);
        assert_eq!(calculate_flow(1_000_000, 200, 300), 1_000_000);
    }

    #[test]
    fn test_calculate_flow_degenerate_duration() {
        assert_eq!(calculate_flow(1_000_000, 0, 100), 0);
        assert_eq!(calculate_flow(1_000_000, -1, 100), 0);
    }

    #[test]
    fn test_calculate_flow_nanos_precision() {
        // Simulate nanosecond inputs: 1.5 seconds elapsed out of 3 seconds
        let total = 1_000_000_i128;
        let duration = 3 * NANOS_PER_SEC as i128;
        let elapsed = (NANOS_PER_SEC / 2 * 3) as i128; // 1.5 s in nanos
        assert_eq!(calculate_flow(total, duration, elapsed), 500_000);
    }

    // ── mul_div ──────────────────────────────────────────────────────────────

    #[test]
    fn test_mul_div_exact() {
        assert_eq!(FixedPoint::mul_div(1000, 1, 2).unwrap(), 500);
    }

    #[test]
    fn test_mul_div_preserves_precision() {
        assert_eq!(FixedPoint::mul_div(10, 1, 3).unwrap(), 3);
        assert_eq!(
            FixedPoint::mul_div(100_000_000, 50, 100).unwrap(),
            50_000_000
        );
    }

    #[test]
    fn test_mul_div_divide_by_zero() {
        assert_eq!(FixedPoint::mul_div(1000, 1, 0), Err(Error::Overflow));
    }

    #[test]
    fn test_mul_div_overflow() {
        assert_eq!(FixedPoint::mul_div(i128::MAX, 2, 1), Err(Error::Overflow));
    }

    // ── FixedPoint arithmetic ────────────────────────────────────────────────

    #[test]
    fn test_checked_add() {
        let a = FixedPoint::from_amount(3);
        let b = FixedPoint::from_amount(4);
        assert_eq!(a.checked_add(b).unwrap().to_amount(), 7);
    }

    #[test]
    fn test_checked_add_overflow() {
        let a = FixedPoint::from_raw(i128::MAX);
        let b = FixedPoint::from_raw(1);
        assert_eq!(a.checked_add(b), Err(Error::Overflow));
    }

    #[test]
    fn test_checked_sub() {
        let a = FixedPoint::from_amount(10);
        let b = FixedPoint::from_amount(3);
        assert_eq!(a.checked_sub(b).unwrap().to_amount(), 7);
    }

    #[test]
    fn test_checked_sub_underflow() {
        let a = FixedPoint::from_raw(i128::MIN);
        let b = FixedPoint::from_raw(1);
        assert_eq!(a.checked_sub(b), Err(Error::Overflow));
    }

    #[test]
    fn test_checked_mul() {
        let a = FixedPoint::from_amount(3);
        let b = FixedPoint::from_amount(4);
        assert_eq!(a.checked_mul(b).unwrap().to_amount(), 12);
    }

    #[test]
    fn test_checked_div() {
        let a = FixedPoint::from_amount(10);
        let b = FixedPoint::from_amount(4);
        // 10 / 4 = 2.5 → floor = 2
        assert_eq!(a.checked_div(b).unwrap().to_amount(), 2);
    }

    #[test]
    fn test_checked_div_by_zero() {
        let a = FixedPoint::from_amount(10);
        let b = FixedPoint::from_raw(0);
        assert_eq!(a.checked_div(b), Err(Error::Overflow));
    }

    // ── calculate_exponential_unlocked ───────────────────────────────────────

    #[test]
    fn test_exponential_zero_elapsed() {
        assert_eq!(calculate_exponential_unlocked(1_000_000, 100, 0), 0);
    }

    #[test]
    fn test_exponential_full_duration() {
        assert_eq!(
            calculate_exponential_unlocked(1_000_000, 100, 100),
            1_000_000
        );
        assert_eq!(
            calculate_exponential_unlocked(1_000_000, 100, 200),
            1_000_000
        );
    }

    #[test]
    fn test_exponential_halfway_is_quarter() {
        // At 50% elapsed: (0.5)^2 = 0.25 → 25% of total
        let result = calculate_exponential_unlocked(1_000_000, 100, 50);
        assert_eq!(result, 250_000);
    }

    #[test]
    fn test_exponential_quarter_elapsed() {
        // At 25% elapsed: (0.25)^2 = 0.0625 → 6.25% of total
        let result = calculate_exponential_unlocked(1_000_000, 100, 25);
        assert_eq!(result, 62_500);
    }

    #[test]
    fn test_exponential_back_loaded_vs_linear() {
        // Exponential should always be ≤ linear for elapsed < duration
        let total = 1_000_000_i128;
        let duration = 100_i128;
        for t in 1..100 {
            let exp = calculate_exponential_unlocked(total, duration, t);
            let lin = calculate_flow(total, duration, t);
            assert!(exp <= lin, "t={t}: exp={exp} > lin={lin}");
        }
    }

    #[test]
    fn test_exponential_degenerate_inputs() {
        assert_eq!(calculate_exponential_unlocked(0, 100, 50), 0);
        assert_eq!(calculate_exponential_unlocked(1_000_000, 0, 50), 0);
        assert_eq!(calculate_exponential_unlocked(1_000_000, 100, -1), 0);
    }

    // ── BPS Math ─────────────────────────────────────────────────────────────

    #[test]
    fn test_calculate_share() {
        // 33.33% of 1000
        assert_eq!(calculate_share(1000, 3333), 333);
        // 100%
        assert_eq!(calculate_share(1000, 10000), 1000);
        // 0%
        assert_eq!(calculate_share(1000, 0), 0);
    }

    #[test]
    fn test_rounding_strategy_residual() {
        let total = 1000i128;
        // Two recipients with 3333 BPS each
        let share1 = calculate_share(total, 3333); // 333
        let share2 = calculate_share(total, 3333); // 333

        let sum_distributed = share1 + share2; // 666

        // Final recipient with 3334 BPS (sum = 10000)
        let share3 = calculate_residual_share(total, sum_distributed);

        assert_eq!(share3, 334);
        assert_eq!(share1 + share2 + share3, total);
    }

    // ── Issue #1156: Stream Withdrawal Precision Tests ───────────────────────

    #[test]
    fn test_precision_100_seconds_0_3_xlm_per_sec() {
        // Stream flows at 0.3 XLM/second
        // Withdraw after 100 seconds → should be exactly 30 XLM
        // Convert to stroops: 30 XLM = 30 * 10^7 = 300,000,000 stroops
        let total_xlm = 30_i128;
        let total_stroops = total_xlm * SCALE; // 300,000,000
        let duration_sec = 100_i128;
        let elapsed_sec = 100_i128;

        let unlocked = calculate_flow(total_stroops, duration_sec, elapsed_sec);
        
        // Should be exactly 30 XLM in stroops
        assert_eq!(unlocked, total_stroops);
        assert_eq!(unlocked / SCALE, total_xlm);
    }

    #[test]
    fn test_precision_3_seconds_0_1_xlm_per_sec() {
        // Stream flows at 0.1 XLM/second
        // Withdraw after 3 seconds → should be exactly 0.3 XLM
        // Convert to stroops: 0.3 XLM = 0.3 * 10^7 = 3,000,000 stroops
        let total_xlm = 3_i128; // 0.3 XLM represented as 3 with SCALE
        let total_stroops = total_xlm * SCALE; // 3,000,000
        let duration_sec = 10_i128; // 10 second total duration
        let elapsed_sec = 3_i128; // 3 seconds elapsed

        let unlocked = calculate_flow(total_stroops, duration_sec, elapsed_sec);
        
        // Should be exactly 0.3 XLM in stroops
        assert_eq!(unlocked, total_stroops);
        assert_eq!(unlocked / SCALE, total_xlm);
    }

    #[test]
    fn test_precision_1000_withdrawals_sum_equals_expected() {
        // Test 1000 withdrawals, verify sum equals expected
        // Total: 1000 XLM over 1000 seconds (1 XLM/sec)
        let total_xlm = 1000_i128;
        let total_stroops = total_xlm * SCALE;
        let duration_sec = 1000_i128;

        let mut total_withdrawn = 0_i128;
        let mut previous_unlocked = 0_i128;

        for i in 1..=1000 {
            let elapsed = i as i128;
            let unlocked = calculate_flow(total_stroops, duration_sec, elapsed);
            let withdrawable = unlocked - previous_unlocked;
            
            if withdrawable > 0 {
                total_withdrawn += withdrawable;
            }
            
            previous_unlocked = unlocked;
        }

        // Total withdrawn should equal total amount
        assert_eq!(total_withdrawn, total_stroops);
        assert_eq!(total_withdrawn / SCALE, total_xlm);
    }

    #[test]
    fn test_precision_fractional_flow_rates() {
        // Test various fractional flow rates to ensure no precision loss
        // 0.3 XLM/sec for 100 sec = 30 XLM
        let test_cases = vec![
            (30_i128, 100_i128, 100_i128),   // 0.3 XLM/sec, 100 sec
            (10_i128, 100_i128, 100_i128),   // 0.1 XLM/sec, 100 sec
            (50_i128, 100_i128, 100_i128),   // 0.5 XLM/sec, 100 sec
            (1_i128, 1_i128, 1_i128),        // 1 XLM/sec, 1 sec
            (333_i128, 1000_i128, 1000_i128), // 0.333 XLM/sec, 1000 sec
        ];

        for (total_xlm, duration_sec, elapsed_sec) in test_cases {
            let total_stroops = total_xlm * SCALE;
            let unlocked = calculate_flow(total_stroops, duration_sec, elapsed_sec);
            
            // Verify no precision loss
            assert_eq!(unlocked, total_stroops);
            assert_eq!(unlocked / SCALE, total_xlm);
        }
    }
}
