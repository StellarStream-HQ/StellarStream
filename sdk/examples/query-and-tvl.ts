import { StellarStreamSDK, Stream, StreamState } from "../src/index.js";

async function main() {
  const sdk = new StellarStreamSDK({
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    network: "TESTNET",
  });

  const streams: Stream[] = [
    {
      id: 1n,
      sender: "G_ALICE...",
      receiver: "G_BOB...",
      token: "USDC_ADDR",
      totalAmount: 10_000_000_000n,
      withdrawnAmount: 2_000_000_000n,
      startTime: 1000n,
      endTime: 2000n,
      pausedDuration: 0n,
      lastPausedTime: 0n,
      state: StreamState.Active,
    },
    {
      id: 2n,
      sender: "G_CHARLIE...",
      receiver: "G_DAVE...",
      token: "XLM_ADDR",
      totalAmount: 50_000_000_000n,
      withdrawnAmount: 10_000_000_000n,
      startTime: 1000n,
      endTime: 5000n,
      pausedDuration: 0n,
      lastPausedTime: 0n,
      state: StreamState.Active,
    },
  ];

  // Query and filter by token
  const usdcStreams = sdk.applyFilter(streams, { token: "USDC_ADDR" });
  console.log(`Found ${usdcStreams.length} USDC streams.`);

  // Compute protocol TVL
  const tvl = sdk.computeTVL(streams);
  console.log("Protocol TVL Breakdown:");
  for (const [token, amount] of tvl.entries()) {
    console.log(`  ${token}: ${amount} tokens locked`);
  }
}

main().catch(console.error);
