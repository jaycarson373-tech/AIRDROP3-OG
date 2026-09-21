import { createHash } from "crypto";
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint
} from "@solana/spl-token";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";
import { dryRunPayout, failPayout, planPayout, recordGoldenPayoutTx, settlePayout } from "./db.js";
import type { Holder } from "./snapshot.js";

export const GOLDEN_MULTIPLIER = 10;

export type Allocation = {
  wallet: string;
  amount: bigint;
  uiAmount: number;
  normalAmount: bigint;
  normalUiAmount: number;
  goldenBonusAmount: bigint;
  goldenBonusUiAmount: number;
  goldenMultiplier: number;
  isGolden: boolean;
  goldenCapped: boolean;
};

export type GoldenSummary = {
  wallet: string | null;
  baseRewardRaw: bigint;
  baseRewardUi: number;
  bonusRewardRaw: bigint;
  bonusRewardUi: number;
  multiplier: number;
  capped: boolean;
  snapshotHash: string | null;
};

export type GoldenRewardPool = {
  rewardPoolRaw: bigint;
  snapshotHash: string | null;
};

type PreparedAllocation = Allocation & {
  owner: PublicKey;
  destinationAta: PublicKey;
};

async function tokenProgramForMint() {
  const info = await connection.getAccountInfo(config.rewardTokenMint);
  if (!info) throw new Error(`Reward mint not found: ${config.rewardTokenMint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported reward token program: ${info.owner.toBase58()}`);
}

function rawToUi(raw: bigint, decimals: number) {
  return Number(raw) / 10 ** decimals;
}

function minBigInt(a: bigint, b: bigint) {
  return a < b ? a : b;
}

export async function treasuryRewardBalanceRaw() {
  const treasury = treasuryKeypair();
  const tokenProgram = await tokenProgramForMint();
  const ata = getAssociatedTokenAddressSync(config.rewardTokenMint, treasury.publicKey, false, tokenProgram);
  try {
    const balance = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

export async function computeAllocations(holders: Holder[], rewardRaw: bigint): Promise<Allocation[]> {
  if (!holders.length || rewardRaw <= config.minRewardRawToAirdrop) return [];
  const tokenProgram = await tokenProgramForMint();
  const mintInfo = await getMint(connection, config.rewardTokenMint, "confirmed", tokenProgram);
  const totalWeight = holders.reduce((sum, holder) => sum + holder.rawBalance, 0n);

  return holders
    .map((holder) => {
      const amount = (rewardRaw * holder.rawBalance) / totalWeight;
      return {
        wallet: holder.wallet,
        amount,
        uiAmount: rawToUi(amount, mintInfo.decimals),
        normalAmount: amount,
        normalUiAmount: rawToUi(amount, mintInfo.decimals),
        goldenBonusAmount: 0n,
        goldenBonusUiAmount: 0,
        goldenMultiplier: 1,
        isGolden: false,
        goldenCapped: false
      };
    })
    .filter((allocation) => allocation.amount > 0n);
}

function snapshotHash(holders: Holder[]) {
  const canonical = holders.map((holder) => `${holder.wallet}:${holder.rawBalance.toString()}`).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

function deterministicIndex(epochId: string, hash: string, count: number) {
  const seed = createHash("sha256").update(`${epochId}:${hash}`).digest();
  return Number(seed.readBigUInt64BE(0) % BigInt(count));
}

export function computeGoldenRewardPool(epochId: string, holders: Holder[], availableRewardRaw: bigint): GoldenRewardPool {
  if (!holders.length || availableRewardRaw <= 0n) {
    return { rewardPoolRaw: availableRewardRaw, snapshotHash: holders.length ? snapshotHash(holders) : null };
  }

  const hash = snapshotHash(holders);
  const winnerIndex = deterministicIndex(epochId, hash, holders.length);
  const winner = holders[winnerIndex];
  const totalWeight = holders.reduce((sum, holder) => sum + holder.rawBalance, 0n);
  if (totalWeight <= 0n) return { rewardPoolRaw: 0n, snapshotHash: hash };

  const denominator = totalWeight + winner.rawBalance * BigInt(GOLDEN_MULTIPLIER - 1);
  const rewardPoolRaw = (availableRewardRaw * totalWeight) / denominator;
  return { rewardPoolRaw, snapshotHash: hash };
}

export async function applyGoldenAirdrop(
  epochId: string,
  holders: Holder[],
  allocations: Allocation[],
  availableRewardRaw: bigint,
  precomputedSnapshotHash?: string | null
): Promise<GoldenSummary> {
  const tokenProgram = await tokenProgramForMint();
  const mintInfo = await getMint(connection, config.rewardTokenMint, "confirmed", tokenProgram);
  const hash = precomputedSnapshotHash ?? snapshotHash(holders);

  if (!allocations.length) {
    return {
      wallet: null,
      baseRewardRaw: 0n,
      baseRewardUi: 0,
      bonusRewardRaw: 0n,
      bonusRewardUi: 0,
      multiplier: GOLDEN_MULTIPLIER,
      capped: false,
      snapshotHash: hash
    };
  }

  const winnerIndex = deterministicIndex(epochId, hash, allocations.length);
  const winner = allocations[winnerIndex];
  const normalTotalRaw = allocations.reduce((sum, allocation) => sum + allocation.amount, 0n);
  const availableBonusRaw = availableRewardRaw > normalTotalRaw ? availableRewardRaw - normalTotalRaw : 0n;
  const targetBonusRaw = winner.normalAmount * BigInt(GOLDEN_MULTIPLIER - 1);
  const bonusRaw = minBigInt(targetBonusRaw, availableBonusRaw);
  const capped = bonusRaw < targetBonusRaw;

  winner.amount += bonusRaw;
  winner.uiAmount = rawToUi(winner.amount, mintInfo.decimals);
  winner.goldenBonusAmount = bonusRaw;
  winner.goldenBonusUiAmount = rawToUi(bonusRaw, mintInfo.decimals);
  winner.goldenMultiplier = GOLDEN_MULTIPLIER;
  winner.isGolden = true;
  winner.goldenCapped = capped;

  console.log(
    `[${epochId}] golden winner ${winner.wallet}: base=${winner.normalAmount.toString()} raw, bonus=${bonusRaw.toString()} raw, multiplier=${GOLDEN_MULTIPLIER}x${capped ? " capped" : ""}`
  );

  return {
    wallet: winner.wallet,
    baseRewardRaw: winner.normalAmount,
    baseRewardUi: winner.normalUiAmount,
    bonusRewardRaw: bonusRaw,
    bonusRewardUi: winner.goldenBonusUiAmount,
    multiplier: GOLDEN_MULTIPLIER,
    capped,
    snapshotHash: hash
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function missingAtaRentLamports(atas: PublicKey[]) {
  const accounts = await connection.getMultipleAccountsInfo(atas, "confirmed");
  const missingCount = accounts.filter((account) => account === null).length;
  const rent = await connection.getMinimumBalanceForRentExemption(165);
  return BigInt(missingCount * rent);
}

export async function airdropRewards(epochId: string, allocations: Allocation[]) {
  const treasury = treasuryKeypair();
  const tokenProgram = await tokenProgramForMint();
  const mintInfo = await getMint(connection, config.rewardTokenMint, "confirmed", tokenProgram);
  const sourceAta = getAssociatedTokenAddressSync(config.rewardTokenMint, treasury.publicKey, false, tokenProgram);

  console.log(`[${epochId}] proof before send: ${allocations.length} payouts`);
  for (const allocation of allocations) {
    console.log(
      `[${epochId}] ${config.airdropEnabled ? "" : "[DRY-RUN] "}would send ${allocation.amount.toString()} raw reward tokens to ${allocation.wallet}`
    );
  }

  if (!config.airdropEnabled) {
    for (const allocation of allocations) {
      await dryRunPayout(epochId, allocation.wallet, allocation.amount.toString(), allocation.uiAmount.toString(), {
        normalRewardAmountRaw: allocation.normalAmount.toString(),
        normalRewardAmount: allocation.normalUiAmount.toString(),
        goldenBonusRewardRaw: allocation.goldenBonusAmount.toString(),
        goldenBonusReward: allocation.goldenBonusUiAmount.toString(),
        goldenMultiplier: allocation.goldenMultiplier,
        isGolden: allocation.isGolden,
        goldenCapped: allocation.goldenCapped
      });
    }
    return [];
  }

  const prepared: PreparedAllocation[] = allocations.map((allocation) => {
    const owner = new PublicKey(allocation.wallet);
    return {
      ...allocation,
      owner,
      destinationAta: getAssociatedTokenAddressSync(
        config.rewardTokenMint,
        owner,
        true,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    };
  });

  const signatures: string[] = [];
  const batches = chunk(prepared, config.airdropBatchSize);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const reserveLamports = BigInt(Math.floor(config.airdropSolReserve * LAMPORTS_PER_SOL));
    const estimatedRentLamports = await missingAtaRentLamports(batch.map((allocation) => allocation.destinationAta));
    const estimatedFeeLamports = 25_000n;
    const requiredLamports = reserveLamports + estimatedRentLamports + estimatedFeeLamports;
    const balanceLamports = BigInt(await connection.getBalance(treasury.publicKey, "confirmed"));

    if (balanceLamports < requiredLamports) {
      const error = new Error(
        `Treasury SOL below airdrop reserve: balance=${balanceLamports}, required=${requiredLamports}, reserve=${reserveLamports}, estimatedAtaRent=${estimatedRentLamports}`
      );
      console.error(`[${epochId}] stopping airdrop batch: ${error.message}`);
      const remaining = batches.slice(batchIndex).flat();
      for (const allocation of remaining) {
        await failPayout(epochId, allocation.wallet, error);
      }
      break;
    }

    for (const allocation of batch) {
      await planPayout(epochId, allocation.wallet, allocation.amount.toString(), allocation.uiAmount.toString(), {
        normalRewardAmountRaw: allocation.normalAmount.toString(),
        normalRewardAmount: allocation.normalUiAmount.toString(),
        goldenBonusRewardRaw: allocation.goldenBonusAmount.toString(),
        goldenBonusReward: allocation.goldenBonusUiAmount.toString(),
        goldenMultiplier: allocation.goldenMultiplier,
        isGolden: allocation.isGolden,
        goldenCapped: allocation.goldenCapped
      });
    }

    try {
      const tx = new Transaction();
      for (const allocation of batch) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            treasury.publicKey,
            allocation.destinationAta,
            allocation.owner,
            config.rewardTokenMint,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          createTransferCheckedInstruction(
            sourceAta,
            config.rewardTokenMint,
            allocation.destinationAta,
            treasury.publicKey,
            allocation.amount,
            mintInfo.decimals,
            [],
            tokenProgram
          )
        );
      }

      tx.feePayer = treasury.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(treasury);

      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        throw new Error(`Transfer simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
      await connection.confirmTransaction(txSig, "confirmed");
      for (const allocation of batch) {
        await settlePayout(epochId, allocation.wallet, txSig);
        if (allocation.isGolden) {
          await recordGoldenPayoutTx(epochId, txSig);
        }
        console.log(`[${epochId}] settled ${allocation.wallet}: ${txSig}`);
      }
      signatures.push(txSig);
    } catch (error) {
      for (const allocation of batch) {
        await failPayout(epochId, allocation.wallet, error);
        console.error(`[${epochId}] payout failed for ${allocation.wallet}:`, error);
      }
    }
  }

  return signatures;
}
