import { LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { config, treasuryKeypair } from "./config.js";
import { connection } from "./solana.js";

export type BuyResult = {
  baseSpentLamports: bigint;
  rewardReceivedRaw: bigint;
  rewardReceivedUi: number;
  txSig: string | null;
};

async function tokenProgramForMint() {
  const info = await connection.getAccountInfo(config.rewardTokenMint);
  if (!info) throw new Error(`Reward mint not found: ${config.rewardTokenMint.toBase58()}`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`Unsupported reward token program: ${info.owner.toBase58()}`);
}

async function rewardDecimals() {
  const tokenProgram = await tokenProgramForMint();
  const mint = await getMint(connection, config.rewardTokenMint, "confirmed", tokenProgram);
  return mint.decimals;
}

function rawToUi(raw: bigint, decimals: number) {
  return Number(raw) / 10 ** decimals;
}

export async function treasurySwapAmount() {
  const treasury = treasuryKeypair();
  const balance = BigInt(await connection.getBalance(treasury.publicKey, "confirmed"));
  const reserveLamports = BigInt(Math.floor(config.minSolReserve * LAMPORTS_PER_SOL));
  const bpsAmount = (balance * BigInt(config.swapBalanceBps)) / 10_000n;
  const reserveAmount = balance > reserveLamports ? balance - reserveLamports : 0n;
  const amount = bpsAmount < reserveAmount ? bpsAmount : reserveAmount;

  return {
    balance,
    amount: amount > 0n ? amount : 0n,
    reserveLamports
  };
}

async function jupiterSwap(baseAmount: bigint, treasuryPublicKey: string) {
  const query = new URLSearchParams({
    inputMint: NATIVE_MINT.toBase58(),
    outputMint: config.rewardTokenMint.toBase58(),
    amount: baseAmount.toString(),
    slippageBps: String(config.swapSlippageBps),
    restrictIntermediateTokens: "true"
  });

  const quoteResponse = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${query}`);
  if (!quoteResponse.ok) throw new Error(`Jupiter quote failed: ${await quoteResponse.text()}`);
  const quote = (await quoteResponse.json()) as { outAmount: string };

  const swapResponse = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: treasuryPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false
    })
  });
  if (!swapResponse.ok) throw new Error(`Jupiter swap build failed: ${await swapResponse.text()}`);
  return { quote, swap: (await swapResponse.json()) as { swapTransaction: string } };
}

export async function buyReward(epochId: string): Promise<BuyResult> {
  const treasury = treasuryKeypair();
  const { amount, balance, reserveLamports } = await treasurySwapAmount();
  const decimals = await rewardDecimals();

  if (amount <= 0n) {
    console.log(
      `[${epochId}] insufficient treasury after reserve, skipping buy: balance=${balance}, reserve=${reserveLamports}`
    );
    return { baseSpentLamports: 0n, rewardReceivedRaw: 0n, rewardReceivedUi: 0, txSig: null };
  }

  const { quote, swap } = await jupiterSwap(amount, treasury.publicKey.toBase58());
  const rewardReceivedRaw = BigInt(quote.outAmount);
  const rewardReceivedUi = rawToUi(rewardReceivedRaw, decimals);
  console.log(
    `[${epochId}] ${config.buyEnabled ? "" : "[DRY-RUN] "}would buy ${rewardReceivedRaw.toString()} raw reward tokens for ${amount.toString()} lamports`
  );

  if (!config.buyEnabled) {
    return { baseSpentLamports: amount, rewardReceivedRaw, rewardReceivedUi, txSig: null };
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  tx.sign([treasury]);
  const simulation = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
  if (simulation.value.err) {
    console.error(simulation.value.logs?.join("\n"));
    throw new Error(`Swap simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  const txSig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
  await connection.confirmTransaction(txSig, "confirmed");
  return { baseSpentLamports: amount, rewardReceivedRaw, rewardReceivedUi, txSig };
}
