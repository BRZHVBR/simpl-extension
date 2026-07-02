// src/chains/bitcoin/bitcoin.errors.ts
//
// User-facing, coded errors for the Bitcoin send/balance/activity flows. Each
// error carries a stable `code` (for programmatic checks) and a friendly,
// translatable `message`. We deliberately NEVER echo the raw cause for signing
// failures — it could embed sensitive material.

export type BitcoinErrorCode =
  | "INVALID_BITCOIN_ADDRESS"
  | "NETWORK_MISMATCH"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "FEE_ESTIMATION_FAILED"
  | "UTXO_LOAD_FAILED"
  | "BUILD_TX_FAILED"
  | "SIGNING_FAILED"
  | "BROADCAST_FAILED"
  | "BITCOIN_NETWORK_ERROR"
  | "WATCH_ONLY";

export class BitcoinError extends Error {
  readonly code: BitcoinErrorCode;

  constructor(code: BitcoinErrorCode, message: string) {
    super(message);
    this.name = "BitcoinError";
    this.code = code;
  }
}

export function bitcoinError(
  code: BitcoinErrorCode,
  message: string,
): BitcoinError {
  return new BitcoinError(code, message);
}

// Friendly default message per code, so callers can throw with just a code.
const DEFAULT_MESSAGES: Record<BitcoinErrorCode, string> = {
  INVALID_BITCOIN_ADDRESS: "Enter a valid Bitcoin address.",
  NETWORK_MISMATCH:
    "That address is for a different Bitcoin network. Check mainnet vs testnet.",
  INVALID_AMOUNT: "Enter a valid amount.",
  INSUFFICIENT_BALANCE: "Insufficient BTC balance for this amount plus the network fee.",
  FEE_ESTIMATION_FAILED: "Could not estimate the network fee. Try again.",
  UTXO_LOAD_FAILED: "Could not load your Bitcoin balance. Try again.",
  BUILD_TX_FAILED: "Could not build the transaction.",
  SIGNING_FAILED: "Could not sign the transaction.",
  BROADCAST_FAILED: "Failed to broadcast the transaction. Try again.",
  BITCOIN_NETWORK_ERROR: "Bitcoin network is unavailable. Try again in a moment.",
  WATCH_ONLY: "Watch-only accounts cannot send Bitcoin.",
};

export function bitcoinErrorFor(
  code: BitcoinErrorCode,
  message?: string,
): BitcoinError {
  return new BitcoinError(code, message ?? DEFAULT_MESSAGES[code]);
}

// Map an arbitrary low-level error to a friendly, coded error. Already-coded
// BitcoinErrors pass straight through so a precise code set deeper in the
// build/sign/broadcast path is never re-classified. We only inspect the message
// text — never the structured cause — to avoid leaking signing material.
export function normalizeBitcoinError(
  error: unknown,
  fallback: BitcoinErrorCode = "BITCOIN_NETWORK_ERROR",
): BitcoinError {
  if (error instanceof BitcoinError) {
    return error;
  }

  const text = (error instanceof Error ? error.message : String(error ?? ""))
    .toLowerCase();

  if (
    text.includes("failed to fetch") ||
    text.includes("network error") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("429") ||
    text.includes("rate limit")
  ) {
    return bitcoinErrorFor("BITCOIN_NETWORK_ERROR");
  }

  return bitcoinErrorFor(fallback);
}
