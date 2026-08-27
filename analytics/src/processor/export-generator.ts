import { AnalyticsDatabase } from "../db/storage.js";

export type ExportType = "streams" | "tvl" | "daily_rollups" | "retention" | "gas" | "full";
export type ExportFormat = "csv" | "json";

export class ExportGenerator {
  private db: AnalyticsDatabase;

  constructor(db: AnalyticsDatabase) {
    this.db = db;
  }

  public generateExport(
    type: ExportType = "streams",
    format: ExportFormat = "json",
    filters?: {
      fromDate?: string;
      toDate?: string;
      tokenSymbol?: string;
      status?: string;
    }
  ): { contentType: string; filename: string; content: string } {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "json") {
      const data = this.getDataForType(type, filters);
      return {
        contentType: "application/json",
        filename: `stellarstream-analytics-${type}-${timestamp}.json`,
        content: JSON.stringify(data, null, 2),
      };
    }

    // CSV format
    const csvContent = this.generateCsv(type, filters);
    return {
      contentType: "text/csv",
      filename: `stellarstream-analytics-${type}-${timestamp}.csv`,
      content: csvContent,
    };
  }

  private getDataForType(type: ExportType, filters?: any): any {
    switch (type) {
      case "streams":
        return this.db.getStreams(filters);
      case "tvl":
        return this.db.getTvlSnapshots(filters);
      case "daily_rollups":
        return this.db.getDailyRollups(filters?.fromDate, filters?.toDate);
      case "retention":
        return this.db.getRetentionCohorts();
      case "gas":
        return this.db.getGasUsage(filters);
      case "full":
      default:
        return this.db.exportData();
    }
  }

  private generateCsv(type: ExportType, filters?: any): string {
    switch (type) {
      case "streams": {
        const streams = this.db.getStreams(filters);
        const headers = [
          "StreamID",
          "ContractVersion",
          "Status",
          "TokenSymbol",
          "TotalAmount",
          "WithdrawnAmount",
          "DurationSeconds",
          "Sender",
          "Receiver",
          "CreatedAt",
        ];
        const rows = streams.map((s) => [
          s.streamId,
          s.contractVersion,
          s.status,
          s.tokenSymbol,
          s.totalAmountFormatted,
          s.withdrawnAmountFormatted,
          s.durationSeconds,
          s.sender,
          s.receiver,
          s.createdAtTime,
        ]);
        return this.toCsvString(headers, rows);
      }
      case "daily_rollups": {
        const rollups = this.db.getDailyRollups(filters?.fromDate, filters?.toDate);
        const headers = [
          "Date",
          "StreamsCreated",
          "StreamsActive",
          "StreamsCancelled",
          "TotalVolume",
          "TotalWithdrawn",
          "ActiveTVL",
          "AvgDurationSec",
          "AvgStreamAmount",
          "UniqueSenders",
          "UniqueReceivers",
          "TotalGasConsumed",
          "AvgTxGas",
          "CancellationRate",
        ];
        const rows = rollups.map((r) => [
          r.date,
          r.streamsCreated,
          r.streamsActive,
          r.streamsCancelled,
          r.totalVolumeStreamedFormatted,
          r.totalWithdrawnFormatted,
          r.activeTvlFormatted,
          r.avgDurationSeconds,
          r.avgStreamAmountFormatted,
          r.uniqueSenders,
          r.uniqueReceivers,
          r.totalGasConsumed,
          r.avgTxGas,
          r.cancellationRate,
        ]);
        return this.toCsvString(headers, rows);
      }
      case "retention": {
        const cohorts = this.db.getRetentionCohorts();
        const headers = [
          "CohortMonth",
          "CohortSize",
          "Day1Rate",
          "Day7Rate",
          "Day14Rate",
          "Day30Rate",
          "Day60Rate",
          "Day90Rate",
          "RepeatRate",
          "AvgStreamsPerUser",
        ];
        const rows = cohorts.map((c) => [
          c.cohortMonth,
          c.cohortSize,
          c.day1RetentionRate,
          c.day7RetentionRate,
          c.day14RetentionRate,
          c.day30RetentionRate,
          c.day60RetentionRate,
          c.day90RetentionRate,
          c.repeatStreamerRate,
          c.avgStreamsPerUser,
        ]);
        return this.toCsvString(headers, rows);
      }
      case "gas": {
        const records = this.db.getGasUsage(filters);
        const headers = [
          "TxHash",
          "Action",
          "Version",
          "CpuInstructions",
          "MemoryBytes",
          "FeeStroops",
          "Ledger",
          "RecordedAt",
        ];
        const rows = records.map((g) => [
          g.txHash,
          g.contractAction,
          g.contractVersion,
          g.cpuInstructions,
          g.memoryBytes,
          g.feeChargedStroops,
          g.ledgerNumber,
          g.recordedAt,
        ]);
        return this.toCsvString(headers, rows);
      }
      default: {
        // Simple fallback
        const streams = this.db.getStreams(filters);
        const headers = ["StreamID", "Status", "Amount", "Token", "CreatedAt"];
        const rows = streams.map((s) => [s.streamId, s.status, s.totalAmountFormatted, s.tokenSymbol, s.createdAtTime]);
        return this.toCsvString(headers, rows);
      }
    }
  }

  private toCsvString(headers: string[], rows: any[][]): string {
    const escape = (val: any) => {
      if (val === undefined || val === null) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = headers.map(escape).join(",");
    const rowLines = rows.map((r) => r.map(escape).join(","));
    return [headerLine, ...rowLines].join("\n");
  }
}
