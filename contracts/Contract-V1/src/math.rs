use crate::types::Error;

pub const SECONDS_PER_DAY: u64 = 86_400;
pub const SECONDS_PER_MONTH: u64 = 2_592_000; // 30 days * 86,400 seconds

/// Calculates the effective streaming duration considering total duration and paused duration.
pub fn calculate_effective_duration(
    start_time: u64,
    end_time: u64,
    paused_duration: u64,
) -> Result<u64, Error> {
    if end_time <= start_time {
        return Err(Error::InvalidTimeRange);
    }
    let total_duration = end_time - start_time;
    if paused_duration >= total_duration {
        return Err(Error::ZeroDuration);
    }
    Ok(total_duration - paused_duration)
}

/// Calculates the rate of token transfer per second for a stream.
/// rate = total_amount / effective_duration
pub fn calculate_rate_per_second(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    paused_duration: u64,
) -> Result<i128, Error> {
    if total_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let duration = calculate_effective_duration(start_time, end_time, paused_duration)?;
    if duration == 0 {
        return Err(Error::ZeroDuration);
    }
    Ok(total_amount / (duration as i128))
}

/// Calculates the rate of token transfer per day (86,400 seconds) for a stream.
/// Uses higher precision multiplication before division: (total_amount * 86400) / duration.
pub fn calculate_rate_per_day(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    paused_duration: u64,
) -> Result<i128, Error> {
    if total_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let duration = calculate_effective_duration(start_time, end_time, paused_duration)?;
    if duration == 0 {
        return Err(Error::ZeroDuration);
    }
    let scaled = total_amount
        .checked_mul(SECONDS_PER_DAY as i128)
        .ok_or(Error::CalculationOverflow)?;
    Ok(scaled / (duration as i128))
}

/// Calculates the rate of token transfer per month (2,592,000 seconds / 30 days) for a stream.
/// Uses higher precision multiplication before division: (total_amount * 2592000) / duration.
pub fn calculate_rate_per_month(
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    paused_duration: u64,
) -> Result<i128, Error> {
    if total_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    let duration = calculate_effective_duration(start_time, end_time, paused_duration)?;
    if duration == 0 {
        return Err(Error::ZeroDuration);
    }
    let scaled = total_amount
        .checked_mul(SECONDS_PER_MONTH as i128)
        .ok_or(Error::CalculationOverflow)?;
    Ok(scaled / (duration as i128))
}

/// Calculates total vested amount for a stream up to the current timestamp.
pub fn calculate_vested_amount(stream: &crate::types::Stream, current_time: u64) -> Result<i128, Error> {
    if current_time <= stream.start_time {
        return Ok(0);
    }

    let effective_duration = calculate_effective_duration(
        stream.start_time,
        stream.end_time,
        stream.paused_duration,
    )?;

    if effective_duration == 0 {
        return Ok(0);
    }

    let elapsed = if current_time >= stream.end_time {
        effective_duration
    } else {
        let raw_elapsed = current_time - stream.start_time;
        if raw_elapsed > stream.paused_duration {
            (raw_elapsed - stream.paused_duration).min(effective_duration)
        } else {
            0
        }
    };

    let vested = (stream.total_amount as i128)
        .checked_mul(elapsed as i128)
        .ok_or(Error::CalculationOverflow)?
        / (effective_duration as i128);

    Ok(vested.min(stream.total_amount))
}
