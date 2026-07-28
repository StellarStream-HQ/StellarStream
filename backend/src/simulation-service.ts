import { loadConfig } from './config.js';
import { RawFeeData } from './fee-calculator.js';

// ---- Structured error types ----

export class SimulationRpcError extends Error {
  constructor(
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationRpcError';
  }
}

export class SimulationNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SimulationNetworkError';
  }
}

// ---- XDR inclusion-fee extraction ----
//
// A Stellar TransactionEnvelope is XDR-encoded as a union:
//   union TransactionEnvelope switch (EnvelopeType type) {
//     case ENVELOPE_TYPE_TX_V0:  TransactionV0Envelope e;
//     case ENVELOPE_TYPE_TX:     TransactionV1Envelope e;
//     ...
//   }
//
// For ENVELOPE_TYPE_TX (discriminant = 2, the most common Soroban type):
//   bytes 0-3  : int32 discriminant (0x00000002)
//   bytes 4-7  : uint32 fee  <-- what we want
//
// For ENVELOPE_TYPE_TX_V0 (discriminant = 0):
//   bytes 0-3  : int32 discriminant (0x00000000)
//   bytes 4-35 : 32-byte ed25519 public key (sourceAccount)
//   bytes 36-39: uint32 fee
//
// We handle both common cases; fall back to 100 stroops if parsing fails.

const ENVELOPE_TYPE_TX_V0 = 0;
const ENVELOPE_TYPE_TX = 2;
const DEFAULT_INCLUSION_FEE = 100;

export function extractInclusionFee(transactionXdr: string): number {
  try {
    // Decode base64 to a Uint8Array using atob (available in Node 16+ and browsers)
    const binary = atob(transactionXdr);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (bytes.length < 8) return DEFAULT_INCLUSION_FEE;

    const view = new DataView(bytes.buffer);
    const discriminant = view.getUint32(0, false /* big-endian */);

    if (discriminant === ENVELOPE_TYPE_TX) {
      // fee is at bytes 4-7
      return view.getUint32(4, false);
    }

    if (discriminant === ENVELOPE_TYPE_TX_V0) {
      // sourceAccount: 4-byte type discriminant + 32-byte key = 36 bytes
      // fee starts at offset 4 + 36 = 40
      if (bytes.length < 44) return DEFAULT_INCLUSION_FEE;
      return view.getUint32(40, false);
    }

    return DEFAULT_INCLUSION_FEE;
  } catch {
    return DEFAULT_INCLUSION_FEE;
  }
}

// ---- Soroban RPC response shape ----

interface SimulateTransactionResult {
  minResourceFee?: string;
  cost?: {
    cpuInsns?: string;
    memBytes?: string;
  };
}

interface RpcSuccessResponse {
  jsonrpc: string;
  id: number;
  result: SimulateTransactionResult;
}

interface RpcErrorResponse {
  jsonrpc: string;
  id: number;
  error: {
    code: number;
    message: string;
  };
}

type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

function isRpcError(r: RpcResponse): r is RpcErrorResponse {
  return 'error' in r && r.error != null;
}

// ---- Main simulate function ----

export async function simulate(transactionXdr: string): Promise<RawFeeData> {
  const { sorobanRpcUrl } = loadConfig();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: { transaction: transactionXdr },
  });

  let response: Response;
  try {
    response = await fetch(sorobanRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted);
    const message = isAbort
      ? 'Soroban RPC request timed out after 10 seconds'
      : `Network error reaching Soroban RPC: ${err instanceof Error ? err.message : String(err)}`;
    throw new SimulationNetworkError(message, err);
  } finally {
    clearTimeout(timeoutId);
  }

  let rpcResponse: RpcResponse;
  try {
    rpcResponse = (await response.json()) as RpcResponse;
  } catch (err) {
    throw new SimulationNetworkError(
      `Failed to parse Soroban RPC response (HTTP ${response.status})`,
      err,
    );
  }

  if (isRpcError(rpcResponse)) {
    throw new SimulationRpcError(
      rpcResponse.error.code,
      `Soroban RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`,
    );
  }

  const minResourceFee = parseInt(rpcResponse.result.minResourceFee ?? '0', 10);
  if (isNaN(minResourceFee) || minResourceFee < 0) {
    throw new SimulationRpcError(
      null,
      `Invalid minResourceFee in RPC response: "${rpcResponse.result.minResourceFee}"`,
    );
  }

  const inclusionFee = extractInclusionFee(transactionXdr);

  return { minResourceFee, inclusionFee };
}
