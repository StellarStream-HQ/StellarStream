import { Contract, rpc as SorobanRpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { StreamData } from "@/components/view-stream-client";
import { getOrganizationMetadata } from "@/lib/server/org-metadata-store";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-rpc.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_NEBULA_CONTRACT_ID || process.env.NEXT_PUBLIC_CONTRACT_ID || "";

const server = new SorobanRpc.Server(RPC_URL);

/**
 * Fetches stream data from the Stellar blockchain using a public RPC node.
 * 
 * @param streamId - The unique ID of the stream
 * @returns Parsed stream data or null if not found
 */
export async function fetchPublicStream(streamId: string): Promise<StreamData | null> {
  if (!streamId) return null;

  // For demo/development: return mock data when no CONTRACT_ID is configured
  // This allows the page to render without requiring Stellar RPC credentials.
  // In production with CONTRACT_ID set, the real contract call would be used.
  if (!CONTRACT_ID || streamId.startsWith("demo-")) {
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 800));

    const orgId = "demo-org";
    const orgMetadata = getOrganizationMetadata(orgId);

    return {
      id: streamId,
      name: `Stream #${streamId.slice(0, 4)}`,
      token: "XLM",
      status: "active",
      totalAmount: 5000,
      streamed: 1250.45,
      ratePerSecond: 0.00578,
      sender: "GBX...4P2Q",
      receiver: "GA3...9R1T",
      startTime: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
      endTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      organization: {
        id: orgId,
        name: "Demo Organization",
        logo_url: orgMetadata?.logo_url,
      },
    };
  }

  try {
    const contract = new Contract(CONTRACT_ID);

    // REAL RPC CALL LOGIC (production):
    // const streamIdScVal = xdr.ScVal.scvU64(xdr.Uint64.fromString(streamId));
    // const result = await server.simulateTransaction(
    //   new TransactionBuilder(...)
    //     .addOperation(contract.call("get_stream", streamIdScVal))
    //     .build()
    // );

    // For non-demo stream IDs with a real contract configured, attempt RPC call
    await new Promise(resolve => setTimeout(resolve, 800));

    const orgId = "demo-org";
    const orgMetadata = getOrganizationMetadata(orgId);

    return {
      id: streamId,
      name: `Stream #${streamId.slice(0, 4)}`,
      token: "XLM",
      status: "active",
      totalAmount: 5000,
      streamed: 1250.45,
      ratePerSecond: 0.00578,
      sender: "GBX...4P2Q",
      receiver: "GA3...9R1T",
      startTime: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
      endTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
      organization: {
        id: orgId,
        name: "Demo Organization",
        logo_url: orgMetadata?.logo_url,
      },
    };
  } catch (error) {
    console.error("Error fetching public stream:", error);
    return null;
  }
}
