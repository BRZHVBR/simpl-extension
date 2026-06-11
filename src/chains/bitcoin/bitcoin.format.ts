// src/chains/bitcoin/bitcoin.format.ts
//
// Satoshi <-> BTC conversion + display helpers. On-chain amounts are always
// integer satoshis (bigint). The UI only ever sees formatted decimal strings.
// Integer-only math avoids float precision bugs.

import { BTC_DECIMALS, SATS_PER_BTC } from "./bitcoin.config";
import { bitcoinErrorFor } from "./bitcoin.errors";

// Parse a user-entered BTC display amount into integer satoshis. Throws a coded
// INVALID_AMOUNT error on a malformed amount, more than 8 decimals, or a
// non-positive value.
export function btcToSats(displayAmount: string): bigint {
  const normalized = displayAmount.trim().replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw bitcoinErrorFor("INVALID_AMOUNT");
  }

  const [whole, fraction = ""] = normalized.split(".");

  if (fraction.length > BTC_DECIMALS) {
    throw bitcoinErrorFor(
      "INVALID_AMOUNT",
      `Amount has too many decimals (max ${BTC_DECIMALS}).`,
    );
  }

  const paddedFraction = fraction.padEnd(BTC_DECIMALS, "0");
  const sats = BigInt(whole) * SATS_PER_BTC + BigInt(paddedFraction || "0");

  if (sats <= 0n) {
    throw bitcoinErrorFor("INVALID_AMOUNT", "Amount must be greater than zero.");
  }

  return sats;
}

// Convert integer satoshis to a BTC decimal string with up to 8 decimals,
// trailing zeros trimmed (but always at least "0").
export function satsToBtc(sats: bigint | string): string {
  const value = BigInt(sats);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = abs / SATS_PER_BTC;
  const fraction = abs % SATS_PER_BTC;

  let fractionStr = fraction.toString().padStart(BTC_DECIMALS, "0");
  fractionStr = fractionStr.replace(/0+$/, "");

  const body = fractionStr.length > 0 ? `${whole}.${fractionStr}` : `${whole}`;

  return negative ? `-${body}` : body;
}

// Format a satoshi amount as a "0.00012300 BTC"-style string with the symbol.
// Keeps full 8-decimal precision for amounts under 1 BTC; trims otherwise.
export function formatBtcAmount(
  sats: bigint | string,
  options: { withSymbol?: boolean } = {},
): string {
  const btc = satsToBtc(sats);
  return options.withSymbol === false ? btc : `${btc} BTC`;
}
