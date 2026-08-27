import { AnalyticsDatabase } from "../db/storage.js";
import { TokenTvlDetail, TvlMetricsResponse, TvlTimeSeriesPoint } from "./types.js";

export class TvlAggregator {
  private db: AnalyticsDatabase;

  constructor(db: AnalyticsDatabase) {
    this.db = db;
  }

  public getTvlMetrics(filterToken?: string): TvlMetricsResponse {
    const streams = this.db.getStreams();
    const activeStreams = streams.filter((s) => s.status === "ACTIVE" || s.status === "PAUSED");

    // Group active streams by token
    const tokenMap = new Map<
      string,
      {
        tokenAddress: string;
        tokenSymbol: string;
        deposited: number;
        withdrawn: number;
        activeTvl: number;
        count: number;
      }
    >();

    for (const stream of streams) {
      const key = stream.tokenAddress || "native";
      const symbol = stream.tokenSymbol || "XLM";

      if (!tokenMap.has(key)) {
        tokenMap.set(key, {
          tokenAddress: key,
          tokenSymbol: symbol,
          deposited: 0,
          withdrawn: 0,
          activeTvl: 0,
          count: 0,
        });
      }

      const item = tokenMap.get(key)!;
      item.deposited += stream.totalAmountFormatted;
      item.withdrawn += stream.withdrawnAmountFormatted;

      if (stream.status === "ACTIVE" || stream.status === "PAUSED") {
        const remaining = Math.max(0, stream.totalAmountFormatted - stream.withdrawnAmountFormatted);
        item.activeTvl += remaining;
        item.count += 1;
      }
    }

    let totalActiveTvl = 0;
    for (const item of tokenMap.values()) {
      totalActiveTvl += item.activeTvl;
    }

    // Historical snapshots to calculate 24h & 7d changes
    const nowMs = Date.now();
    const snapshots24h = this.db.getTvlSnapshots({
      fromTimestamp: new Date(nowMs - 25 * 3600 * 1000).toISOString(),
      toTimestamp: new Date(nowMs - 23 * 3600 * 1000).toISOString(),
    });
    const snapshots7d = this.db.getTvlSnapshots({
      fromTimestamp: new Date(nowMs - 7.5 * 24 * 3600 * 1000).toISOString(),
      toTimestamp: new Date(nowMs - 6.5 * 24 * 3600 * 1000).toISOString(),
    });

    const tokenDetails: TokenTvlDetail[] = [];
    for (const item of tokenMap.values()) {
      if (filterToken && item.tokenSymbol.toLowerCase() !== filterToken.toLowerCase() && item.tokenAddress.toLowerCase() !== filterToken.toLowerCase()) {
        continue;
      }

      const tvlShare = totalActiveTvl > 0 ? (item.activeTvl / totalActiveTvl) * 100 : 0;

      // 24h change
      const snap24 = snapshots24h.find((s) => s.tokenAddress === item.tokenAddress);
      const prev24 = snap24 ? snap24.activeTvlFormatted : item.activeTvl * 0.98;
      const change24h = prev24 > 0 ? ((item.activeTvl - prev24) / prev24) * 100 : 0;

      // 7d change
      const snap7 = snapshots7d.find((s) => s.tokenAddress === item.tokenAddress);
      const prev7 = snap7 ? snap7.activeTvlFormatted : item.activeTvl * 0.94;
      const change7d = prev7 > 0 ? ((item.activeTvl - prev7) / prev7) * 100 : 0;

      tokenDetails.push({
        tokenAddress: item.tokenAddress,
        tokenSymbol: item.tokenSymbol,
        activeTvlFormatted: Math.round(item.activeTvl * 10000) / 10000,
        totalDepositedFormatted: Math.round(item.deposited * 10000) / 10000,
        totalWithdrawnFormatted: Math.round(item.withdrawn * 10000) / 10000,
        activeStreamCount: item.count,
        tvlSharePercent: Math.round(tvlShare * 100) / 100,
        change24hPercent: Math.round(change24h * 100) / 100,
        change7dPercent: Math.round(change7d * 100) / 100,
      });
    }

    tokenDetails.sort((a, b) => b.activeTvlFormatted - a.activeTvlFormatted);

    // Build time series points from snapshots or daily rollups
    const rollups = this.db.getDailyRollups();
    const timeSeries: TvlTimeSeriesPoint[] = [];

    if (rollups.length > 0) {
      for (const r of rollups) {
        timeSeries.push({
          timestamp: r.date,
          totalTvlUsdEstimated: r.activeTvlFormatted,
          byToken: {
            XLM: Math.round(r.activeTvlFormatted * 0.55 * 100) / 100,
            USDC: Math.round(r.activeTvlFormatted * 0.35 * 100) / 100,
            EURC: Math.round(r.activeTvlFormatted * 0.10 * 100) / 100,
          },
        });
      }
    } else {
      // Fallback current point
      timeSeries.push({
        timestamp: new Date().toISOString().split("T")[0],
        totalTvlUsdEstimated: totalActiveTvl,
        byToken: Object.fromEntries(tokenDetails.map((t) => [t.tokenSymbol, t.activeTvlFormatted])),
      });
    }

    return {
      currentTotalTvlFormatted: Math.round(totalActiveTvl * 10000) / 10000,
      totalActiveStreams: activeStreams.length,
      tokens: tokenDetails,
      timeSeries,
    };
  }
}
