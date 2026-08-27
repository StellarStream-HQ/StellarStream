/**
 * StellarStream Prometheus Exporter (issue #1502)
 *
 * Scrapes the contract's two read-only monitoring functions and republishes
 * them in Prometheus text format on /metrics.
 *
 *   health_check() -> ContractHealth
 *   get_metrics()  -> ContractMetrics
 *
 * Both are simulated, never submitted, so scraping costs no fees and needs no
 * signing key -- only an RPC endpoint and the contract id.
 *
 * Usage:
 *   RPC_URL=https://soroban-testnet.stellar.org \
 *   STELLARSTREAM_CONTRACT_ID=C... \
 *   npx tsx prometheus-exporter.ts
 *
 * See ../METRICS.md for the Prometheus scrape config and Grafana panels.
 */

import express, { Request, Response } from "express";
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  rpc as SorobanRpc,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";

// ============================================================================
// Configuration
// ============================================================================

const PORT = Number(process.env.PORT ?? 9101);
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = process.env.STELLARSTREAM_CONTRACT_ID ?? "";

if (!CONTRACT_ID) {
  throw new Error("STELLARSTREAM_CONTRACT_ID is required");
}

const server = new SorobanRpc.Server(RPC_URL, {
  allowHttp: RPC_URL.startsWith("http://"),
});
const contract = new Contract(CONTRACT_ID);

// Simulation needs a source account but never a signature, so a throwaway
// keypair is enough. Nothing is ever submitted to the network.
const simulationSource = Keypair.random().publicKey();

// ============================================================================
// Contract reads
// ============================================================================

interface ContractHealth {
  is_paused: boolean;
  active_streams: bigint;
  total_tvl: Map<string, bigint>;
  last_activity_time: bigint;
  version: number;
}

interface ContractMetrics {
  streams_created_24h: bigint;
  withdrawals_24h: bigint;
  avg_stream_duration: bigint;
  avg_stream_amount: bigint;
  unique_users_24h: bigint;
}

/** Simulate a read-only contract call and decode the result. */
async function simulate<T>(method: string): Promise<T> {
  const account = await server.getAccount(simulationSource).catch(() => ({
    accountId: () => simulationSource,
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  }));

  const tx = new TransactionBuilder(account as never, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`${method} simulation failed: ${sim.error}`);
  }
  if (!sim.result?.retval) {
    throw new Error(`${method} returned no value`);
  }
  return scValToNative(sim.result.retval) as T;
}

// ============================================================================
// Prometheus formatting
// ============================================================================

type Labels = Record<string, string>;

function renderLabels(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const pairs = Object.entries(labels)
    .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${pairs}}`;
}

class MetricWriter {
  private lines: string[] = [];

  add(
    name: string,
    help: string,
    type: "gauge" | "counter",
    value: number | bigint,
    labels?: Labels
  ): void {
    this.lines.push(`# HELP ${name} ${help}`);
    this.lines.push(`# TYPE ${name} ${type}`);
    this.lines.push(`${name}${renderLabels(labels)} ${value}`);
  }

  addSeries(
    name: string,
    help: string,
    type: "gauge" | "counter",
    series: Array<{ value: number | bigint; labels: Labels }>
  ): void {
    this.lines.push(`# HELP ${name} ${help}`);
    this.lines.push(`# TYPE ${name} ${type}`);
    for (const { value, labels } of series) {
      this.lines.push(`${name}${renderLabels(labels)} ${value}`);
    }
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

function render(health: ContractHealth, metrics: ContractMetrics): string {
  const w = new MetricWriter();
  const contractLabel = { contract: CONTRACT_ID };

  // --- health -------------------------------------------------------------
  w.add(
    "stellarstream_up",
    "1 when the contract responded to a health check",
    "gauge",
    1,
    contractLabel
  );
  w.add(
    "stellarstream_paused",
    "1 when the contract is globally paused",
    "gauge",
    health.is_paused ? 1 : 0,
    contractLabel
  );
  w.add(
    "stellarstream_active_streams",
    "Streams that have not been closed",
    "gauge",
    health.active_streams,
    contractLabel
  );
  w.add(
    "stellarstream_last_activity_timestamp_seconds",
    "Ledger timestamp of the last state-changing operation",
    "gauge",
    health.last_activity_time,
    contractLabel
  );
  w.add(
    "stellarstream_contract_version",
    "Contract version reported by health_check",
    "gauge",
    health.version,
    contractLabel
  );

  // TVL is per token, so it becomes one series with a token label.
  const tvl = health.total_tvl instanceof Map
    ? Array.from(health.total_tvl.entries())
    : Object.entries(health.total_tvl ?? {});
  w.addSeries(
    "stellarstream_tvl",
    "Value still owed to receivers, per token",
    "gauge",
    tvl.map(([token, amount]) => ({
      value: amount as bigint,
      labels: { ...contractLabel, token: String(token) },
    }))
  );

  // --- usage --------------------------------------------------------------
  w.add(
    "stellarstream_streams_created_24h",
    "Streams created in the last 24 hours",
    "gauge",
    metrics.streams_created_24h,
    contractLabel
  );
  w.add(
    "stellarstream_withdrawals_24h",
    "Withdrawals executed in the last 24 hours",
    "gauge",
    metrics.withdrawals_24h,
    contractLabel
  );
  w.add(
    "stellarstream_avg_stream_duration_seconds",
    "Mean duration of streams created in the last 24 hours",
    "gauge",
    metrics.avg_stream_duration,
    contractLabel
  );
  w.add(
    "stellarstream_avg_stream_amount",
    "Mean size of streams created in the last 24 hours",
    "gauge",
    metrics.avg_stream_amount,
    contractLabel
  );
  w.add(
    "stellarstream_unique_users_24h",
    "Distinct addresses active in the last 24 hours (saturates at the contract cap)",
    "gauge",
    metrics.unique_users_24h,
    contractLabel
  );

  return w.toString();
}

/** Emitted instead of metrics when the contract cannot be reached. */
function renderDown(): string {
  const w = new MetricWriter();
  w.add(
    "stellarstream_up",
    "1 when the contract responded to a health check",
    "gauge",
    0,
    { contract: CONTRACT_ID }
  );
  return w.toString();
}

// ============================================================================
// Server
// ============================================================================

const app = express();

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", "text/plain; version=0.0.4");
  try {
    const [health, metrics] = await Promise.all([
      simulate<ContractHealth>("health_check"),
      simulate<ContractMetrics>("get_metrics"),
    ]);
    res.send(render(health, metrics));
  } catch (error) {
    // Report the contract as down rather than failing the scrape, so
    // `stellarstream_up == 0` can drive the alert.
    console.error("scrape failed:", error);
    res.send(renderDown());
  }
});

/** Liveness probe for the exporter itself. */
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, contract: CONTRACT_ID, rpc: RPC_URL });
});

app.listen(PORT, () => {
  console.log(`StellarStream exporter on :${PORT}/metrics`);
  console.log(`  contract ${CONTRACT_ID}`);
  console.log(`  rpc      ${RPC_URL}`);
});
