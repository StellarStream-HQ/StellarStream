import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

const DEFAULT_RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const DEFAULT_HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const DEFAULT_FEE_BUFFER_SECRET = process.env.FEE_BUFFER_SECRET_KEY ?? "";

export const MONITOR_TIMEOUT_MS = 30_000;
export const POLL_INTERVAL_MS = 3_000;
export const FEE_BUMP_FACTOR_PERCENT = 120n;
export const DEFAULT_MAX_BUMPS = 3;

type ConfirmationStatus = "SUCCESS" | "FAILED" | "PENDING";

interface FeeBumpResult {
  newTxHash: string;
  newTxXdr: string;
  newFeeStroops: string;
}

interface MonitoredTransactionEntity {
  id: string;
  txHash: string;
  txXdr: string;
  sourceAddress: string;
  originalFeeSt: string;
  currentFeeSt: string;
  bumpCount: number;
  maxBumps: number;
  status: string;
  submittedAt: Date;
  confirmedAt: Date | null;
  lastBumpAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeBumpRelayerPrismaClient {
  monitoredTransaction: {
    create(args: {
      data: {
        txHash: string;
        txXdr: string;
        sourceAddress: string;
        originalFeeSt: string;
        currentFeeSt: string;
        maxBumps: number;
        status: string;
      };
    }): Promise<MonitoredTransactionEntity>;
    findUniqueOrThrow(args: { where: { id: string } }): Promise<MonitoredTransactionEntity>;
    update(args: {
      where: { id: string };
      data: Partial<MonitoredTransactionEntity> & { bumpCount?: { increment: number } };
    }): Promise<MonitoredTransactionEntity>;
    findUnique(args: { where: { txHash: string } }): Promise<MonitoredTransactionEntity | null>;
    findMany(args: {
      where?: { status: string };
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<MonitoredTransactionEntity[]>;
  };
}

export interface FeeBumpRelayerDependencies {
  prismaClient?: FeeBumpRelayerPrismaClient;
  rpcServer?: Pick<SorobanRpc.Server, "sendTransaction">;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  horizonUrl?: string;
  networkPassphrase?: string;
  feeBufferSecret?: string;
  monitorTimeoutMs?: number;
  pollIntervalMs?: number;
  defaultMaxBumps?: number;
  pollForConfirmationFn?: (txHash: string, timeoutMs: number) => Promise<ConfirmationStatus>;
  bumpFeeFn?: (originalXdr: string, currentFeeStroops: string) => Promise<FeeBumpResult>;
}

export interface MonitorRequest {
  txHash: string;
  txXdr: string;
  sourceAddress: string;
  feeStroops: string;
  maxBumps?: number;
}

export interface MonitorResult {
  txHash: string;
  status: "CONFIRMED" | "FAILED" | "EXPIRED";
  finalFeeStroops: string;
  bumpCount: number;
  errorMessage?: string;
}

export function calculateBumpedFeeStroops(currentFeeStroops: string): string {
  const currentFee = BigInt(currentFeeStroops);
  return ((currentFee * FEE_BUMP_FACTOR_PERCENT) / 100n).toString();
}

export class FeeBumpRelayerService {
  private readonly prismaClient: FeeBumpRelayerPrismaClient;
  private readonly rpcServer: Pick<SorobanRpc.Server, "sendTransaction">;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly horizonUrl: string;
  private readonly networkPassphrase: string;
  private readonly feeBufferSecret: string;
  private readonly monitorTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly defaultMaxBumps: number;
  private readonly pollForConfirmationOverride?: FeeBumpRelayerDependencies["pollForConfirmationFn"];
  private readonly bumpFeeOverride?: FeeBumpRelayerDependencies["bumpFeeFn"];

  constructor(dependencies: FeeBumpRelayerDependencies = {}) {
    const rpcUrl = DEFAULT_RPC_URL;

    this.prismaClient = dependencies.prismaClient ?? (prisma as unknown as FeeBumpRelayerPrismaClient);
    this.rpcServer =
      dependencies.rpcServer ??
      new SorobanRpc.Server(rpcUrl, {
        allowHttp: rpcUrl.startsWith("http://"),
      });
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.sleepFn = dependencies.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.horizonUrl = dependencies.horizonUrl ?? DEFAULT_HORIZON_URL;
    this.networkPassphrase = dependencies.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    this.feeBufferSecret = dependencies.feeBufferSecret ?? DEFAULT_FEE_BUFFER_SECRET;
    this.monitorTimeoutMs = dependencies.monitorTimeoutMs ?? MONITOR_TIMEOUT_MS;
    this.pollIntervalMs = dependencies.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.defaultMaxBumps = dependencies.defaultMaxBumps ?? DEFAULT_MAX_BUMPS;
    this.pollForConfirmationOverride = dependencies.pollForConfirmationFn;
    this.bumpFeeOverride = dependencies.bumpFeeFn;
  }

  async monitorTransaction(request: MonitorRequest): Promise<MonitorResult> {
    const record = await this.prismaClient.monitoredTransaction.create({
      data: {
        txHash: request.txHash,
        txXdr: request.txXdr,
        sourceAddress: request.sourceAddress,
        originalFeeSt: request.feeStroops,
        currentFeeSt: request.feeStroops,
        maxBumps: request.maxBumps ?? this.defaultMaxBumps,
        status: "PENDING",
      },
    });

    return this.runMonitorLoop(record.id);
  }

  async getTransactionStatus(txHash: string) {
    return this.prismaClient.monitoredTransaction.findUnique({ where: { txHash } });
  }

  async listMonitored(status?: string, limit = 20) {
    return this.prismaClient.monitoredTransaction.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  private async runMonitorLoop(recordId: string): Promise<MonitorResult> {
    let record = await this.prismaClient.monitoredTransaction.findUniqueOrThrow({
      where: { id: recordId },
    });

    while (record.status === "PENDING" || record.status === "SUBMITTED") {
      const confirmed = this.pollForConfirmationOverride
        ? await this.pollForConfirmationOverride(record.txHash, this.monitorTimeoutMs)
        : await this.pollForConfirmation(record.txHash, this.monitorTimeoutMs);

      if (confirmed === "SUCCESS") {
        record = await this.prismaClient.monitoredTransaction.update({
          where: { id: recordId },
          data: { status: "CONFIRMED", confirmedAt: new Date() },
        });
        break;
      }

      if (confirmed === "FAILED") {
        record = await this.prismaClient.monitoredTransaction.update({
          where: { id: recordId },
          data: { status: "FAILED", errorMessage: "Transaction failed on-chain" },
        });
        break;
      }

      if (record.bumpCount >= record.maxBumps) {
        record = await this.prismaClient.monitoredTransaction.update({
          where: { id: recordId },
          data: {
            status: "EXPIRED",
            errorMessage: `Max fee bumps (${record.maxBumps}) exceeded`,
          },
        });
        break;
      }

      try {
        const bumpResult = this.bumpFeeOverride
          ? await this.bumpFeeOverride(record.txXdr, record.currentFeeSt)
          : await this.bumpFee(record.txXdr, record.currentFeeSt);

        record = await this.prismaClient.monitoredTransaction.update({
          where: { id: recordId },
          data: {
            txHash: bumpResult.newTxHash,
            txXdr: bumpResult.newTxXdr,
            currentFeeSt: bumpResult.newFeeStroops,
            bumpCount: { increment: 1 } as any,
            lastBumpAt: new Date(),
            status: "SUBMITTED",
          },
        });

        logger.info("[FeeBumpRelayer] Fee bumped and re-submitted", {
          recordId,
          bumpCount: record.bumpCount,
          newFee: bumpResult.newFeeStroops,
          newTxHash: bumpResult.newTxHash,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record = await this.prismaClient.monitoredTransaction.update({
          where: { id: recordId },
          data: { status: "FAILED", errorMessage: `Fee bump failed: ${message}` },
        });
        break;
      }
    }

    return {
      txHash: record.txHash,
      status: record.status as MonitorResult["status"],
      finalFeeStroops: record.currentFeeSt,
      bumpCount: record.bumpCount,
      errorMessage: record.errorMessage ?? undefined,
    };
  }

  private async pollForConfirmation(
    txHash: string,
    timeoutMs: number
  ): Promise<ConfirmationStatus> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const response = await this.fetchFn(`${this.horizonUrl}/transactions/${txHash}`);
        if (response.ok) {
          const data = (await response.json()) as { successful?: boolean };
          return data.successful ? "SUCCESS" : "FAILED";
        }
      } catch {
      }

      await this.sleepFn(this.pollIntervalMs);
    }

    return "PENDING";
  }

  private async bumpFee(
    originalXdr: string,
    currentFeeStroops: string
  ): Promise<FeeBumpResult> {
    if (!this.feeBufferSecret) {
      throw new Error("FEE_BUFFER_SECRET_KEY not configured");
    }

    const feeBufferKeypair = Keypair.fromSecret(this.feeBufferSecret);
    const newFeeStroops = calculateBumpedFeeStroops(currentFeeStroops);
    const innerTx = TransactionBuilder.fromXDR(
      originalXdr,
      this.networkPassphrase
    ) as unknown as Transaction;

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeBufferKeypair,
      newFeeStroops,
      innerTx,
      this.networkPassphrase
    );

    feeBumpTx.sign(feeBufferKeypair);

    const response = await this.rpcServer.sendTransaction(feeBumpTx);
    if (response.status === "ERROR" || !response.hash) {
      throw new Error(`Fee-bump submission failed: ${JSON.stringify(response)}`);
    }

    return {
      newTxHash: response.hash,
      newTxXdr: feeBumpTx.toXDR(),
      newFeeStroops,
    };
  }
}
