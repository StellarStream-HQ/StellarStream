import { Stream, StreamingRates, StreamState } from "./types.js";
import { InvalidTimeRangeError, ZeroDurationError } from "./errors.js";

export const SECONDS_PER_DAY = 86_400n;
export const SECONDS_PER_MONTH = 2_592_000n; // 30 days

/**
 * Calculates the current vested token amount for a given stream at a specific timestamp.
 */
export function calculateVestedAmount(stream: Stream, currentTimestamp: bigint): bigint {
  if (currentTimestamp <= stream.startTime) {
    return 0n;
  }

  const effectiveDuration = (stream.endTime - stream.startTime) - stream.pausedDuration;
  if (effectiveDuration <= 0n) {
    throw new ZeroDurationError();
  }

  // Determine elapsed time considering paused state
  let effectiveElapsed: bigint;
  if (stream.state === StreamState.Paused && stream.lastPausedTime > 0n) {
    // If paused, elapsed time caps at the timestamp when it was paused
    const pauseTime = stream.lastPausedTime < currentTimestamp ? stream.lastPausedTime : currentTimestamp;
    effectiveElapsed = (pauseTime - stream.startTime) - stream.pausedDuration;
  } else {
    effectiveElapsed = (currentTimestamp - stream.startTime) - stream.pausedDuration;
  }

  if (effectiveElapsed <= 0n) {
    return 0n;
  }

  if (effectiveElapsed >= effectiveDuration) {
    return stream.totalAmount;
  }

  // Linear interpolation: (totalAmount * effectiveElapsed) / effectiveDuration
  return (stream.totalAmount * effectiveElapsed) / effectiveDuration;
}

/**
 * Calculates the claimable (withdrawable) amount of tokens for a receiver.
 */
export function calculateClaimableAmount(stream: Stream, currentTimestamp: bigint): bigint {
  const vested = calculateVestedAmount(stream, currentTimestamp);
  if (vested <= stream.withdrawnAmount) {
    return 0n;
  }
  return vested - stream.withdrawnAmount;
}

/**
 * Calculates rate per second: totalAmount / (endTime - startTime - pausedDuration)
 */
export function calculateRatePerSecond(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  pausedDuration: bigint = 0n,
): bigint {
  if (endTime <= startTime) {
    throw new InvalidTimeRangeError();
  }
  const effectiveDuration = (endTime - startTime) - pausedDuration;
  if (effectiveDuration <= 0n) {
    throw new ZeroDurationError();
  }
  return totalAmount / effectiveDuration;
}

/**
 * Calculates rate per day (86,400s): (totalAmount * 86,400) / effectiveDuration
 */
export function calculateRatePerDay(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  pausedDuration: bigint = 0n,
): bigint {
  if (endTime <= startTime) {
    throw new InvalidTimeRangeError();
  }
  const effectiveDuration = (endTime - startTime) - pausedDuration;
  if (effectiveDuration <= 0n) {
    throw new ZeroDurationError();
  }
  return (totalAmount * SECONDS_PER_DAY) / effectiveDuration;
}

/**
 * Calculates rate per month (2,592,000s / 30 days): (totalAmount * 2,592,000) / effectiveDuration
 */
export function calculateRatePerMonth(
  totalAmount: bigint,
  startTime: bigint,
  endTime: bigint,
  pausedDuration: bigint = 0n,
): bigint {
  if (endTime <= startTime) {
    throw new InvalidTimeRangeError();
  }
  const effectiveDuration = (endTime - startTime) - pausedDuration;
  if (effectiveDuration <= 0n) {
    throw new ZeroDurationError();
  }
  return (totalAmount * SECONDS_PER_MONTH) / effectiveDuration;
}

/**
 * Calculates all three streaming rates for a given stream.
 */
export function calculateAllStreamingRates(stream: Stream): StreamingRates {
  return {
    ratePerSecond: calculateRatePerSecond(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration),
    ratePerDay: calculateRatePerDay(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration),
    ratePerMonth: calculateRatePerMonth(stream.totalAmount, stream.startTime, stream.endTime, stream.pausedDuration),
  };
}
