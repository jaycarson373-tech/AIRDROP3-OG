import "dotenv/config";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function boolEnv(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberEnv(name: string, defaultValue: number) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number env ${name}=${value}`);
  return parsed;
}

function intEnv(name: string, defaultValue: number) {
  return Math.floor(numberEnv(name, defaultValue));
}

function publicKeyEnv(name: string) {
  return new PublicKey(required(name));
}

function optionalWallets(name: string) {
  const value = process.env[name];
  if (!value) return [];
  return value
    .split(",")
    .map((wallet) => wallet.trim())
    .filter(Boolean)
    .map((wallet) => new PublicKey(wallet));
}

function parseSecret(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return bs58.decode(trimmed);
}

let cachedTreasury: Keypair | null = null;

export const config = {
  heliusRpcUrl: required("HELIUS_RPC_URL"),
  sourceTokenMint: publicKeyEnv("SOURCE_TOKEN_MINT"),
  rewardTokenMint: publicKeyEnv("REWARD_TOKEN_MINT"),
  treasuryWalletSecret: required("TREASURY_WALLET_SECRET"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRole: required("SUPABASE_SERVICE_ROLE"),

  claimEnabled: boolEnv("CLAIM_ENABLED", false),
  buyEnabled: boolEnv("BUY_ENABLED", false),
  airdropEnabled: boolEnv("AIRDROP_ENABLED", false),

  epochMinutes: Math.max(1, intEnv("EPOCH_MINUTES", 5)),
  eligibilityMin: numberEnv("ELIGIBILITY_MIN", 1_000_000),
  maxWalletsPerEpoch: Math.max(1, intEnv("MAX_WALLETS_PER_EPOCH", 50)),
  maxHolderPct: numberEnv("MAX_HOLDER_PCT", 5),
  excludeWallets: optionalWallets("EXCLUDE_WALLETS"),

  swapBalanceBps: Math.min(10_000, Math.max(1, intEnv("SWAP_BALANCE_BPS", 9000))),
  minSolReserve: numberEnv("MIN_SOL_RESERVE", 0.125),
  airdropSolReserve: numberEnv("AIRDROP_SOL_RESERVE", 0.125),
  airdropBatchSize: Math.max(1, intEnv("AIRDROP_BATCH_SIZE", 4)),
  swapSlippageBps: Math.max(1, intEnv("SWAP_SLIPPAGE_BPS", 300)),
  priorityFeeSol: numberEnv("PRIORITY_FEE_SOL", 0.000001),
  minRewardRawToAirdrop: BigInt(Math.max(0, intEnv("MIN_REWARD_RAW_TO_AIRDROP", 1)))
};

export function treasuryKeypair() {
  cachedTreasury ??= Keypair.fromSecretKey(parseSecret(config.treasuryWalletSecret));
  return cachedTreasury;
}
