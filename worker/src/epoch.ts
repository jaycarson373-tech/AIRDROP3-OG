import { claimFees } from "./claim.js";
import { buyReward } from "./buy.js";
import {
  airdropRewards,
  applyGoldenAirdrop,
  computeAllocations,
  computeGoldenRewardPool,
  treasuryRewardBalanceRaw
} from "./airdrop.js";
import { completeEpoch, failEpoch, getEpoch, persistSnapshot, recordBuy, startEpoch } from "./db.js";
import { currentEpochId } from "./time.js";
import { snapshotEligibleHolders } from "./snapshot.js";

let running = false;

export async function runEpoch(date = new Date()) {
  if (running) {
    console.log("[SKIP] previous epoch still running");
    return;
  }

  running = true;
  const epochId = currentEpochId(date);

  try {
    const existing = await getEpoch(epochId);
    if (existing?.status === "completed") {
      console.log(`[${epochId}] already completed, skipping`);
      return;
    }

    await startEpoch(epochId);
    await claimFees(epochId);

    const buy = await buyReward(epochId);
    await recordBuy(
      epochId,
      buy.baseSpentLamports.toString(),
      buy.rewardReceivedRaw.toString(),
      buy.rewardReceivedUi.toString(),
      buy.txSig
    );

    const holders = await snapshotEligibleHolders();
    await persistSnapshot(
      epochId,
      holders.map((holder) => ({
        wallet: holder.wallet,
        source_balance: holder.uiBalance.toString(),
        source_balance_raw: holder.rawBalance.toString(),
        holder_pct: holder.holderPct.toString()
      }))
    );
    console.log(`[${epochId}] snapshot eligible holders: ${holders.length}`);

    const rewardBalance = await treasuryRewardBalanceRaw();
    const availableRewardRaw =
      buy.txSig && buy.rewardReceivedRaw > 0n && buy.rewardReceivedRaw < rewardBalance ? buy.rewardReceivedRaw : rewardBalance;
    const goldenPool = computeGoldenRewardPool(epochId, holders, availableRewardRaw);
    const allocations = await computeAllocations(holders, goldenPool.rewardPoolRaw);
    if (!allocations.length) {
      await completeEpoch(epochId, {
        eligible_count: holders.length,
        reward_bought: buy.rewardReceivedUi.toString(),
        reward_distributed: "0",
        status: "skipped"
      });
      console.log(`[${epochId}] no reward balance or eligible holders, skipped airdrop`);
      return;
    }

    const golden = await applyGoldenAirdrop(epochId, holders, allocations, availableRewardRaw, goldenPool.snapshotHash);
    await airdropRewards(epochId, allocations);
    const distributed = allocations.reduce((sum, allocation) => sum + allocation.uiAmount, 0);
    await completeEpoch(epochId, {
      eligible_count: allocations.length,
      reward_bought: buy.rewardReceivedUi.toString(),
      reward_distributed: distributed.toString(),
      golden_winner_wallet: golden.wallet,
      golden_base_reward: golden.baseRewardUi.toString(),
      golden_base_reward_raw: golden.baseRewardRaw.toString(),
      golden_bonus_reward: golden.bonusRewardUi.toString(),
      golden_bonus_reward_raw: golden.bonusRewardRaw.toString(),
      golden_multiplier: golden.multiplier,
      golden_capped: golden.capped,
      golden_snapshot_hash: golden.snapshotHash
    });
    console.log(
      `[${epochId}] summary: eligible=${holders.length}, recipients=${allocations.length}, bought=${buy.rewardReceivedUi}, distributed=${distributed}, golden=${golden.wallet ?? "none"}`
    );
  } catch (error) {
    await failEpoch(epochId, error).catch((dbError) => {
      console.error(`[${epochId}] failed to mark epoch failed`, dbError);
    });
    console.error(`[${epochId}] epoch failed`, error);
  } finally {
    running = false;
  }
}
