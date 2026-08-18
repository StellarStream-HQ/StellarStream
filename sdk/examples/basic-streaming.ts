import { StellarStreamSDK, StreamState } from "../src/index.js";

async function main() {
  // 1. Initialize the SDK for Testnet
  const sdk = new StellarStreamSDK({
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    network: "TESTNET",
  });

  console.log("StellarStream SDK configured for:", sdk.config.rpcUrl);

  // 2. Validate parameters for a 30-day stream
  const now = BigInt(Math.floor(Date.now() / 1000));
  const thirtyDaysLater = now + 86_400n * 30n;

  const streamParams = {
    sender: "GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA",
    receiver: "GCXFSWUSLTYBGYSQCST6AQNWHQW4G5T7R2H7ZHYK37B4K2L5N6Q6MH7W",
    token: "CUSDC7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    totalAmount: 3_000_000_000n, // 3,000 USDC
    startTime: now,
    endTime: thirtyDaysLater,
  };

  sdk.validateCreateStreamParams(streamParams);
  console.log("Stream parameters are valid!");

  // 3. Simulate stream state
  const mockStream = {
    id: 101n,
    ...streamParams,
    totalAmount: BigInt(streamParams.totalAmount),
    withdrawnAmount: 0n,
    pausedDuration: 0n,
    lastPausedTime: 0n,
    state: StreamState.Active,
  };

  // 4. Calculate streaming rates
  const rates = sdk.calculateStreamingRates(mockStream);
  console.log("Stream Rates:");
  console.log(`  Per Second: ${rates.ratePerSecond} stroops/sec`);
  console.log(`  Per Day:    ${rates.ratePerDay} stroops/day (100 USDC/day)`);
  console.log(`  Per Month:  ${rates.ratePerMonth} stroops/month (3,000 USDC/month)`);

  // 5. Calculate real-time linear vesting after 15 days
  const fifteenDaysTimestamp = now + 86_400n * 15n;
  const vested = sdk.calculateVestedAmount(mockStream, fifteenDaysTimestamp);
  const claimable = sdk.calculateClaimableAmount(mockStream, fifteenDaysTimestamp);

  console.log(`Vested after 15 days: ${vested} (50% = 1,500 USDC)`);
  console.log(`Claimable amount:    ${claimable} USDC`);
}

main().catch(console.error);
