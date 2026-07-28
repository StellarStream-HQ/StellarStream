/**
 * Dust Recovery Audit Service (Issue #179)
 *
 * Scans historical ledger data for DustAccumulated events,
 * aggregates "lost value" by asset and protocol version,
 * and stores results in the ProtocolInefficiencyReport table.
 */

import { PrismaClient } from "../generated/client/index.js";
import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { logger } from "../logger.js";

const prisma = new PrismaClient();

// ── Constants ─────────────────────────────────────────────────────────────────

/** The Soroban topic symbol emitted by the V2 contract for dust events */
const DUST_EVENT_TOPIC = "dust";

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

/** Contract IDs per protocol version (configure via env) */
const CONTRACT_IDS: Record<number, string> = {};

if (process.env.CONTRACT_V1_ID) CONTRACT_IDS[1] = process.env.CONTRACT_V1_ID;
if (process.env.CONTRACT_V2_ID) CONTRACT_IDS[2] = process.env.CONTRACT_V2_ID;
if (process.env.CONTRACT_V3_ID) CONTRACT_IDS[3] = process.env.CONTRACT_V3_ID;

/** Max events per RPC page */
const PAGE_LIMIT = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DustEventRecord {
  streamId: string;
  token: string;
  splitAddress: string;
  splitBps: number;
  toWithdraw: string;
  splitAmount: string;
  dustAmount: string;
  timestamp: number;
  ledger: number;
  txHash: string;
  protocolVersion: number;
}

export interface InefficiencyReportRow {
  id: string;
  asset: string;
  protocolVersion: number;
  totalDustAmount: string;
  eventCount: number;
  firstSeenLedger: number | null;
  lastSeenLedger: number | null;
  generatedAt: Date;
  updatedAt: Date;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DustRecoveryAuditService {
  private rpc: SorobanRpc.Server;

  constructor() {
    this.rpc = new SorobanRpc.Server(SOROBAN_RPC_URL);
  }

  // ── 1. Scan ledger for dust events ────────────────────────────────────────

  /**
   * Scan historical Soroban events for DustAccumulated topics.
   * Iterates through all configured contract versions and collects
   * matching events starting from the given ledger.
   */
  async scanDustEvents(startLedger?: number): Promise<DustEventRecord[]> {
    const records: DustEventRecord[] = [];

    // Also scan ContractEvent table for already-ingested events
    const dbRecords = await this.scanFromDatabase();
    records.push(...dbRecords);

    // Then scan live RPC for any events beyond what's in the DB
    for (const [versionStr, contractId] of Object.entries(CONTRACT_IDS)) {
      const version = parseInt(versionStr, 10);
      try {
        const rpcRecords = await this.scanRpcEvents(
          contractId,
          version,
          startLedger,
        );
        records.push(...rpcRecords);
      } catch (error) {
        logger.warn(
          `Failed to scan RPC dust events for V${version} (${contractId})`,
          { error },
        );
      }
    }

    logger.info(`Scanned ${records.length} total dust events`);
    return records;
  }

  /**
   * Scan already-ingested ContractEvent rows for dust events.
   */
  private async scanFromDatabase(): Promise<DustEventRecord[]> {
    const dustEvents = await (prisma as any).contractEvent.findMany({
      where: { eventType: DUST_EVENT_TOPIC },
      orderBy: { ledgerSequence: "asc" },
    });

    return dustEvents
      .map((evt: any) => this.parseDbEvent(evt))
      .filter((r: any): r is DustEventRecord => r !== null);
  }

  /**
   * Parse a ContractEvent DB row into a DustEventRecord.
   */
  private parseDbEvent(evt: {
    contractId: string;
    txHash: string;
    ledgerSequence: number;
    decodedJson: unknown;
  }): DustEventRecord | null {
    try {
      const decoded =
        typeof evt.decodedJson === "string"
          ? JSON.parse(evt.decodedJson)
          : evt.decodedJson;

      const version = this.versionForContract(evt.contractId);

      return {
        streamId: String(decoded.stream_id ?? ""),
        token: String(decoded.token ?? ""),
        splitAddress: String(decoded.split_address ?? ""),
        splitBps: Number(decoded.split_bps ?? 0),
        toWithdraw: String(decoded.to_withdraw ?? "0"),
        splitAmount: String(decoded.split_amount ?? "0"),
        dustAmount: String(decoded.dust_amount ?? "0"),
        timestamp: Number(decoded.timestamp ?? 0),
        ledger: evt.ledgerSequence,
        txHash: evt.txHash,
        protocolVersion: version,
      };
    } catch {
      logger.warn("Failed to parse DB dust event", { txHash: evt.txHash });
      return null;
    }
  }

  /**
   * Poll Soroban RPC getEvents for dust topics on a specific contract.
   */
  private async scanRpcEvents(
    contractId: string,
    protocolVersion: number,
    startLedger?: number,
  ): Promise<DustEventRecord[]> {
    const records: DustEventRecord[] = [];

    const fromLedger = startLedger ?? (await this.getLastSyncedLedger());
    if (!fromLedger || fromLedger <= 0) return records;

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const request: SorobanRpc.Api.GetEventsRequest = {
        startLedger: cursor ? undefined : fromLedger,
        filters: [
          {
            type: "contract" as const,
            contractIds: [contractId],
            topics: [["*", DUST_EVENT_TOPIC]],
          },
        ],
        limit: PAGE_LIMIT,
      };
      if (cursor) {
        (request as Record<string, unknown>).cursor = cursor;
      }

      const response = await this.rpc.getEvents(request);
      const events = response.events ?? [];

      for (const evt of events) {
        const parsed = this.parseRpcEvent(evt, protocolVersion);
        if (parsed) records.push(parsed);
      }

      if (events.length < PAGE_LIMIT) {
        hasMore = false;
      } else {
        cursor = events[events.length - 1].pagingToken;
      }
    }

    return records;
  }

  /**
   * Parse a raw Soroban event response into a DustEventRecord.
   */
  private parseRpcEvent(
    evt: SorobanRpc.Api.EventResponse,
    protocolVersion: number,
  ): DustEventRecord | null {
    try {
      const raw = scValToNative(evt.value);
      return {
        streamId: String(raw.stream_id ?? ""),
        token: String(raw.token ?? ""),
        splitAddress: String(raw.split_address ?? ""),
        splitBps: Number(raw.split_bps ?? 0),
        toWithdraw: String(raw.to_withdraw ?? "0"),
        splitAmount: String(raw.split_amount ?? "0"),
        dustAmount: String(raw.dust_amount ?? "0"),
        timestamp: Number(raw.timestamp ?? 0),
        ledger: evt.ledger,
        txHash: evt.id,
        protocolVersion,
      };
    } catch {
      logger.warn("Failed to parse RPC dust event");
      return null;
    }
  }

  // ── 2. Aggregate and store report ─────────────────────────────────────────

  /**
   * Aggregate scanned dust events by (asset, protocolVersion) and
   * upsert rows into the ProtocolInefficiencyReport table.
   */
  async generateReport(events: DustEventRecord[]): Promise<InefficiencyReportRow[]> {
    // Group by (token, protocolVersion)
    const buckets = new Map<
      string,
      {
        asset: string;
        protocolVersion: number;
        totalDust: bigint;
        count: number;
        firstLedger: number;
        lastLedger: number;
      }
    >();

    for (const evt of events) {
      const key = `${evt.token}::${evt.protocolVersion}`;
      const dustBig = BigInt(evt.dustAmount);
      if (dustBig <= 0n) continue;

      const existing = buckets.get(key);
      if (existing) {
        existing.totalDust += dustBig;
        existing.count += 1;
        if (evt.ledger < existing.firstLedger)
          existing.firstLedger = evt.ledger;
        if (evt.ledger > existing.lastLedger)
          existing.lastLedger = evt.ledger;
      } else {
        buckets.set(key, {
          asset: evt.token,
          protocolVersion: evt.protocolVersion,
          totalDust: dustBig,
          count: 1,
          firstLedger: evt.ledger,
          lastLedger: evt.ledger,
        });
      }
    }

    // Upsert each bucket into the DB
    const rows: InefficiencyReportRow[] = [];

    for (const bucket of buckets.values()) {
      const row = await (prisma as any).protocolInefficiencyReport.upsert({
        where: {
          asset_protocolVersion: {
            asset: bucket.asset,
            protocolVersion: bucket.protocolVersion,
          },
        },
        create: {
          asset: bucket.asset,
          protocolVersion: bucket.protocolVersion,
          totalDustAmount: bucket.totalDust.toString(),
          eventCount: bucket.count,
          firstSeenLedger: bucket.firstLedger,
          lastSeenLedger: bucket.lastLedger,
        },
        update: {
          totalDustAmount: bucket.totalDust.toString(),
          eventCount: bucket.count,
          firstSeenLedger: bucket.firstLedger,
          lastSeenLedger: bucket.lastLedger,
        },
      });

      rows.push({
        id: row.id,
        asset: row.asset,
        protocolVersion: row.protocolVersion,
        totalDustAmount: row.totalDustAmount,
        eventCount: row.eventCount,
        firstSeenLedger: row.firstSeenLedger,
        lastSeenLedger: row.lastSeenLedger,
        generatedAt: row.generatedAt,
        updatedAt: row.updatedAt,
      });
    }

    logger.info(
      `Generated protocol inefficiency report: ${rows.length} asset-version buckets`,
    );
    return rows;
  }

  // ── 3. Query helpers ──────────────────────────────────────────────────────

  /**
   * Full scan → aggregate → persist pipeline.
   */
  async runFullAudit(startLedger?: number): Promise<InefficiencyReportRow[]> {
    const events = await this.scanDustEvents(startLedger);
    return this.generateReport(events);
  }

  /**
   * Retrieve the latest stored report rows.
   */
  async getReport(filters?: {
    asset?: string;
    protocolVersion?: number;
  }): Promise<InefficiencyReportRow[]> {
    const where: Record<string, unknown> = {};
    if (filters?.asset) where.asset = filters.asset;
    if (filters?.protocolVersion !== undefined)
      where.protocolVersion = filters.protocolVersion;

    const rows = await (prisma as any).protocolInefficiencyReport.findMany({
      where,
      orderBy: [{ protocolVersion: "asc" }, { totalDustAmount: "desc" }],
    });

    return rows.map((r: any) => ({
      id: r.id,
      asset: r.asset,
      protocolVersion: r.protocolVersion,
      totalDustAmount: r.totalDustAmount,
      eventCount: r.eventCount,
      firstSeenLedger: r.firstSeenLedger,
      lastSeenLedger: r.lastSeenLedger,
      generatedAt: r.generatedAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Summed totals across all assets and versions.
   */
  async getSummary(): Promise<{
    totalDustLost: string;
    totalEvents: number;
    assetCount: number;
  }> {
    const rows = await (prisma as any).protocolInefficiencyReport.findMany();
    let totalDust = 0n;
    let totalEvents = 0;
    const assets = new Set<string>();

    for (const r of rows) {
      totalDust += BigInt(r.totalDustAmount);
      totalEvents += r.eventCount;
      assets.add(r.asset);
    }

    return {
      totalDustLost: totalDust.toString(),
      totalEvents,
      assetCount: assets.size,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private versionForContract(contractId: string): number {
    for (const [ver, cid] of Object.entries(CONTRACT_IDS)) {
      if (cid === contractId) return parseInt(ver, 10);
    }
    return 2; // default to V2 where dust events originate
  }

  private async getLastSyncedLedger(): Promise<number> {
    const sync = await prisma.syncState.findUnique({ where: { id: 1 } });
    return sync?.lastLedgerSequence ?? 0;
  }
}
