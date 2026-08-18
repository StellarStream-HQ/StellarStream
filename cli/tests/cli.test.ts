import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli.js";
import { loadConfig, NETWORK_DEFAULTS, saveConfig } from "../src/config.js";
import {
  formatAddress,
  formatDuration,
  formatRatesCard,
  formatStreamCard,
  formatTimestamp,
} from "../src/format.js";

describe("StellarStream CLI", () => {
  test("parses command-line arguments and flags", () => {
    const argv = [
      "node",
      "stellarstream",
      "create",
      "--sender",
      "GBJEI...",
      "--receiver",
      "GCXF...",
      "--token",
      "CUSDC...",
      "--amount",
      "1000",
      "--duration",
      "30d",
    ];

    const parsed = parseArgs(argv);
    expect(parsed.command).toBe("create");
    expect(parsed.options.sender).toBe("GBJEI...");
    expect(parsed.options.receiver).toBe("GCXF...");
    expect(parsed.options.token).toBe("CUSDC...");
    expect(parsed.options.amount).toBe("1000");
    expect(parsed.options.duration).toBe("30d");
  });

  test("loads and saves configuration with network defaults", () => {
    const initialConfig = loadConfig();
    expect(initialConfig.network).toBeDefined();

    const updated = saveConfig({ network: "mainnet" });
    expect(updated.network).toBe("mainnet");
    expect(updated.rpcUrl).toBe(NETWORK_DEFAULTS.mainnet.rpcUrl);
    expect(updated.networkPassphrase).toBe(NETWORK_DEFAULTS.mainnet.networkPassphrase);
  });

  test("formats duration strings correctly", () => {
    expect(formatDuration(86400 * 30)).toContain("30d");
    expect(formatDuration(3600 * 5 + 60 * 30)).toContain("5h 30m");
    expect(formatDuration(45)).toContain("45s");
  });

  test("formats address and timestamp strings", () => {
    const addr = "GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA";
    expect(formatAddress(addr, 6)).toBe("GBJEI2...MH7WVA");

    const ts = 1700000000;
    expect(formatTimestamp(ts)).toContain("2023");
  });

  test("formats visual cards for streams and rates", () => {
    const stream = {
      id: 101n,
      sender: "G_ALICE...",
      receiver: "G_BOB...",
      token: "USDC_ADDR...",
      totalAmount: 10_000_000n,
      withdrawnAmount: 2_000_000n,
      startTime: 1000n,
      endTime: 2000n,
      pausedDuration: 0n,
      lastPausedTime: 0n,
      state: 0,
    };

    const streamCard = formatStreamCard(stream);
    expect(streamCard).toContain("Stream #101");
    expect(streamCard).toContain("🟢 Active");

    const rates = {
      ratePerSecond: 100n,
      ratePerDay: 8640000n,
      ratePerMonth: 259200000n,
    };
    const ratesCard = formatRatesCard(101n, rates);
    expect(ratesCard).toContain("Streaming Rates for Stream #101");
    expect(ratesCard).toContain("100 stroops/sec");
  });
});
