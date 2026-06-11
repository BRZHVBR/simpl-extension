// src/chains/solana/solana.types.ts
//
// Shared types for the Solana (Ed25519, account-based) adapter. On-chain amounts
// are always integer base units as bigint; the UI only ever sees formatted
// decimal strings.

// Native SOL balance for an address, in lamports.
export type SolanaBalance = {
  raw: bigint;
  formatted: string;
  decimals: 9;
  symbol: "SOL";
};

// A single SPL token balance owned by an address. `mint` is the token mint
// (used as the unified model's `contractAddress`). Symbol/name fall back to a
// shortened mint when metadata is unknown.
export type SolanaTokenBalance = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  rawAmount: bigint;
  formatted: string;
  logoUrl: string | null;
  // True when symbol/name came from the known-token map (vs a mint fallback).
  isVerified: boolean;
};

// A normalized activity entry for the wallet's history UI.
export type SolanaActivityItem = {
  signature: string;
  direction: "incoming" | "outgoing" | "self";
  // Net SOL value to the wallet in lamports (always a positive magnitude).
  amountLamports: bigint;
  feeLamports: bigint | null;
  confirmed: boolean;
  // Unix seconds, or null when the node did not return a block time.
  blockTime: number | null;
  explorerUrl: string;
};

// Result of building + broadcasting a send.
export type SolanaSendResult = {
  signature: string;
};
