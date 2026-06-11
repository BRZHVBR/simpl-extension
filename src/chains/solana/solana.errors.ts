// src/chains/solana/solana.errors.ts
//
// User-facing, coded errors for the Solana send/balance/activity flows. Each
// error carries a stable `code` (for programmatic checks) and a friendly,
// translatable `message`. We deliberately NEVER echo the raw cause for signing
// failures — it could embed sensitive material (secret key bytes).

export type SolanaErrorCode =
  | "INVALID_SOLANA_ADDRESS"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_SOL_FOR_FEE"
  | "BUILD_TX_FAILED"
  | "SIGNING_FAILED"
  | "BROADCAST_FAILED"
  | "SOLANA_NETWORK_ERROR"
  | "WATCH_ONLY"
  | "SOLANA_UNSUPPORTED_ACCOUNT"
  | "SPL_SEND_UNSUPPORTED";

export class SolanaError extends Error {
  readonly code: SolanaErrorCode;

  constructor(code: SolanaErrorCode, message: string) {
    super(message);
    this.name = "SolanaError";
    this.code = code;
  }
}

export function solanaError(
  code: SolanaErrorCode,
  message: string,
): SolanaError {
  return new SolanaError(code, message);
}

// Friendly default message per code, so callers can throw with just a code.
const DEFAULT_MESSAGES: Record<SolanaErrorCode, string> = {
  INVALID_SOLANA_ADDRESS: "Enter a valid Solana address.",
  INVALID_AMOUNT: "Enter a valid amount.",
  INSUFFICIENT_BALANCE: "Insufficient SOL balance for this amount plus the network fee.",
  INSUFFICIENT_SOL_FOR_FEE: "You need a little SOL to cover the network fee.",
  BUILD_TX_FAILED: "Could not build the transaction.",
  SIGNING_FAILED: "Could not sign the transaction.",
  BROADCAST_FAILED: "Failed to broadcast the transaction. Try again.",
  SOLANA_NETWORK_ERROR: "Solana RPC is unavailable. Try again later.",
  WATCH_ONLY: "Watch-only accounts cannot send Solana transactions.",
  SOLANA_UNSUPPORTED_ACCOUNT:
    "This account type does not support Solana. Use a recovery-phrase account.",
  SPL_SEND_UNSUPPORTED: "Sending SPL tokens is coming soon.",
};

export function solanaErrorFor(
  code: SolanaErrorCode,
  message?: string,
): SolanaError {
  return new SolanaError(code, message ?? DEFAULT_MESSAGES[code]);
}

// Map an arbitrary low-level error to a friendly, coded error. Already-coded
// SolanaErrors pass straight through so a precise code set deeper in the
// build/sign/broadcast path is never re-classified. We only inspect the message
// text — never the structured cause — to avoid leaking signing material.
export function normalizeSolanaError(
  error: unknown,
  fallback: SolanaErrorCode = "SOLANA_NETWORK_ERROR",
): SolanaError {
  if (error instanceof SolanaError) {
    return error;
  }

  const text = (error instanceof Error ? error.message : String(error ?? ""))
    .toLowerCase();

  if (
    text.includes("failed to fetch") ||
    text.includes("network error") ||
    text.includes("timeout") ||
    text.includes("econn") ||
    text.includes("403") ||
    text.includes("forbidden") ||
    text.includes("access forbidden") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    return solanaErrorFor("SOLANA_NETWORK_ERROR");
  }

  return solanaErrorFor(fallback);
}
