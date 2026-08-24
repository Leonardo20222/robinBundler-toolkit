import "dotenv/config";
import { z } from "zod";
import type { NetworkName } from "./chain/networks.js";

const envSchema = z.object({
  BUNDLER_NETWORK: z.enum(["mainnet", "testnet"]).default("testnet"),
  BUNDLER_MODE: z.enum(["simulation", "live"]).default("simulation"),
  RPC_URL: z.string().optional().default(""),
  RPC_URL_SECONDARY: z.string().optional().default(""),
  WS_URL: z.string().optional().default(""),
  ALCHEMY_API_KEY: z.string().optional().default(""),
  WALLET_PASSPHRASE: z.string().min(8).default("change-me-to-a-strong-passphrase"),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_GAS_ETH: z.coerce.number().positive().default(0.002),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(100),
  DATA_DIR: z.string().default("./data"),
  USE_SEQUENCER: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  SEQUENCER_URL: z.string().optional().default(""),
});

export type AppConfig = {
  network: NetworkName;
  mode: "simulation" | "live";
  rpcUrl: string;
  rpcUrlSecondary: string;
  wsUrl: string;
  alchemyApiKey: string;
  walletPassphrase: string;
  maxConcurrency: number;
  minGasEth: number;
  defaultSlippageBps: number;
  dataDir: string;
  useSequencer: boolean;
  sequencerUrl: string;
};

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = envSchema.parse(process.env);
  const base: AppConfig = {
    network: parsed.BUNDLER_NETWORK,
    mode: parsed.BUNDLER_MODE,
    rpcUrl: parsed.RPC_URL,
    rpcUrlSecondary: parsed.RPC_URL_SECONDARY,
    wsUrl: parsed.WS_URL,
    alchemyApiKey: parsed.ALCHEMY_API_KEY,
    walletPassphrase: parsed.WALLET_PASSPHRASE,
    maxConcurrency: parsed.MAX_CONCURRENCY,
    minGasEth: parsed.MIN_GAS_ETH,
    defaultSlippageBps: parsed.DEFAULT_SLIPPAGE_BPS,
    dataDir: parsed.DATA_DIR,
    useSequencer: parsed.USE_SEQUENCER,
    sequencerUrl: parsed.SEQUENCER_URL,
  };
  return { ...base, ...overrides };
}
