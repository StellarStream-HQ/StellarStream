import { StellarStreamSDK, Networks, type ContractTransport } from "@stellarstream/sdk";

// Implement this adapter with Freighter (or another wallet): simulate read calls,
// and sign/submit write calls using sdk.transactions.buildInvocation(method, args).
const transport: ContractTransport = { invoke: async () => { throw new Error("Connect a wallet transport before calling the SDK"); } };
const sdk = new StellarStreamSDK("YOUR_CONTRACT_ID", Networks.testnet, transport);
console.log(sdk.transactions.buildInvocation("get_protocol_fee"));
