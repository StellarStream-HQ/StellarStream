/**
 * Enum representing the current lifecycle state of a payment stream.
 */
export enum StreamState {
  Active = 0,
  Paused = 1,
  Completed = 2,
  Cancelled = 3,
}

/**
 * Interface representing a StellarStream payment stream.
 */
export interface Stream {
  id: bigint;
  sender: string;
  receiver: string;
  token: string;
  totalAmount: bigint;
  withdrawnAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  pausedDuration: bigint;
  lastPausedTime: bigint;
  state: StreamState;
}

/**
 * Parameters required to initialize a new stream.
 */
export interface CreateStreamParams {
  sender: string;
  receiver: string;
  token: string;
  totalAmount: bigint | number | string;
  startTime: bigint | number;
  endTime: bigint | number;
}

/**
 * Multi-criteria filter options for querying streams.
 */
export interface StreamFilter {
  token?: string;
  state?: StreamState;
  minAmount?: bigint | number | string;
  maxAmount?: bigint | number | string;
  startTimeAfter?: bigint | number;
  endTimeBefore?: bigint | number;
}

/**
 * Calculated streaming rates across multiple timeframes.
 */
export interface StreamingRates {
  ratePerSecond: bigint;
  ratePerDay: bigint;
  ratePerMonth: bigint;
}

/**
 * Network configuration options for connecting to Stellar and Soroban RPC.
 */
export interface NetworkConfig {
  networkPassphrase: string;
  rpcUrl: string;
  contractId: string;
}

/**
 * Standard Stellar network presets.
 */
export const NETWORKS = {
  TESTNET: {
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  MAINNET: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
  },
  FUTURENET: {
    networkPassphrase: "Test SDF Future Network ; October 2022",
    rpcUrl: "https://rpc-futurenet.stellar.org",
  },
  STANDALONE: {
    networkPassphrase: "Standalone Network ; February 2017",
    rpcUrl: "http://localhost:8000/soroban/rpc",
  },
} as const;

/**
 * SDK configuration options.
 */
export interface SDKConfig {
  contractId: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  network?: keyof typeof NETWORKS;
}

/**
 * Parsed contract event data.
 */
export interface StreamEvent {
  type: "StreamCreated" | "StreamPaused" | "StreamUnpaused" | "StreamCancelled" | "Withdrawal" | "Unknown";
  streamId: bigint;
  contractId: string;
  ledger: number;
  data: Record<string, any>;
}
