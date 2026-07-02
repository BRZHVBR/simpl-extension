// src/chains/solana/solana.format.ts
//
// Lamport <-> SOL conversion + generic SPL base-unit helpers. On-chain amounts
// are always integer base units (bigint); the UI only ever sees formatted
// decimal strings. Integer-only math avoids float precision bugs.

import { LAMPORTS_PER_SOL, SOL_DECIMALS } from "./solana.config";
import { solanaErrorFor } from "./solana.errors";

// Parse a user-entered decimal amount into integer base units for `decimals`.
// Throws a coded INVALID_AMOUNT error on a malformed amount, too many decimals,
// or a non-positive value.
export function parseTokenAmount(displayAmount: string, decimals: number): bigint {
  const normalized = displayAmount.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw solanaErrorFor("INVALID_AMOUNT");
  }

  const [whole, fraction = ""] = normalized.split(".");

  if (fraction.length > decimals) {
    throw solanaErrorFor(
      "INVALID_AMOUNT",
      `Amount has too many decimals (max ${decimals}).`,
    );
  }

  const base = 10n ** BigInt(decimals);
  const paddedFraction = fraction.padEnd(decimals, "0");
  const value = BigInt(whole) * base + BigInt(paddedFraction || "0");

  if (value <= 0n) {
    throw solanaErrorFor("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  return value;
}

// Convert integer base units to a decimal string with up to `decimals` places,
// trailing zeros trimmed (but always at least "0").
export function formatTokenAmount(
  raw: bigint | string,
  decimals: number,
): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);

  const whole = abs / base;
  const fraction = abs % base;

  let fractionStr = fraction.toString().padStart(decimals, "0");
  fractionStr = fractionStr.replace(/0+$/, "");

  const body = fractionStr.length > 0 ? `${whole}.${fractionStr}` : `${whole}`;

  return negative ? `-${body}` : body;
}

// Parse a user-entered SOL display amount into integer lamports.
export function solToLamports(displayAmount: string): bigint {
  return parseTokenAmount(displayAmount, SOL_DECIMALS);
}

// Convert integer lamports to a SOL decimal string (up to 9 decimals, trimmed).
export function lamportsToSol(lamports: bigint | string): string {
  return formatTokenAmount(lamports, SOL_DECIMALS);
}

// Format a lamport amount as a "0.0005 SOL"-style string with the symbol.
export function formatSolAmount(
  lamports: bigint | string,
  options: { withSymbol?: boolean } = {},
): string {
  const sol = lamportsToSol(lamports);
  return options.withSymbol === false ? sol : `${sol} SOL`;
}

// Convenience re-export so callers can do exact lamport math without importing
// the config too.
export { LAMPORTS_PER_SOL };
