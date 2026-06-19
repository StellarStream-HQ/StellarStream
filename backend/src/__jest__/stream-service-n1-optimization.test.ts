import { StreamStatus } from '../generated/client';
import { StreamService } from '../services/stream.service';

// Mock the prisma import
const mockPrisma = {
  stream: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  eventLog: {
    findMany: jest.fn(),
  },
  tokenPrice: {
    findMany: jest.fn(),
  }
} as any;

jest.mock('../lib/db', () => ({
  prisma: mockPrisma
}));

// Mock the optimized queries
jest.mock('../lib/optimized-stream-queries', () => ({
  getStreamsForAddressOptimized: jest.fn(),
  fetchStreamsOptimized: jest.fn(),
}));

import { getStreamsForAddressOptimized } from '../lib/optimized-stream-queries';

describe('StreamService N+1 Query Optimization', () => {
  let streamService: StreamService;
  const mockGetStreamsForAddressOptimized = getStreamsForAddressOptimized as jest.MockedFunction<typeof getStreamsForAddressOptimized>;

  beforeEach(() => {
    streamService = new StreamService();
    streamService.resetQueryCount();
    jest.clearAllMocks();
  });

  /**
   * Test that fetching 50 streams makes less than 5 database queries
   */
  test('should fetch 50 streams with less than 5 queries', async () => {
    // Setup mock data for 50 streams
    const mockStreams = Array.from({ length: 50 }, (_, i) => ({
      id: `stream-${i}`,
      streamId: `stream-id-${i}`,
      txHash: `tx-${i}`,
      version: 1,
      sender: `sender-${i}`,
      receiver: `receiver-${i}`,
      contractId: 'contract-1',
      tokenAddress: `token-${i % 5}`, // 5 unique tokens
      amount: '1000000',
      duration: 86400,
      status: StreamStatus.ACTIVE,
      withdrawn: '0',
      legacy: false,
      migrated: false,
      isPrivate: false,
      yieldEnabled: false,
      vaultContractId: null,
      vaultShareBalance: null,
      vaultRatioScale: null,
      accruedInterest: '0',
      lastYieldAccrualAt: null,
      isDust: false,
      affiliateId: null,
      createdAt: new Date(),
      eventLog: {
        eventType: 'create',
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        metadata: '{}',
        amount: BigInt(1000000),
        txHash: `tx-${i}`,
      },
      tokenPrice: {
        tokenAddress: `token-${i % 5}`,
        symbol: `TOK${i % 5}`,
        decimals: 7,
        priceUsd: 1.0,
      },
      metadata: {},
    }));

    mockGetStreamsForAddressOptimized.mockResolvedValue(mockStreams);

    // Execute the test
    const address = 'test-address';
    const result = await streamService.getStreamsForAddress(address);

    // Assertions
    expect(result).toHaveLength(50);
    
    // The key optimization test: should be < 5 queries total
    expect(streamService.getQueryCount()).toBeLessThan(5);
    
    // Verify the result structure
    expect(result[0]).toHaveProperty('eventLog');
    expect(result[0]).toHaveProperty('tokenPrice');
    expect(result[0]).toHaveProperty('metadata');
  });

  /**
   * Test that fetching 1000 streams still scales linearly (< 5 queries)
   */
  test('should scale linearly - 1000 streams with < 5 queries', async () => {
    // Setup mock data for 1000 streams
    const mockStreams = Array.from({ length: 1000 }, (_, i) => ({
      id: `stream-${i}`,
      streamId: `stream-id-${i}`,
      txHash: `tx-${i}`,
      version: 1,
      sender: `sender-${i}`,
      receiver: `receiver-${i}`,
      contractId: 'contract-1',
      tokenAddress: `token-${i % 10}`, // 10 unique tokens
      amount: '1000000',
      duration: 86400,
      status: StreamStatus.ACTIVE,
      withdrawn: '0',
      legacy: false,
      migrated: false,
      isPrivate: false,
      yieldEnabled: false,
      vaultContractId: null,
      vaultShareBalance: null,
      vaultRatioScale: null,
      accruedInterest: '0',
      lastYieldAccrualAt: null,
      isDust: false,
      affiliateId: null,
      createdAt: new Date(),
      eventLog: {
        eventType: 'create',
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        metadata: '{}',
        amount: BigInt(1000000),
        txHash: `tx-${i}`,
      },
      tokenPrice: {
        tokenAddress: `token-${i % 10}`,
        symbol: `TOK${i % 10}`,
        decimals: 7,
        priceUsd: 1.0,
      },
      metadata: {},
    }));

    mockGetStreamsForAddressOptimized.mockResolvedValue(mockStreams);

    const address = 'test-address';
    const result = await streamService.getStreamsForAddress(address);

    expect(result).toHaveLength(1000);
    // This is the critical test - even with 1000 streams, we should have < 5 queries
    expect(streamService.getQueryCount()).toBeLessThan(5);
  });

  /**
   * Test edge cases and error handling
   */
  test('should handle empty results efficiently', async () => {
    mockGetStreamsForAddressOptimized.mockResolvedValue([]);

    const result = await streamService.getStreamsForAddress('nonexistent-address');

    expect(result).toHaveLength(0);
    expect(streamService.getQueryCount()).toBe(3); // Still makes optimized queries
  });
});
