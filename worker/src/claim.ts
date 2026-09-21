import { VersionedTransaction } from "@solana/web3.js";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";
import { getClaim, recordClaim } from "./db.js";

export type ClaimResult = {
  txSig: string | null;
  amountClaimed: string;
};

async function safeRecordClaim(epochId: string, amountClaimed: string, txSig: string | null) {
  try {
    await recordClaim(epochId, amountClaimed, txSig);
  } catch (error) {
    console.warn(`[${epochId}] failed to record claim:`, error);
  }
}

export async function claimFees(epochId: string): Promise<ClaimResult> {
  const existing = await getClaim(epochId);
  if (existing) {
    console.log(`[${epochId}] claim already recorded, skipping`);
    return { txSig: existing.tx_sig ?? null, amountClaimed: String(existing.amount_claimed ?? "0") };
  }

  const treasury = treasuryKeypair();

  if (!config.claimEnabled) {
    console.log(`[${epochId}] [DRY-RUN] would claim creator fees`);
    await safeRecordClaim(epochId, "0", null);
    return { txSig: null, amountClaimed: "0" };
  }

  try {
    const response = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: treasury.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: config.priorityFeeSol
      })
    });

    if (!response.ok) {
      console.warn(`[${epochId}] creator-fee claim returned ${response.status}: ${await response.text()}`);
      await safeRecordClaim(epochId, "0", null);
      return { txSig: null, amountClaimed: "0" };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) {
      console.log(`[${epochId}] no creator fees to claim`);
      await safeRecordClaim(epochId, "0", null);
      return { txSig: null, amountClaimed: "0" };
    }

    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([treasury]);
    const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
    await connection.confirmTransaction(txSig, "confirmed");
    await safeRecordClaim(epochId, "0", txSig);
    console.log(`[${epochId}] claimed creator fees: ${txSig}`);
    return { txSig, amountClaimed: "0" };
  } catch (error) {
    console.warn(`[${epochId}] creator-fee claim skipped:`, error);
    await safeRecordClaim(epochId, "0", null);
    return { txSig: null, amountClaimed: "0" };
  }
}
