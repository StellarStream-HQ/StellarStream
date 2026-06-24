#!/usr/bin/env python3
"""
Reference implementation for stream withdrawal precision calculations.
Used to verify the Rust fixed-point arithmetic implementation.

Issue #1156: Stream Withdrawal Precision Bug
"""

from decimal import Decimal, getcontext

# Set high precision for decimal calculations
getcontext().prec = 28

# Stellar constants
STROOPS_PER_XLM = 10_000_000  # 10^7 stroops per XLM


def calculate_unlocked_fixed_point(total_stroops: int, duration_sec: int, elapsed_sec: int) -> int:
    """
    Calculate unlocked amount using fixed-point arithmetic (matching Rust implementation).
    
    Formula: (total * elapsed) / duration
    All values are in stroops (integer arithmetic).
    
    Args:
        total_stroops: Total amount in stroops (i128 in Rust)
        duration_sec: Total duration in seconds
        elapsed_sec: Elapsed time in seconds
    
    Returns:
        Unlocked amount in stroops
    """
    if duration_sec <= 0 or elapsed_sec <= 0:
        return 0
    if elapsed_sec >= duration_sec:
        return total_stroops
    
    # Fixed-point arithmetic: (total * elapsed) / duration
    return (total_stroops * elapsed_sec) // duration_sec


def calculate_unlocked_float(total_xlm: float, duration_sec: float, elapsed_sec: float) -> float:
    """
    Calculate unlocked amount using floating-point arithmetic (buggy version).
    
    Formula: total * (elapsed / duration)
    Uses float arithmetic which can lose precision.
    
    Args:
        total_xlm: Total amount in XLM (float)
        duration_sec: Total duration in seconds
        elapsed_sec: Elapsed time in seconds
    
    Returns:
        Unlocked amount in XLM
    """
    if duration_sec <= 0 or elapsed_sec <= 0:
        return 0.0
    if elapsed_sec >= duration_sec:
        return total_xlm
    
    return total_xlm * (elapsed_sec / duration_sec)


def calculate_unlocked_decimal(total_xlm: Decimal, duration_sec: Decimal, elapsed_sec: Decimal) -> Decimal:
    """
    Calculate unlocked amount using Decimal arithmetic (high precision reference).
    
    Args:
        total_xlm: Total amount in XLM (Decimal)
        duration_sec: Total duration in seconds (Decimal)
        elapsed_sec: Elapsed time in seconds (Decimal)
    
    Returns:
        Unlocked amount in XLM (Decimal)
    """
    if duration_sec <= 0 or elapsed_sec <= 0:
        return Decimal('0')
    if elapsed_sec >= duration_sec:
        return total_xlm
    
    return total_xlm * (elapsed_sec / duration_sec)


def test_case_1():
    """Test: 100 seconds @ 0.3 XLM/sec = exactly 30.0 XLM"""
    print("\n=== Test Case 1: 100 seconds @ 0.3 XLM/sec ===")
    
    total_xlm = 30.0
    duration_sec = 100.0
    elapsed_sec = 100.0
    
    # Float version (buggy)
    result_float = calculate_unlocked_float(total_xlm, duration_sec, elapsed_sec)
    print(f"Float result: {result_float:.15f} XLM")
    
    # Fixed-point version (correct)
    total_stroops = int(total_xlm * STROOPS_PER_XLM)
    result_fixed = calculate_unlocked_fixed_point(total_stroops, int(duration_sec), int(elapsed_sec))
    result_fixed_xlm = result_fixed / STROOPS_PER_XLM
    print(f"Fixed-point result: {result_fixed_xlm:.15f} XLM")
    
    # Decimal version (reference)
    result_decimal = calculate_unlocked_decimal(
        Decimal(str(total_xlm)), 
        Decimal(str(duration_sec)), 
        Decimal(str(elapsed_sec))
    )
    print(f"Decimal result: {result_decimal} XLM")
    
    # Verify
    assert result_fixed_xlm == total_xlm, f"Fixed-point failed: {result_fixed_xlm} != {total_xlm}"
    assert abs(result_float - total_xlm) > 1e-10, "Float should have precision loss"
    print("✓ Test passed: Fixed-point is exact, float has precision loss")


def test_case_2():
    """Test: 3 seconds @ 0.1 XLM/sec = exactly 0.3 XLM"""
    print("\n=== Test Case 2: 3 seconds @ 0.1 XLM/sec ===")
    
    total_xlm = 0.3
    duration_sec = 10.0
    elapsed_sec = 3.0
    
    # Float version (buggy)
    result_float = calculate_unlocked_float(total_xlm, duration_sec, elapsed_sec)
    print(f"Float result: {result_float:.15f} XLM")
    
    # Fixed-point version (correct)
    total_stroops = int(total_xlm * STROOPS_PER_XLM)
    result_fixed = calculate_unlocked_fixed_point(total_stroops, int(duration_sec), int(elapsed_sec))
    result_fixed_xlm = result_fixed / STROOPS_PER_XLM
    print(f"Fixed-point result: {result_fixed_xlm:.15f} XLM")
    
    # Decimal version (reference)
    result_decimal = calculate_unlocked_decimal(
        Decimal(str(total_xlm)), 
        Decimal(str(duration_sec)), 
        Decimal(str(elapsed_sec))
    )
    print(f"Decimal result: {result_decimal} XLM")
    
    # Verify
    expected_xlm = 0.3
    assert result_fixed_xlm == expected_xlm, f"Fixed-point failed: {result_fixed_xlm} != {expected_xlm}"
    print("✓ Test passed: Fixed-point is exact")


def test_case_3():
    """Test: 1000 withdrawals, verify sum equals expected"""
    print("\n=== Test Case 3: 1000 withdrawals sum ===")
    
    total_xlm = 1000.0
    duration_sec = 1000.0
    total_stroops = int(total_xlm * STROOPS_PER_XLM)
    
    # Fixed-point version
    total_withdrawn_fixed = 0
    previous_unlocked = 0
    
    for i in range(1, 1001):
        elapsed = i
        unlocked = calculate_unlocked_fixed_point(total_stroops, int(duration_sec), elapsed)
        withdrawable = unlocked - previous_unlocked
        if withdrawable > 0:
            total_withdrawn_fixed += withdrawable
        previous_unlocked = unlocked
    
    total_withdrawn_fixed_xlm = total_withdrawn_fixed / STROOPS_PER_XLM
    print(f"Fixed-point total withdrawn: {total_withdrawn_fixed_xlm:.15f} XLM")
    print(f"Expected total: {total_xlm:.15f} XLM")
    
    assert total_withdrawn_fixed_xlm == total_xlm, f"Sum mismatch: {total_withdrawn_fixed_xlm} != {total_xlm}"
    print("✓ Test passed: 1000 withdrawals sum to exact total")


def test_fractional_flow_rates():
    """Test various fractional flow rates"""
    print("\n=== Test Case 4: Fractional flow rates ===")
    
    test_cases = [
        (30, 100, 100),   # 0.3 XLM/sec, 100 sec
        (10, 100, 100),   # 0.1 XLM/sec, 100 sec
        (50, 100, 100),   # 0.5 XLM/sec, 100 sec
        (1, 1, 1),        # 1 XLM/sec, 1 sec
        (333, 1000, 1000), # 0.333 XLM/sec, 1000 sec
    ]
    
    for total_xlm, duration_sec, elapsed_sec in test_cases:
        total_stroops = total_xlm * STROOPS_PER_XLM
        result = calculate_unlocked_fixed_point(total_stroops, duration_sec, elapsed_sec)
        result_xlm = result / STROOPS_PER_XLM
        
        assert result_xlm == total_xlm, f"Failed for {total_xlm} XLM: {result_xlm} != {total_xlm}"
        print(f"✓ {total_xlm} XLM over {duration_sec} sec: exact")
    
    print("✓ All fractional flow rate tests passed")


if __name__ == "__main__":
    print("=" * 60)
    print("Stream Withdrawal Precision Reference Implementation")
    print("Issue #1156: Fix Stream Withdrawal Precision Bug")
    print("=" * 60)
    
    test_case_1()
    test_case_2()
    test_case_3()
    test_fractional_flow_rates()
    
    print("\n" + "=" * 60)
    print("All tests passed!")
    print("Fixed-point arithmetic (i128) preserves precision")
    print("Floating-point arithmetic loses precision")
    print("=" * 60)
