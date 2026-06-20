import { StreamService } from "../services/stream.service.js";

jest.mock("../lib/db.js", () => ({
  prisma: {
    stream: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "../lib/db.js";

function buildMockStream(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `stream_${Math.random().toString(36).slice(2)}`,
    streamId: null,
    txHash: `tx_${Math.random().toString(36).slice(2)}`,
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    receiver: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    tokenAddress: "CUSDC",
    amount: "1000000000",
    duration: 86400,
    status: "ACTIVE",
    withdrawn: "0",
    legacy: false,
    migrated: false,
    isPrivate: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("StreamService N+1 query guard", () => {
  let service: StreamService;

  beforeEach(() => {
    service = new StreamService();
    jest.clearAllMocks();
  });

  it.each([50, 1000])(
    "issues exactly 1 query for getStreamsForAddress with %d streams",
    async (count) => {
      const mockStreams = Array.from({ length: count }, () => buildMockStream());
      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(mockStreams);

      const result = await service.getStreamsForAddress(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );

      expect(result).toHaveLength(count);
      expect(prisma.stream.findMany).toHaveBeenCalledTimes(1);
    },
  );

  it.each([50, 1000])(
    "issues exactly 1 query for getStreamsBatch across many addresses with %d streams",
    async (count) => {
      const addresses = Array.from(
        { length: 25 },
        (_, i) => `GADDR${i.toString().padStart(2, "0")}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.slice(0, 56),
      );
      const mockStreams = Array.from({ length: count }, (_, i) =>
        buildMockStream({
          sender: addresses[i % addresses.length],
          receiver: addresses[(i + 1) % addresses.length],
        }),
      );
      (prisma.stream.findMany as jest.Mock).mockResolvedValueOnce(mockStreams);

      const result = await service.getStreamsBatch(addresses);

      expect(prisma.stream.findMany).toHaveBeenCalledTimes(1);
      // Every requested address has an entry, even ones with no streams.
      expect(result.size).toBe(addresses.length);
    },
  );

  it("does not query the database when getStreamsBatch is called with no addresses", async () => {
    const result = await service.getStreamsBatch([]);

    expect(result.size).toBe(0);
    expect(prisma.stream.findMany).not.toHaveBeenCalled();
  });
});
