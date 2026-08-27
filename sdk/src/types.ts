/** Network configuration used by the SDK transport. */
export interface Network { rpcUrl: string; networkPassphrase: string; }
export const Networks = {
  testnet: { rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: "Test SDF Network ; September 2015" },
  mainnet: { rpcUrl: "https://soroban-rpc.stellar.org", networkPassphrase: "Public Global Stellar Network ; September 2015" },
} as const satisfies Record<string, Network>;

export type Address = string;
export type StreamId = bigint;
export const StreamState = { Active: 0, Paused: 1, Closed: 2 } as const;
export const CurveType = { Linear: 0, Exponential: 1, Milestone: 2 } as const;
export const Role = { Admin: 0, Pauser: 1, Treasury: 2 } as const;

export interface Milestone { timestamp: bigint; percentage: number; }
export interface CreateStreamParams {
  sender: Address; receiver: Address; token: Address; totalAmount: bigint;
  startTime: bigint; endTime: bigint; curveType?: number; isSoulbound?: boolean; milestones?: Milestone[];
}
export interface CreateProposalParams {
  sender: Address; receiver: Address; token: Address; totalAmount: bigint;
  startTime: bigint; endTime: bigint; requiredApprovals: number; deadline: bigint;
}
export interface Stream {
  id: StreamId; sender: Address; receiver: Address; token: Address; totalAmount: bigint;
  startTime: bigint; endTime: bigint; withdrawnAmount: bigint; state: number; curveType: number;
  isSoulbound: boolean; pausedDuration: bigint; lastPausedAt: bigint;
}
export interface StreamProposal {
  sender: Address; receiver: Address; token: Address; totalAmount: bigint; startTime: bigint;
  endTime: bigint; approvers: Address[]; requiredApprovals: number; deadline: bigint; executed: boolean;
}
export interface StreamMetadata { label: string; tags: string[]; externalRef?: string; }
export interface ContractHealth { isPaused: boolean; activeStreams: bigint; totalTvl: Map<Address, bigint>; lastActivityTime: bigint; version: number; }
export interface ContractMetrics { streamsCreated24h: bigint; withdrawals24h: bigint; avgStreamDuration: bigint; avgStreamAmount: bigint; uniqueUsers24h: bigint; }
export interface StreamEvent { streamId: bigint; action: string; amount?: bigint; timestamp: bigint; }
export interface ParsedContractEvent { topic: string; source?: Address; value: unknown; raw: unknown; }
