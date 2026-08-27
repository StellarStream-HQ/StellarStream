import { SorobanRpc } from "@stellar/stellar-sdk";
import { SorobanEventRaw } from "./types.js";

export interface StellarClientOptions {
  rpcUrl: string;
  network?: string;
  timeoutMs?: number;
}

export class StellarClient {
  private rpcUrl: string;
  private server: SorobanRpc.Server;

  constructor(options: StellarClientOptions) {
    this.rpcUrl = options.rpcUrl || "https://soroban-testnet.stellar.org";
    this.server = new SorobanRpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith("http://"),
      timeout: options.timeoutMs || 10000,
    });
  }

  /**
   * Fetch Soroban contract events using getEvents RPC
   */
  public async getContractEvents(params: {
    startLedger: number;
    filters?: Array<{
      type?: "contract" | "system" | "diagnostic";
      contractIds?: string[];
      topics?: unknown[][];
    }>;
    limit?: number;
    cursor?: string;
  }): Promise<{ events: SorobanEventRaw[]; latestLedger: number; cursor?: string }> {
    try {
      const response = await this.server.getEvents({
        startLedger: params.startLedger,
        filters: params.filters as SorobanRpc.Api.EventFilter[],
        limit: params.limit || 100,
        cursor: params.cursor,
      });

      const events: SorobanEventRaw[] = (response.events || []).map((ev) => ({
        id: ev.id,
        type: (ev.type as "contract" | "system" | "diagnostic") || "contract",
        ledger: ev.ledger,
        ledgerClosedAt: ev.ledgerClosedAt,
        contractId: ev.contractId,
        topic: ev.topic as unknown[],
        value: ev.value as unknown,
        txInfo: {
          txHash: ev.txHash,
        },
        inSuccessfulContractCall: ev.inSuccessfulContractCall,
      }));

      return {
        events,
        latestLedger: response.latestLedger,
        cursor: response.cursor,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Soroban RPC getEvents error (${this.rpcUrl}): ${msg}`);
    }
  }

  public async getLatestLedger(): Promise<number> {
    try {
      const resp = await this.server.getLatestLedger();
      return resp.sequence;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Soroban RPC getLatestLedger error: ${msg}`);
    }
  }
}
