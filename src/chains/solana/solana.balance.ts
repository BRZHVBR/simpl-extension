// src/chains/solana/solana.balance.ts
//
// Read-only native SOL balance loading. Values are integer lamports (bigint);
// formatting to a display string happens in solana.format.ts / the adapter.
// RPC access goes through the fallback runner (solana.rpc) so a 403/429 on one
// endpoint rotates to the next instead of failing the balance refresh.

import { PublicKey } from "@solana/web3.js";
import type { SolanaChainConfig } from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import { lamportsToSol } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { withSolanaRead } from "./solana.rpc";
import type { SolanaBalance } from "./solana.types";

// Native SOL balance (lamports) for an address. Validates the address locally
// first, then reads across the config's endpoints with fallback. A failure of
// every endpoint surfaces as a normalized SolanaError (network).
export async function getSolBalance(
  address: string,
  config: SolanaChainConfig,
): Promise<SolanaBalance> {
  if (!isValidSolanaAddress(address)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const owner = new PublicKey(address);
  const lamports = await withSolanaRead(config, (connection) =>
    connection.getBalance(owner),
  );
  const raw = BigInt(lamports);

  return {
    raw,
    formatted: lamportsToSol(raw),
    decimals: 9,
    symbol: "SOL",
  };
}

// Native SOL balance in lamports only (no formatting).
export async function getSolBalanceLamports(
  address: string,
  config: SolanaChainConfig,
): Promise<bigint> {
  return (await getSolBalance(address, config)).raw;
}
