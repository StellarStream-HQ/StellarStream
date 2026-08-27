import { describe, expect, it } from "vitest";
import { StellarStreamError, StellarStreamSDK, type ContractTransport } from "../src/index.js";

const calls: { method: string; args: unknown[]; mode: string }[] = [];
const transport: ContractTransport = { invoke: async (method, args, mode) => { calls.push({ method, args, mode }); if (method === "get_stream") return { total_amount: 50n, is_soulbound: false }; return 9n; } };
const sdk = new StellarStreamSDK("CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526", { rpcUrl: "https://rpc.example", networkPassphrase: "test" }, transport);
describe("StellarStreamSDK", () => {
  it("uses contract ABI names and normalizes response fields", async () => {
    const stream = await sdk.getStream(7n);
    expect(calls.at(-1)).toEqual({ method: "get_stream", args: [7n], mode: "read" });
    expect(stream.totalAmount).toBe(50n);
    await sdk.createStream({ sender: "GA", receiver: "GB", token: "CA", totalAmount: 10n, startTime: 1n, endTime: 2n });
    expect(calls.at(-1)?.method).toBe("create_stream"); expect(calls.at(-1)?.mode).toBe("write");
  });
  it("adds method context to transport failures", async () => {
    const failing = new StellarStreamSDK("CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526", { rpcUrl: "x", networkPassphrase: "x" }, { invoke: async () => { throw new Error("offline"); } });
    await expect(failing.getProtocolFee()).rejects.toMatchObject({ name: "StellarStreamError", method: "get_protocol_fee" } satisfies Partial<StellarStreamError>);
  });
  it("builds a Stellar contract operation for wallet adapters", () => {
    const invocation = sdk.transactions.buildInvocation("get_stream", [7n]);
    expect(invocation.method).toBe("get_stream");
    expect(invocation.args).toHaveLength(1);
  });
});
