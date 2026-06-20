import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Configuration Schema for the StellarStream Backend/Watcher.
 * Uses Zod for runtime validation and type inference.
 */
const envSchema = z.object({
  /**
   * The URL of the Stellar/Soroban RPC endpoint.
   * @example "https://soroban-testnet.stellar.org"
   */
  STELLAR_RPC_URL: z.string().url({ message: "STELLAR_RPC_URL must be a valid URL." }),

  /**
   * The network passphrase for the target Stellar network.
   * Defaults to Testnet if not provided.
   */
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default("Test SDF Network ; September 2015"),

  /**
   * The ID of the StellarStream smart contract (C...).
   * Must be a 56-character string starting with 'C'.
   */
  CONTRACT_ID: z
    .string()
    .length(56, "CONTRACT_ID must be exactly 56 characters.")
    .startsWith("C", "CONTRACT_ID must start with 'C'."),

  /**
   * Frequency of polling the RPC for new events in milliseconds.
   * @default 5000
   */
  POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),

  /**
   * Maximum number of retry attempts for transient RPC failures.
   * @default 3
   */
  MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .default(3),

  /**
   * Initial delay for exponential backoff in milliseconds.
   * @default 2000
   */
  RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(2000),

  /**
   * Number of ledgers to stay behind the tip for safety against reorgs.
   * @default 10
   */
  SAFETY_MARGIN: z.coerce
    .number()
    .int()
    .min(0)
    .default(10),
});

/**
 * Validated configuration object. 
 * All services should import this object rather than accessing process.env directly.
 */
export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;