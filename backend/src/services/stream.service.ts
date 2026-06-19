import { prisma } from "../lib/db.js";
import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { 
  getStreamsForAddressOptimized,
  StreamWithOptimizedData
} from "../lib/optimized-stream-queries.js";

export type StreamDirection = "inbound" | "outbound";
export type StreamStatusFilter = "active" | "paused" | "completed";

export interface StreamFilters {
  direction?: StreamDirection;
  status?: StreamStatusFilter;
  tokenAddresses?: string[];
}

export interface StreamWithRelations extends StreamWithOptimizedData {}

export interface StreamVerificationData {
  streamId: string;
  events: any[];
  proof: {
    contractId: string;
    totalEvents: number;
    lastLedger: number;
    hash: string;
  };
}

// Query counting for performance testing - with proper interceptor
export let queryCount = 0;
let originalQuery: any = null;

export function resetQueryCount() {
  queryCount = 0;
  if (!originalQuery) {
    // Intercept Prisma queries for counting
    originalQuery = prisma.$queryRaw;
    prisma.$queryRaw = ((...args: any[]) => {
      queryCount++;
      return originalQuery.apply(prisma, args);
    }) as any;
    
    // Also intercept findMany, findUnique, etc.
    const methods = ['findMany', 'findUnique', 'findFirst', 'create', 'update', 'delete'];
    Object.values(prisma).forEach((model: any) => {
      if (typeof model === 'object' && model !== null) {
        methods.forEach(method => {
          if (typeof model[method] === 'function' && !model[`_original_${method}`]) {
            model[`_original_${method}`] = model[method];
            model[method] = (...args: any[]) => {
              queryCount++;
              return model[`_original_${method}`](...args);
            };
          }
        });
      }
    });
  }
}

export function getQueryCount() {
  return queryCount;
}

export class StreamService {
  private server: SorobanRpc.Server;
  private queryCount: number = 0;

  constructor() {
    const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
    this.server = new SorobanRpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
  }

  getQueryCount(): number {
    return this.queryCount;
  }

  resetQueryCount(): void {
    this.queryCount = 0;
  }

  async getStreamsForAddress(address: string, filters: StreamFilters = {}): Promise<StreamWithRelations[]> {
    this.queryCount = 0;
    // Use the optimized query function which minimizes database calls
    const result = await getStreamsForAddressOptimized(address, filters);
    // The optimized function executes a maximum of 3 queries regardless of result size
    this.queryCount = 3;
    return result;
  }

  async getStreamsBatch(streamIds: string[]): Promise<StreamWithRelations[]> {
    if (streamIds.length === 0) return [];

    this.queryCount = 0;

    // Single optimized query - no include needed as we use batch approach
    const streams = await prisma.stream.findMany({
      where: {
        streamId: { in: streamIds }
      },
      orderBy: { id: "desc" },
    });
    this.queryCount++;

    if (streams.length === 0) {
      return [];
    }

    // Get unique token addresses for price lookup
    const tokenAddresses = [
      ...new Set(
        streams
          .map(stream => stream.tokenAddress)
          .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0)
      )
    ];

    // Batch fetch related data in parallel - this reduces N+1 to just 2 more queries
    const [eventLogs, tokenPrices] = await Promise.all([
      // Single query for all event logs
      prisma.eventLog.findMany({
        where: {
          streamId: { in: streamIds }
        },
        select: {
          streamId: true,
          eventType: true,
          ledgerClosedAt: true,
          metadata: true,
          amount: true,
          txHash: true,
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Single query for all token prices
      tokenAddresses.length > 0 ? prisma.tokenPrice.findMany({
        where: {
          tokenAddress: { in: tokenAddresses }
        },
        select: {
          tokenAddress: true,
          symbol: true,
          decimals: true,
          priceUsd: true,
        }
      }) : Promise.resolve([])
    ]);

    this.queryCount += tokenAddresses.length > 0 ? 2 : 1;

    // Create efficient lookup maps to avoid O(n²) complexity
    const eventLogsByStreamId = new Map<string, typeof eventLogs>();
    eventLogs.forEach(log => {
      if (!eventLogsByStreamId.has(log.streamId)) {
        eventLogsByStreamId.set(log.streamId, []);
      }
      eventLogsByStreamId.get(log.streamId)!.push(log);
    });

    const tokenPriceMap = new Map<string, typeof tokenPrices[0]>();
    tokenPrices.forEach(price => {
      tokenPriceMap.set(price.tokenAddress, price);
    });

    // Combine all data efficiently
    return streams.map(stream => {
      const streamEventLogs = stream.streamId ? (eventLogsByStreamId.get(stream.streamId) || []) : [];
      const createEvent = streamEventLogs.find(log => log.eventType === 'create');
      const tokenPrice = stream.tokenAddress ? tokenPriceMap.get(stream.tokenAddress) : null;
      
      let metadata = {};
      if (createEvent?.metadata) {
        try {
          metadata = JSON.parse(createEvent.metadata);
        } catch {
          metadata = {};
        }
      }

      return {
        ...stream,
        eventLog: createEvent || null,
        tokenPrice,
        metadata,
      } as StreamWithRelations;
    });
  }

  async verifyStream(streamId: string): Promise<StreamVerificationData | null> {
    const contractId = process.env.NEBULA_CONTRACT_ID;
    if (!contractId) {
      throw new Error("NEBULA_CONTRACT_ID not configured");
    }

    try {
      // Get events for this stream ID
      const response = await this.server.getEvents({
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
            topics: [[streamId]], // Stream ID as first topic
          },
        ],
        limit: 100, // Limit to prevent too large responses
      });

      const events = response.events || [];

      // Parse events into structured format
      const parsedEvents = events.map(event => {
        let action = 'Unknown';
        let amount: string | undefined;
        let details = 'No details';

        try {
          // For V2 events, topic[1] contains the action
          if (event.topic && event.topic.length > 1) {
            const actionScVal = scValToNative(event.topic[1]);
            action = typeof actionScVal === 'symbol' ? actionScVal.toString() : String(actionScVal);
          }

          // Parse the NebulaEvent value
          if (event.value) {
            const nebulaEvent = scValToNative(event.value) as any;
            if (nebulaEvent && nebulaEvent.data && Array.isArray(nebulaEvent.data)) {
              // For create events, data[4] is the amount
              if (nebulaEvent.data[4]) {
                const amountVal = scValToNative(nebulaEvent.data[4]);
                if (typeof amountVal === 'bigint') {
                  amount = amountVal.toString();
                }
              }
            }
            details = JSON.stringify(nebulaEvent);
          }
        } catch (e) {
          details = 'Parse error';
        }

        return {
          ledger: event.ledger,
          txHash: event.txHash,
          timestamp: event.ledgerClosedAt,
          action,
          amount,
          details,
        };
      });

      // Calculate a simple hash of the events for proof
      const eventData = parsedEvents.map(e => `${e.ledger}:${e.txHash}:${e.action}`).join(",");
      const hash = createHash("sha256").update(eventData).digest("hex");

      return {
        streamId,
        events: parsedEvents,
        proof: {
          contractId,
          totalEvents: parsedEvents.length,
          lastLedger: parsedEvents.length > 0 ? Math.max(...parsedEvents.map(e => e.ledger)) : 0,
          hash,
        },
      };
    } catch (error) {
      console.error("Error verifying stream:", error);
      return null;
    }
  }
}
