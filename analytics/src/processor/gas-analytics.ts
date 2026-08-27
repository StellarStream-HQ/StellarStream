import { AnalyticsDatabase } from "../db/storage.js";
import { GasMetricsResponse } from "./types.js";

export class GasAnalyticsCalculator {
  private db: AnalyticsDatabase;

  constructor(db: AnalyticsDatabase) {
    this.db = db;
  }

  public getGasMetrics(actionFilter?: string): GasMetricsResponse {
    let records = this.db.getGasUsage();
    if (actionFilter) {
      records = records.filter((r) => r.contractAction.toLowerCase() === actionFilter.toLowerCase());
    }

    if (records.length === 0) {
      return {
        totalCpuInstructions: 0,
        totalMemoryBytes: 0,
        totalFeeStroops: 0,
        totalFeeXlmFormatted: 0,
        avgCpuPerTx: 0,
        avgFeeStroopsPerTx: 0,
        byAction: {},
        timeSeries: [],
      };
    }

    let totalCpu = 0;
    let totalMem = 0;
    let totalFee = 0;

    const actionMap: Record<
      string,
      { txCount: number; cpuSum: number; feeSum: number }
    > = {};

    const dateMap = new Map<
      string,
      { txCount: number; cpuSum: number; feeSum: number }
    >();

    for (const r of records) {
      totalCpu += r.cpuInstructions;
      totalMem += r.memoryBytes;
      totalFee += r.feeChargedStroops;

      // Group by action
      const act = r.contractAction.toLowerCase();
      if (!actionMap[act]) {
        actionMap[act] = { txCount: 0, cpuSum: 0, feeSum: 0 };
      }
      actionMap[act].txCount += 1;
      actionMap[act].cpuSum += r.cpuInstructions;
      actionMap[act].feeSum += r.feeChargedStroops;

      // Group by day for time series
      const day = r.recordedAt.split("T")[0];
      if (!dateMap.has(day)) {
        dateMap.set(day, { txCount: 0, cpuSum: 0, feeSum: 0 });
      }
      const d = dateMap.get(day)!;
      d.txCount += 1;
      d.cpuSum += r.cpuInstructions;
      d.feeSum += r.feeChargedStroops;
    }

    const byAction: GasMetricsResponse["byAction"] = {};
    for (const [act, data] of Object.entries(actionMap)) {
      byAction[act] = {
        txCount: data.txCount,
        avgCpu: Math.round(data.cpuSum / data.txCount),
        avgFeeStroops: Math.round((data.feeSum / data.txCount) * 100) / 100,
        totalCpu: data.cpuSum,
        totalFeeStroops: data.feeSum,
      };
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const timeSeries = sortedDates.map((date) => {
      const d = dateMap.get(date)!;
      return {
        date,
        totalTransactions: d.txCount,
        avgCpu: Math.round(d.cpuSum / d.txCount),
        avgFeeStroops: Math.round((d.feeSum / d.txCount) * 100) / 100,
        totalFeeStroops: d.feeSum,
      };
    });

    const totalFeeXlm = totalFee / 10000000;

    return {
      totalCpuInstructions: totalCpu,
      totalMemoryBytes: totalMem,
      totalFeeStroops: totalFee,
      totalFeeXlmFormatted: Math.round(totalFeeXlm * 10000) / 10000,
      avgCpuPerTx: Math.round(totalCpu / records.length),
      avgFeeStroopsPerTx: Math.round((totalFee / records.length) * 100) / 100,
      byAction,
      timeSeries,
    };
  }
}
