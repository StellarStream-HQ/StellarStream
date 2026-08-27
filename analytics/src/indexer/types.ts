import { ContractVersion } from "../db/types.js";

export interface SorobanRawTopic {
  _value?: unknown;
  [key: string]: unknown;
}

export interface SorobanEventRaw {
  id: string;
  type: "contract" | "system" | "diagnostic";
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: unknown[];
  value: unknown;
  txInfo?: {
    txHash?: string;
    feeCharged?: string | number;
    cpuInstructions?: number;
    memoryBytes?: number;
  };
  inSuccessfulContractCall?: boolean;
}

export interface DecodedContractEvent {
  eventId: string;
  contractId: string;
  contractVersion: ContractVersion;
  topicAction: "create" | "withdraw" | "cancel" | "pause" | "resume" | string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  sender?: string;
  receiver?: string;
  tokenAddress: string;
  tokenSymbol: string;
  streamId?: string;
  amount?: string;
  amountFormatted?: number;
  startTime?: number;
  endTime?: number;
  durationSeconds?: number;
  refundAmount?: string;
  refundAmountFormatted?: number;
  gasConsumed?: number;
  feeChargedStroops?: number;
  memoryBytes?: number;
  rawPayload: Record<string, unknown>;
}

export interface IndexerConfig {
  rpcUrl: string;
  network: "mainnet" | "testnet" | "futurenet" | "standalone";
  contractAddresses: Record<ContractVersion, string[]>;
  pollIntervalMs: number;
  batchSize: number;
  startLedger: number;
}
