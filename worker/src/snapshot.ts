import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";

const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_AMM_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

export type Holder = {
  wallet: string;
  rawBalance: bigint;
  uiBalance: number;
  holderPct: number;
};

async function tokenProgramForMint(mint: PublicKey) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported token program: ${info.owner.toBase58()}`);
}

function addExcluded(excluded: Set<string>, value: PublicKey | null | undefined) {
  if (value) excluded.add(value.toBase58());
}

function pumpPda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, PUMP_PROGRAM_ID)[0];
}

function pumpAmmPda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, PUMP_AMM_PROGRAM_ID)[0];
}

function bondingCurvePda(mint: PublicKey) {
  return pumpPda([Buffer.from("bonding-curve"), mint.toBuffer()]);
}

function bondingCurveV2Pda(mint: PublicKey) {
  return pumpPda([Buffer.from("bonding-curve-v2"), mint.toBuffer()]);
}

function canonicalPoolPda(mint: PublicKey) {
  const index = Buffer.alloc(2);
  index.writeUInt16LE(0);
  const poolAuthority = pumpPda([Buffer.from("pool-authority"), mint.toBuffer()]);
  return pumpAmmPda([Buffer.from("pool"), index, poolAuthority.toBuffer(), mint.toBuffer(), NATIVE_MINT.toBuffer()]);
}

function excludedWallets(mintAuthority: PublicKey | null) {
  const excluded = new Set<string>();
  addExcluded(excluded, treasuryKeypair().publicKey);
  addExcluded(excluded, mintAuthority);
  addExcluded(excluded, bondingCurvePda(config.sourceTokenMint));
  addExcluded(excluded, bondingCurveV2Pda(config.sourceTokenMint));
  addExcluded(excluded, canonicalPoolPda(config.sourceTokenMint));
  for (const wallet of config.excludeWallets) addExcluded(excluded, wallet);
  return excluded;
}

function holderPct(rawBalance: bigint, rawSupply: bigint) {
  if (rawSupply <= 0n) return 0;
  return Number((rawBalance * 1_000_000n) / rawSupply) / 10_000;
}

export async function snapshotEligibleHolders(): Promise<Holder[]> {
  const tokenProgram = await tokenProgramForMint(config.sourceTokenMint);
  const mintInfo = await getMint(connection, config.sourceTokenMint, "confirmed", tokenProgram);
  const supply = await connection.getTokenSupply(config.sourceTokenMint, "confirmed");
  const rawSupply = BigInt(supply.value.amount);
  if (rawSupply <= 0n) throw new Error(`Source token supply is zero: ${config.sourceTokenMint.toBase58()}`);

  const filters = tokenProgram.equals(TOKEN_PROGRAM_ID)
    ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: config.sourceTokenMint.toBase58() } }]
    : [{ memcmp: { offset: 0, bytes: config.sourceTokenMint.toBase58() } }];
  const accounts = await connection.getParsedProgramAccounts(tokenProgram, { filters });
  console.log(`holder query returned ${accounts.length} token accounts for mint ${config.sourceTokenMint.toBase58()}`);
  console.log(`mint decimals: ${supply.value.decimals}`);

  const balances = new Map<string, bigint>();
  for (const account of accounts) {
    const parsed = (account.account.data as any).parsed?.info;
    if (!parsed?.owner || !parsed?.tokenAmount?.amount) continue;
    const owner = new PublicKey(parsed.owner);
    if (!PublicKey.isOnCurve(owner.toBytes())) continue;
    const amount = BigInt(parsed.tokenAmount.amount);
    balances.set(parsed.owner, (balances.get(parsed.owner) ?? 0n) + amount);
  }

  const decimals = supply.value.decimals;
  const aggregated = [...balances.entries()].map(([wallet, rawBalance]) => ({
    wallet,
    rawBalance,
    uiBalance: Number(rawBalance) / 10 ** decimals,
    holderPct: holderPct(rawBalance, rawSupply)
  }));

  const eligibleByBalance = aggregated.filter((holder) => holder.uiBalance >= config.eligibilityMin);
  console.log(`${eligibleByBalance.length} wallets >= ${config.eligibilityMin} source tokens`);

  if (accounts.length > 0 && eligibleByBalance.length === 0) {
    const topBalances = [...aggregated]
      .sort((a, b) => b.uiBalance - a.uiBalance)
      .slice(0, 3)
      .map((holder) => `${holder.wallet}=${holder.uiBalance}`);
    console.log(`top 3 balances seen: ${topBalances.join(", ")}`);
  }

  const excluded = excludedWallets(mintInfo.mintAuthority);
  const holders = eligibleByBalance
    .filter((holder) => !excluded.has(holder.wallet))
    .filter((holder) => {
      const isWhale = holder.holderPct > config.maxHolderPct;
      if (isWhale) {
        console.log(`[SNAPSHOT] excluded whale ${holder.wallet}: ${holder.holderPct}%`);
      }
      return !isWhale;
    })
    .sort((a, b) => (a.rawBalance === b.rawBalance ? 0 : a.rawBalance > b.rawBalance ? -1 : 1));

  if (holders.length > config.maxWalletsPerEpoch) {
    console.log(`[SNAPSHOT] using top ${config.maxWalletsPerEpoch} of ${holders.length} eligible holders`);
  }

  return holders.slice(0, config.maxWalletsPerEpoch);
}
