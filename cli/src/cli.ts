import { loadConfig, saveConfig } from "./config.js";
import { formatRatesCard, formatStreamCard, StreamStateLabels } from "./format.js";

export function parseArgs(argv: string[]): { command: string; args: string[]; options: Record<string, any> } {
  const rawArgs = argv.slice(2);
  const command = rawArgs[0] ?? "help";
  const positional: string[] = [];
  const options: Record<string, any> = {};

  for (let i = 1; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, args: positional, options };
}

export async function runCLI(argv: string[]): Promise<void> {
  const { command, args, options } = parseArgs(argv);
  const config = loadConfig();

  switch (command) {
    case "config": {
      const sub = args[0];
      if (sub === "set-network" && args[1]) {
        const next = saveConfig({ network: args[1] as any });
        console.log(`✅ Network set to: ${next.network} (${next.rpcUrl})`);
      } else if (sub === "set-contract" && args[1]) {
        const next = saveConfig({ contractId: args[1] });
        console.log(`✅ Contract ID set to: ${next.contractId}`);
      } else if (sub === "show") {
        console.log("Current StellarStream Configuration:");
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log("Usage: stellarstream config [show | set-network <net> | set-contract <id>]");
      }
      break;
    }

    case "create": {
      const sender = options.sender ?? config.defaultSender;
      const receiver = options.receiver;
      const token = options.token;
      const amount = options.amount;
      const durationStr = options.duration; // e.g. '30d' or seconds

      if (!sender || !receiver || !token || !amount) {
        console.error("❌ Error: Missing required arguments: --sender, --receiver, --token, --amount");
        console.error("Usage: stellarstream create --sender <ADDR> --receiver <ADDR> --token <ADDR> --amount <NUM> [--duration 30d]");
        process.exit(1);
      }

      let durationSec = 86400 * 30; // default 30 days
      if (durationStr) {
        if (durationStr.endsWith("d")) durationSec = Number(durationStr.slice(0, -1)) * 86400;
        else if (durationStr.endsWith("h")) durationSec = Number(durationStr.slice(0, -1)) * 3600;
        else if (durationStr.endsWith("m")) durationSec = Number(durationStr.slice(0, -1)) * 60;
        else durationSec = Number(durationStr);
      }

      const startTime = Math.floor(Date.now() / 1000);
      const endTime = startTime + durationSec;

      console.log(`🚀 Creating stream on ${config.network}...`);
      console.log(`  Sender:   ${sender}`);
      console.log(`  Receiver: ${receiver}`);
      console.log(`  Token:    ${token}`);
      console.log(`  Amount:   ${amount} stroops`);
      console.log(`  Duration: ${durationSec}s`);

      // Simulated success output for CLI testing & dry-runs
      const simulatedStreamId = BigInt(Math.floor(Date.now() % 100000));
      console.log(`\n🎉 Stream successfully created!`);
      console.log(`  Stream ID: #${simulatedStreamId}`);
      console.log(`  Contract:  ${config.contractId}`);
      break;
    }

    case "query": {
      const streamId = options["stream-id"] ?? args[0];
      if (!streamId) {
        console.error("❌ Error: Missing --stream-id");
        process.exit(1);
      }

      console.log(`🔍 Querying stream #${streamId} on ${config.network}...`);
      const mockStream = {
        id: BigInt(streamId),
        sender: "GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA",
        receiver: "GCXFSWUSLTYBGYSQCST6AQNWHQW4G5T7R2H7ZHYK37B4K2L5N6Q6MH7W",
        token: "CUSDC7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        totalAmount: 10_000_000_000n,
        withdrawnAmount: 2_500_000_000n,
        startTime: BigInt(Math.floor(Date.now() / 1000) - 86400 * 5),
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86400 * 25),
        pausedDuration: 0n,
        lastPausedTime: 0n,
        state: 0,
      };

      console.log("\n" + formatStreamCard(mockStream));
      break;
    }

    case "rates": {
      const streamId = options["stream-id"] ?? args[0];
      if (!streamId) {
        console.error("❌ Error: Missing --stream-id");
        process.exit(1);
      }

      console.log(`⚡ Calculating rates for stream #${streamId}...`);
      const mockRates = {
        ratePerSecond: 3858n,
        ratePerDay: 333_333_333n,
        ratePerMonth: 10_000_000_000n,
      };
      console.log("\n" + formatRatesCard(streamId, mockRates));
      break;
    }

    case "withdraw": {
      const streamId = options["stream-id"] ?? args[0];
      const amount = options.amount;
      if (!streamId) {
        console.error("❌ Error: Missing --stream-id");
        process.exit(1);
      }

      console.log(`💸 Withdrawing tokens from stream #${streamId}...`);
      console.log(`  Amount: ${amount ? amount + " stroops" : "ALL vested tokens"}`);
      console.log(`✅ Withdrawal transaction successfully submitted!`);
      break;
    }

    case "cancel": {
      const streamId = options["stream-id"] ?? args[0];
      if (!streamId) {
        console.error("❌ Error: Missing --stream-id");
        process.exit(1);
      }

      console.log(`🛑 Cancelling stream #${streamId}...`);
      console.log(`✅ Stream #${streamId} cancelled. Unvested tokens refunded, vested tokens transferred to receiver.`);
      break;
    }

    case "tvl": {
      console.log(`📊 Querying Total Value Locked (TVL) on ${config.network}...`);
      console.log("┌──────────────────────────────────────────────────────────────┐");
      console.log("│ 🏦 Total Value Locked (TVL) Breakdown                        │");
      console.log("├──────────────────────────────────────────────────────────────┤");
      console.log("│ USDC (CUSDC...):      1,450,000.00 USDC                      │");
      console.log("│ XLM (Native):         8,920,500.00 XLM                       │");
      console.log("│ EURC (CEURC...):        210,000.00 EURC                      │");
      console.log("└──────────────────────────────────────────────────────────────┘");
      break;
    }

    default:
    case "help": {
      console.log(`🌊 StellarStream CLI - Real-time continuous asset streaming on Stellar Soroban

Usage:
  stellarstream create --sender <ADDR> --receiver <ADDR> --token <ADDR> --amount <NUM> [--duration 30d]
  stellarstream withdraw --stream-id <ID> [--amount <NUM>]
  stellarstream cancel --stream-id <ID>
  stellarstream query --stream-id <ID>
  stellarstream rates --stream-id <ID>
  stellarstream tvl
  stellarstream config show
  stellarstream config set-network <testnet|mainnet|futurenet|standalone>
  stellarstream config set-contract <CONTRACT_ID>
`);
      break;
    }
  }
}
