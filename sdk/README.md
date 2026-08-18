# 🌊 @stellarstream/sdk

Official TypeScript/JavaScript SDK for **StellarStream** — real-time continuous asset streaming and linear vesting on Stellar (Soroban).

---

## 📦 Installation

```bash
npm install @stellarstream/sdk @stellar/stellar-sdk
# or
pnpm add @stellarstream/sdk @stellar/stellar-sdk
# or
yarn add @stellarstream/sdk @stellar/stellar-sdk
```

---

## 🚀 Quick Start

### 1. Initialize the SDK

```typescript
import { StellarStreamSDK } from "@stellarstream/sdk";

const sdk = new StellarStreamSDK({
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  network: "TESTNET", // or 'MAINNET', 'FUTURENET', 'STANDALONE'
});
```

### 2. Validate & Create a Payment Stream

```typescript
const now = BigInt(Math.floor(Date.now() / 1000));
const thirtyDaysLater = now + 86_400n * 30n;

const params = {
  sender: "GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA",
  receiver: "GCXFSWUSLTYBGYSQCST6AQNWHQW4G5T7R2H7ZHYK37B4K2L5N6Q6MH7W",
  token: "CUSDC7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  totalAmount: 3_000_000_000n, // 3,000 USDC
  startTime: now,
  endTime: thirtyDaysLater,
};

// Validate stream constraints
sdk.validateCreateStreamParams(params);
```

### 3. Calculate Real-Time Linear Vesting & Claimable Amounts

```typescript
// Calculate vested amount at current timestamp
const vested = sdk.calculateVestedAmount(stream);

// Calculate claimable (unwithdrawn) tokens for receiver
const claimable = sdk.calculateClaimableAmount(stream);
```

### 4. Streaming Rate Calculators

```typescript
const rates = sdk.calculateStreamingRates(stream);

console.log(`Rate per second: ${rates.ratePerSecond} stroops/sec`);
console.log(`Rate per day:    ${rates.ratePerDay} stroops/day`);
console.log(`Rate per month:  ${rates.ratePerMonth} stroops/month`);
```

### 5. Multi-Criteria Filtering & Total Value Locked (TVL)

```typescript
// Filter active streams by token with pagination
const filteredStreams = sdk.applyFilter(allStreams, {
  token: "CUSDC...",
  state: StreamState.Active,
  minAmount: 100_000_000n,
}, 0, 20);

// Compute TVL breakdown per token
const tvl = sdk.computeTVL(allStreams);
for (const [token, amount] of tvl.entries()) {
  console.log(`${token}: ${amount} tokens locked`);
}
```

---

## 🛡️ Error Handling

The SDK maps all on-chain Soroban contract errors to strongly typed exceptions:

```typescript
import { StreamNotFoundError, UnauthorizedError, InvalidTimeRangeError } from "@stellarstream/sdk";

try {
  // perform SDK action
} catch (error) {
  if (error instanceof StreamNotFoundError) {
    console.error("Stream does not exist.");
  } else if (error instanceof UnauthorizedError) {
    console.error("Caller lacks required authorization.");
  }
}
```

---

## 🧪 Testing

```bash
pnpm test
```

---

## 📄 License

MIT © StellarStream Team
