import { Connection } from "@solana/web3.js";
import { config } from "./config.js";

export const connection = new Connection(config.heliusRpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60_000
});
