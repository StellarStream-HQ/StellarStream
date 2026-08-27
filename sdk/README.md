# StellarStream Frontend SDK

Typed TypeScript client for the public API of the StellarStream V1 Soroban contract.

## Install

```bash
npm install @stellarstream/sdk @stellar/stellar-sdk
```

## Configure and use

The SDK deliberately accepts a small `ContractTransport` interface, keeping wallet choice out of the package. Implement `invoke` with your Freighter, Albedo, or relayer integration. Call `sdk.transactions.buildInvocation(method, args)` in that adapter to produce a Stellar SDK contract operation.

```ts
import { Networks, StellarStreamSDK, type ContractTransport } from "@stellarstream/sdk";

const transport: ContractTransport = { invoke: async (method, args, mode) => {
  // Simulate when mode is "read"; build, sign, and submit when it is "write".
  throw new Error("wallet adapter not configured");
}};
const sdk = new StellarStreamSDK("CONTRACT_ID", Networks.testnet, transport);
const stream = await sdk.getStream(1n);
```

`StellarStreamSDK` wraps every public V1 contract method, returns typed domain objects, reports failures as `StellarStreamError`, exposes `parseEvent`, and provides `transactions.buildInvocation` for signing flows.

## Development

```bash
npm install
npm run build
npm test
npm run docs
```
