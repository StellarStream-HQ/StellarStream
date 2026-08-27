import { AnalyticsDatabase } from "../db/storage.js";
import { StreamRecord } from "../db/types.js";
import {
  AmountMetricsResponse,
  CancellationMetricsResponse,
  DurationMetricsResponse,
  VolumeBucket,
  VolumeMetricsResponse,
  WithdrawalPatternMetrics,
} from "./types.js";

export function formatDurationHuman(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : `${seconds}s`;
}

export class StreamMetricsCalculator {
  private db: AnalyticsDatabase;

  constructor(db: AnalyticsDatabase) {
    this.db = db;
  }

  /**
   * Calculate stream creation volume grouped by day, week, or month
   */
  public getVolumeMetrics(timeframe: "day" | "week" | "month" = "day", tokenSymbol?: string): VolumeMetricsResponse {
    let streams = this.db.getStreams();
    if (tokenSymbol) {
      streams = streams.filter((s) => s.tokenSymbol.toLowerCase() === tokenSymbol.toLowerCase());
    }

    if (streams.length === 0) {
      return {
        timeframe,
        totalStreams: 0,
        totalVolumeFormatted: 0,
        averageStreamSizeFormatted: 0,
        buckets: [],
        growthRatePercent: 0,
      };
    }

    const bucketMap = new Map<
      string,
      {
        count: number;
        volume: number;
        withdrawn: number;
        senders: Set<string>;
        receivers: Set<string>;
      }
    >();

    for (const stream of streams) {
      const date = new Date(stream.createdAtTime);
      let key = date.toISOString().split("T")[0]; // default day: YYYY-MM-DD

      if (timeframe === "month") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      } else if (timeframe === "week") {
        const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
        const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
        const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
        key = `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
      }

      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          count: 0,
          volume: 0,
          withdrawn: 0,
          senders: new Set(),
          receivers: new Set(),
        });
      }

      const b = bucketMap.get(key)!;
      b.count += 1;
      b.volume += stream.totalAmountFormatted;
      b.withdrawn += stream.withdrawnAmountFormatted;
      if (stream.sender) b.senders.add(stream.sender);
      if (stream.receiver) b.receivers.add(stream.receiver);
    }

    const sortedKeys = Array.from(bucketMap.keys()).sort();
    const buckets: VolumeBucket[] = sortedKeys.map((key) => {
      const b = bucketMap.get(key)!;
      return {
        period: key,
        count: b.count,
        totalVolumeFormatted: Math.round(b.volume * 100) / 100,
        withdrawnVolumeFormatted: Math.round(b.withdrawn * 100) / 100,
        uniqueSenders: b.senders.size,
        uniqueReceivers: b.receivers.size,
      };
    });

    const totalVolume = streams.reduce((sum, s) => sum + s.totalAmountFormatted, 0);
    const avgSize = streams.length > 0 ? totalVolume / streams.length : 0;

    // Growth rate (comparing last period to previous period)
    let growthRatePercent = 0;
    if (buckets.length >= 2) {
      const current = buckets[buckets.length - 1].count;
      const previous = buckets[buckets.length - 2].count;
      growthRatePercent = previous > 0 ? Math.round(((current - previous) / previous) * 10000) / 100 : 0;
    }

    return {
      timeframe,
      totalStreams: streams.length,
      totalVolumeFormatted: Math.round(totalVolume * 100) / 100,
      averageStreamSizeFormatted: Math.round(avgSize * 100) / 100,
      buckets,
      growthRatePercent,
    };
  }

  /**
   * Calculate average duration and distribution buckets
   */
  public getDurationMetrics(): DurationMetricsResponse {
    const streams = this.db.getStreams();
    if (streams.length === 0) {
      return {
        averageDurationSeconds: 0,
        medianDurationSeconds: 0,
        minDurationSeconds: 0,
        maxDurationSeconds: 0,
        formattedAvgDuration: "0s",
        distribution: { under1Day: 0, day1To7: 0, day7To30: 0, month1To3: 0, over3Months: 0 },
      };
    }

    const durations = streams.map((s) => s.durationSeconds).filter((d) => d > 0).sort((a, b) => a - b);
    if (durations.length === 0) {
      return {
        averageDurationSeconds: 0,
        medianDurationSeconds: 0,
        minDurationSeconds: 0,
        maxDurationSeconds: 0,
        formattedAvgDuration: "0s",
        distribution: { under1Day: 0, day1To7: 0, day7To30: 0, month1To3: 0, over3Months: 0 },
      };
    }

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avg = Math.round(totalDuration / durations.length);
    const median = durations[Math.floor(durations.length / 2)];
    const min = durations[0];
    const max = durations[durations.length - 1];

    const distribution = {
      under1Day: 0,
      day1To7: 0,
      day7To30: 0,
      month1To3: 0,
      over3Months: 0,
    };

    for (const d of durations) {
      const days = d / 86400;
      if (days < 1) distribution.under1Day++;
      else if (days <= 7) distribution.day1To7++;
      else if (days <= 30) distribution.day7To30++;
      else if (days <= 90) distribution.month1To3++;
      else distribution.over3Months++;
    }

    return {
      averageDurationSeconds: avg,
      medianDurationSeconds: median,
      minDurationSeconds: min,
      maxDurationSeconds: max,
      formattedAvgDuration: formatDurationHuman(avg),
      distribution,
    };
  }

  /**
   * Calculate stream amount distribution and percentiles
   */
  public getAmountMetrics(tokenSymbol?: string): AmountMetricsResponse {
    let streams = this.db.getStreams();
    if (tokenSymbol) {
      streams = streams.filter((s) => s.tokenSymbol.toLowerCase() === tokenSymbol.toLowerCase());
    }

    if (streams.length === 0) {
      return {
        averageAmountFormatted: 0,
        medianAmountFormatted: 0,
        minAmountFormatted: 0,
        maxAmountFormatted: 0,
        totalVolumeFormatted: 0,
        percentiles: { p25: 0, p50: 0, p75: 0, p90: 0, p99: 0 },
        distribution: { microStreams: 0, smallStreams: 0, mediumStreams: 0, largeStreams: 0, whaleStreams: 0 },
      };
    }

    const amounts = streams.map((s) => s.totalAmountFormatted).sort((a, b) => a - b);
    const totalVolume = amounts.reduce((sum, a) => sum + a, 0);
    const avg = totalVolume / amounts.length;

    const getPercentile = (p: number) => {
      const idx = Math.min(amounts.length - 1, Math.floor((p / 100) * amounts.length));
      return amounts[idx];
    };

    const distribution = {
      microStreams: 0, // < 10
      smallStreams: 0, // 10 - 100
      mediumStreams: 0, // 100 - 1,000
      largeStreams: 0, // 1,000 - 10,000
      whaleStreams: 0, // > 10,000
    };

    for (const a of amounts) {
      if (a < 10) distribution.microStreams++;
      else if (a < 100) distribution.smallStreams++;
      else if (a < 1000) distribution.mediumStreams++;
      else if (a < 10000) distribution.largeStreams++;
      else distribution.whaleStreams++;
    }

    return {
      averageAmountFormatted: Math.round(avg * 100) / 100,
      medianAmountFormatted: Math.round(getPercentile(50) * 100) / 100,
      minAmountFormatted: amounts[0],
      maxAmountFormatted: amounts[amounts.length - 1],
      totalVolumeFormatted: Math.round(totalVolume * 100) / 100,
      percentiles: {
        p25: Math.round(getPercentile(25) * 100) / 100,
        p50: Math.round(getPercentile(50) * 100) / 100,
        p75: Math.round(getPercentile(75) * 100) / 100,
        p90: Math.round(getPercentile(90) * 100) / 100,
        p99: Math.round(getPercentile(99) * 100) / 100,
      },
      distribution,
    };
  }

  /**
   * Analyze withdrawal patterns
   */
  public getWithdrawalPatterns(): WithdrawalPatternMetrics {
    const withdrawals = this.db.getWithdrawals();
    const streams = this.db.getStreams();

    if (withdrawals.length === 0) {
      return {
        totalWithdrawals: 0,
        totalWithdrawnFormatted: 0,
        averageWithdrawalAmountFormatted: 0,
        averageWithdrawalsPerStream: 0,
        timingDistribution: { firstQuarter: 0, secondQuarter: 0, thirdQuarter: 0, fourthQuarter: 0, afterCompletion: 0 },
        sizeDistribution: { micro: 0, partial: 0, majority: 0, lumpSum: 0 },
        hourlyFrequency: {},
      };
    }

    const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amountFormatted, 0);
    const avgAmount = totalWithdrawn / withdrawals.length;
    const avgPerStream = streams.length > 0 ? withdrawals.length / streams.length : 0;

    const timing = {
      firstQuarter: 0,
      secondQuarter: 0,
      thirdQuarter: 0,
      fourthQuarter: 0,
      afterCompletion: 0,
    };

    const size = {
      micro: 0,
      partial: 0,
      majority: 0,
      lumpSum: 0,
    };

    const hourly: Record<number, number> = {};
    for (let i = 0; i < 24; i++) hourly[i] = 0;

    for (const w of withdrawals) {
      // Hourly
      const hour = new Date(w.withdrawnAt).getHours();
      hourly[hour] = (hourly[hour] || 0) + 1;

      // Size
      const pct = w.percentageWithdrawn;
      if (pct < 10) size.micro++;
      else if (pct < 50) size.partial++;
      else if (pct < 90) size.majority++;
      else size.lumpSum++;

      // Timing relative to stream duration
      const stream = streams.find((s) => s.streamId === w.streamId);
      if (stream && stream.durationSeconds > 0) {
        const fraction = w.elapsedSeconds / stream.durationSeconds;
        if (fraction <= 0.25) timing.firstQuarter++;
        else if (fraction <= 0.50) timing.secondQuarter++;
        else if (fraction <= 0.75) timing.thirdQuarter++;
        else if (fraction <= 1.0) timing.fourthQuarter++;
        else timing.afterCompletion++;
      } else {
        timing.secondQuarter++;
      }
    }

    return {
      totalWithdrawals: withdrawals.length,
      totalWithdrawnFormatted: Math.round(totalWithdrawn * 100) / 100,
      averageWithdrawalAmountFormatted: Math.round(avgAmount * 100) / 100,
      averageWithdrawalsPerStream: Math.round(avgPerStream * 100) / 100,
      timingDistribution: timing,
      sizeDistribution: size,
      hourlyFrequency: hourly,
    };
  }

  /**
   * Cancellation rate and lifecycle analysis
   */
  public getCancellationMetrics(): CancellationMetricsResponse {
    const streams = this.db.getStreams();
    const cancelled = streams.filter((s) => s.status === "CANCELLED");

    if (streams.length === 0) {
      return {
        totalStreamsCreated: 0,
        totalCancelled: 0,
        cancellationRatePercent: 0,
        avgLifespanBeforeCancelSeconds: 0,
        formattedAvgLifespan: "0s",
        totalRefundedFormatted: 0,
        cancellationsOverTime: [],
      };
    }

    const rate = (cancelled.length / streams.length) * 100;
    let totalLifespan = 0;
    let totalRefunded = 0;

    for (const c of cancelled) {
      if (c.cancelledAtTime && c.createdAtTime) {
        const lifespan = (new Date(c.cancelledAtTime).getTime() - new Date(c.createdAtTime).getTime()) / 1000;
        totalLifespan += Math.max(0, lifespan);
      }
      totalRefunded += c.refundAmountFormatted || 0;
    }

    const avgLifespan = cancelled.length > 0 ? Math.round(totalLifespan / cancelled.length) : 0;

    // Group cancellations by month
    const monthMap = new Map<string, { total: number; cancelled: number }>();
    for (const s of streams) {
      const month = s.createdAtTime.substring(0, 7);
      if (!monthMap.has(month)) monthMap.set(month, { total: 0, cancelled: 0 });
      const m = monthMap.get(month)!;
      m.total += 1;
      if (s.status === "CANCELLED") m.cancelled += 1;
    }

    const sortedMonths = Array.from(monthMap.keys()).sort();
    const cancellationsOverTime = sortedMonths.map((m) => {
      const data = monthMap.get(m)!;
      return {
        period: m,
        cancelledCount: data.cancelled,
        ratePercent: data.total > 0 ? Math.round((data.cancelled / data.total) * 10000) / 100 : 0,
      };
    });

    return {
      totalStreamsCreated: streams.length,
      totalCancelled: cancelled.length,
      cancellationRatePercent: Math.round(rate * 100) / 100,
      avgLifespanBeforeCancelSeconds: avgLifespan,
      formattedAvgLifespan: formatDurationHuman(avgLifespan),
      totalRefundedFormatted: Math.round(totalRefunded * 100) / 100,
      cancellationsOverTime,
    };
  }
}
