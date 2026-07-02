// src/chains/solana/solana.address.ts
//
// Solana address helpers: base58 public-key validation/normalization, display
// shortening, and the BIP-44 Ed25519 derivation path. These are pure,
// PUBLIC-key-only utilities — no secret key material here. Validation uses
// web3.js's PublicKey, which only accepts a 32-byte base58 key, so EVM (0x...),
// Bitcoin (bc1/tb1) and TRON (T...) addresses are all rejected.

import { PublicKey } from "@solana/web3.js";

// True when `address` is a valid Solana base58 public key. Rejects empty input,
// EVM 0x addresses, and any non-32-byte base58 string. PublicKey's constructor
// accepts some inputs (e.g. arrays); we additionally require a non-0x string of
// a plausible base58 length so foreign-chain addresses never slip through.
export function isValidSolanaAddress(address: string): boolean {
  const trimmed = address.trim();

  if (trimmed.length === 0 || trimmed.startsWith("0x")) {
    return false;
  }

  // Base58 alphabet only (no 0, O, I, l) and a length range that matches a
  // 32-byte key (typically 32–44 chars).
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return false;
  }

  try {
    // Throws on a non-32-byte / malformed base58 key.
    const key = new PublicKey(trimmed);
    return key.toBase58() === trimmed;
  } catch {
    return false;
  }
}

// Canonical base58 form of a valid Solana address. Throws on invalid input.
export function normalizeSolanaAddress(address: string): string {
  const trimmed = address.trim();

  if (!isValidSolanaAddress(trimmed)) {
    throw new Error("Invalid Solana address.");
  }

  return new PublicKey(trimmed).toBase58();
}

// Compact display form "Abc1…Wxyz" for space-constrained UI.
export function shortenSolanaAddress(address: string): string {
  const trimmed = address.trim();

  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

// BIP-44 Ed25519 derivation path for Solana (SLIP-0010). The Simpl account
// index maps to the BIP-44 account level; all segments are hardened, as Solana
// (and ed25519-hd-key) require:
//   account 0 → m/44'/501'/0'/0'
//   account n → m/44'/501'/n'/0'
export function getSolanaDerivationPath(accountIndex: number): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("Account index must be a non-negative integer.");
  }

  return `m/44'/501'/${accountIndex}'/0'`;
}
