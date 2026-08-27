import { Address, Contract, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Network } from "./types.js";
import { StellarStreamError } from "./errors.js";

export type InvocationMode = "read" | "write";
/** Adapter boundary for wallets, relayers, and test doubles. */
export interface ContractTransport { invoke(method: string, args: unknown[], mode: InvocationMode): Promise<unknown>; }
export interface Invocation { method: string; args: xdr.ScVal[]; operation: xdr.Operation; }

/** Builds SDK-native contract operations; signing/submission remains wallet-specific. */
export class TransactionBuilderHelper {
  readonly contract: Contract;
  constructor(public readonly contractId: string, public readonly network: Network) {
    this.contract = new Contract(contractId);
  }
  buildInvocation(method: string, args: unknown[] = []): Invocation {
    try {
      const values = args.map((arg) => nativeToScVal(arg, { type: inferScValType(arg) }));
      return { method, args: values, operation: this.contract.call(method, ...values) };
    } catch (error) {
      throw new StellarStreamError(`Unable to build ${method} invocation`, method, error);
    }
  }
}

/** Decodes a Soroban SCVal into native JavaScript values. */
export function decodeScVal(value: xdr.ScVal | unknown): unknown {
  return value instanceof xdr.ScVal ? scValToNative(value) : value;
}

function inferScValType(value: unknown): any {
  if (typeof value === "bigint") return value >= 0n ? "u64" : "i128";
  if (typeof value === "number") return "u32";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return value.startsWith("G") || value.startsWith("C") ? "address" : "string";
  return undefined;
}
