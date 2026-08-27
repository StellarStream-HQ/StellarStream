import { ContractVersion, GasUsageRecord } from "../db/types.js";
import { DecodedContractEvent } from "./types.js";

export interface GasSummary {
  totalCpuInstructions: number;
  totalMemoryBytes: number;
  totalFeeStroops: number;
  totalTransactions: number;
  avgCpuPerTx: number;
  avgFeeStroopsPerTx: number;
  byAction: Record<
    string,
    {
      txCount: number;
      avgCpu: number;
      avgFeeStroops: number;
    }
  >;
}

export class GasTracker {
  public static extractGasUsage(event: DecodedContractEvent): GasUsageRecord {
    return {
      id: `gas_${event.txHash}_${event.eventId}`,
      txHash: event.txHash,
      contractAction: event.topicAction,
      contractVersion: event.contractVersion,
      cpuInstructions: event.gasConsumed || 175000,
      memoryBytes: event.memoryBytes || 45000,
      feeChargedStroops: event.feeChargedStroops || 100,
      ledgerNumber: event.ledger,
      recordedAt: event.ledgerClosedAt,
    };
  }

  public static calculateSummary(records: GasUsageRecord[]): GasSummary {
    if (records.length === 0) {
      return {
        totalCpuInstructions: 0,
        totalMemoryBytes: 0,
        totalFeeStroops: 0,
        totalTransactions: 0,
        avgCpuPerTx: 0,
        avgFeeStroopsPerTx: 0,
        byAction: {},
      };
    }

    let totalCpu = 0;
    let totalMem = 0;
    let totalFee = 0;
    const actionMap: Record<
      string,
      { count: number; cpuSum: number; feeSum: number }
    > = {};

    for (const r of records) {
      totalCpu += r.cpuInstructions;
      totalMem += r.memoryBytes;
      totalFee += r.feeChargedStroops;

      const act = r.contractAction.toLowerCase();
      if (!actionMap[act]) {
        actionMap[act] = { count: 0, cpuSum: 0, feeSum: 0 };
      }
      actionMap[act].count += 1;
      actionMap[act].cpuSum += r.cpuInstructions;
      actionMap[act].feeSum += r.feeChargedStroops;
    }

    const byAction: GasSummary["byAction"] = {};
    for (const [act, data] of Object.entries(actionMap)) {
      byAction[act] = {
        txCount: data.count,
        avgCpu: Math.round(data.cpuSum / data.count),
        avgFeeStroops: Math.round((data.feeSum / data.count) * 100) / 100,
      };
    }

    return {
      totalCpuInstructions: totalCpu,
      totalMemoryBytes: totalMem,
      totalFeeStroops: totalFee,
      totalTransactions: records.length,
      avgCpuPerTx: Math.round(totalCpu / records.length),
      avgFeeStroopsPerTx: Math.round((totalFee / records.length) * 100) / 100,
      byAction,
    };
  }
}
