import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CLIConfig {
  network: "testnet" | "mainnet" | "futurenet" | "standalone";
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  defaultSender?: string;
}

export const NETWORK_DEFAULTS: Record<string, { rpcUrl: string; networkPassphrase: string }> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-rpc.mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
  futurenet: {
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
  },
  standalone: {
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
  },
};

export const DEFAULT_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export function getConfigDirectory(): string {
  return join(homedir(), ".stellarstream");
}

export function getConfigFilePath(): string {
  return join(getConfigDirectory(), "config.json");
}

export function loadConfig(): CLIConfig {
  const filePath = getConfigFilePath();
  if (!existsSync(filePath)) {
    return {
      network: "testnet",
      contractId: DEFAULT_CONTRACT_ID,
      rpcUrl: NETWORK_DEFAULTS.testnet.rpcUrl,
      networkPassphrase: NETWORK_DEFAULTS.testnet.networkPassphrase,
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const network = parsed.network ?? "testnet";
    const netDef = NETWORK_DEFAULTS[network] ?? NETWORK_DEFAULTS.testnet;

    return {
      network,
      contractId: parsed.contractId ?? DEFAULT_CONTRACT_ID,
      rpcUrl: parsed.rpcUrl ?? netDef.rpcUrl,
      networkPassphrase: parsed.networkPassphrase ?? netDef.networkPassphrase,
      defaultSender: parsed.defaultSender,
    };
  } catch {
    return {
      network: "testnet",
      contractId: DEFAULT_CONTRACT_ID,
      rpcUrl: NETWORK_DEFAULTS.testnet.rpcUrl,
      networkPassphrase: NETWORK_DEFAULTS.testnet.networkPassphrase,
    };
  }
}

export function saveConfig(updates: Partial<CLIConfig>): CLIConfig {
  const current = loadConfig();
  const next: CLIConfig = { ...current, ...updates };

  if (updates.network && NETWORK_DEFAULTS[updates.network]) {
    next.rpcUrl = NETWORK_DEFAULTS[updates.network].rpcUrl;
    next.networkPassphrase = NETWORK_DEFAULTS[updates.network].networkPassphrase;
  }

  const dir = getConfigDirectory();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigFilePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
