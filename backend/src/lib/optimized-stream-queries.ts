import { prisma } from "../lib/db.js";
import { StreamStatus, Prisma } from "../generated/client";

/**
 * Optimized stream query utilities to prevent N+1 query problems
 * across all endpoints that fetch stream data.
 */

export interface OptimizedStreamQuery {
  where?: Prisma.StreamWhereInput;
  orderBy?: Prisma.StreamOrderByWithRelationInput;
  skip?: number;
  take?: number;
  select?: Prisma.StreamSelect;
}

export interface StreamWithOptimizedData {
  id: string;
  streamId: string | null;
  txHash: string;
  version: number;
  sender: string;
  receiver: string;
  contractId: string | null;
  tokenAddress: string | null;
  amount: string;
  duration: number | null;
  status: StreamStatus;
  withdrawn: string | null;
  legacy: boolean;
  migrated: boolean;
  isPrivate: boolean;
  yieldEnabled: boolean;
  vaultContractId: string | null;
  vaultShareBalance: string | null;
  vaultRatioScale: string | null;
  accruedInterest: string;
  lastYieldAccrualAt: Date | null;
  isDust: boolean;
  affiliateId: string | null;
  createdAt: Date;
  // Optimized related data
  eventLog?: {
    eventType: string;
    ledgerClosedAt: string;
    metadata: string | null;
    amount: bigint | null;
    txHash: string;
  } | null;
  tokenPrice?: {
    symbol: string;
    decimals: number;
    priceUsd: number;
  } | null;
  metadata?: Record<string, any>;
}

/**
 * Optimized function to fetch streams with related data in minimal queries
 */
export async function fetchStreamsOptimized(
  query: OptimizedStreamQuery
): Promise<{ streams: StreamWithOptimizedData[]; total?: number }> {
  
  // Execute main query and count in parallel if needed - Query 1 (+ optional Query 2 for count)
  const promises: [Promise<any[]>, Promise<number>?] = [
    prisma.stream.findMany({
      where: query.where,
      orderBy: query.orderBy,
      skip: query.skip,
      take: query.take,
      select: query.select || undefined, // Use full object if no select specified
    }),
  ];

  // Add count query if pagination is being used
  if (query.skip !== undefined || query.take !== undefined) {
    promises.push(prisma.stream.count({ where: query.where }));
  }

  const [streams, total] = await Promise.all(promises.filter(p => p) as [Promise<any[]>, Promise<number>?]);

  if (streams.length === 0) {
    return { streams: [], total };
  }

  // Extract IDs and addresses for batch queries
  const streamIds = streams
    .map(stream => stream.streamId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const tokenAddresses = [
    ...new Set(
      streams
        .map(stream => stream.tokenAddress)
        .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0)
    )
  ];

  // Batch fetch related data in parallel - Query 3 only (or Query 3 & 4 if tokens exist)
  // This is the key optimization: regardless of how many streams, we only make 1-2 more queries
  const [eventLogs, tokenPrices] = await Promise.all([
    // Single query to get all event logs for all streams
    streamIds.length > 0 ? prisma.eventLog.findMany({
      where: {
        streamId: { in: streamIds },
        eventType: 'create' // Only get create events for metadata
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
    }) : Promise.resolve([]),

    // Single query to get all token prices for all unique tokens
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

  // Create efficient lookup maps (O(n) time complexity)
  const eventLogMap = new Map<string, typeof eventLogs[0]>();
  eventLogs.forEach(log => {
    if (!eventLogMap.has(log.streamId)) {
      eventLogMap.set(log.streamId, log);
    }
  });

  const tokenPriceMap = new Map<string, typeof tokenPrices[0]>();
  tokenPrices.forEach(price => {
    tokenPriceMap.set(price.tokenAddress, price);
  });

  // Combine data efficiently (O(n) time complexity)
  const optimizedStreams: StreamWithOptimizedData[] = streams.map(stream => {
    const eventLog = stream.streamId ? eventLogMap.get(stream.streamId) : null;
    const tokenPrice = stream.tokenAddress ? tokenPriceMap.get(stream.tokenAddress) : null;
    
    let metadata = {};
    if (eventLog?.metadata) {
      try {
        metadata = JSON.parse(eventLog.metadata);
      } catch {
        metadata = {};
      }
    }

    return {
      ...stream,
      eventLog,
      tokenPrice,
      metadata,
    } as StreamWithOptimizedData;
  });

  return { streams: optimizedStreams, total };
}

/**
 * Optimized search function for public API
 */
export async function searchStreamsOptimized(
  query: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ streams: StreamWithOptimizedData[]; total: number }> {
  
  const where: Prisma.StreamWhereInput = query
    ? {
        OR: [
          { id: { contains: query, mode: 'insensitive' } },
          { sender: { contains: query, mode: 'insensitive' } },
          { receiver: { contains: query, mode: 'insensitive' } },
          { streamId: { contains: query, mode: 'insensitive' } },
        ],
      }
    : {};

  const result = await fetchStreamsOptimized({
    where,
    take: limit,
    skip: offset,
    orderBy: { createdAt: 'desc' }
  });

  return {
    streams: result.streams,
    total: result.total ?? 0
  };
}

/**
 * Get streams for a specific address with optimizations
 */
export async function getStreamsForAddressOptimized(
  address: string,
  filters: {
    direction?: 'inbound' | 'outbound';
    status?: 'active' | 'paused' | 'completed';
    tokenAddresses?: string[];
  } = {}
): Promise<StreamWithOptimizedData[]> {
  
  const { direction, status, tokenAddresses } = filters;

  const where: Prisma.StreamWhereInput = {
    ...(direction === "inbound" && { receiver: address }),
    ...(direction === "outbound" && { sender: address }),
    ...(!direction && {
      OR: [{ sender: address }, { receiver: address }],
    }),
    ...(status && { status: status.toUpperCase() as StreamStatus }),
    ...(tokenAddresses?.length && { tokenAddress: { in: tokenAddresses } }),
  };

  const result = await fetchStreamsOptimized({
    where,
    orderBy: { id: "desc" }
  });

  return result.streams;
}
