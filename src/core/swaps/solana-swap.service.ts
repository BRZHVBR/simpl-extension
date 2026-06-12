// src/core/swaps/solana-swap.service.ts
//
// Client for the Simpl API Solana swap endpoints (Jupiter-backed, server-side).
// The extension NEVER talks to Jupiter directly — it only calls Simpl API:
//   POST /v1/solana/swap/order    → build an unsigned swap transaction + quote
//   POST /v1/solana/swap/execute  → broadcast the locally-signed transaction
//
// SECURITY: only public data crosses this boundary. The unsigned transaction is
// signed locally (wallet.service → solana.swap) and only the *signed* base64
// transaction + the order's requestId are sent to /execute. No private key,
// mnemonic or password is ever sent. Base58 mints/addresses are passed verbatim
// (case-sensitive — never lowercased).

// Resolve the Simpl API gateway base URL, mirroring simpl-market-api.service so
// the whole extension shares one base URL convention. No direct Jupiter URL is
// ever used here.
function resolveApiBaseUrl(): string {
  const candidate =
    (import.meta.env.VITE_SIMPL_API_URL as string | undefined) ??
    (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL as string | undefined) ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();
const DEFAULT_TIMEOUT_MS = 20_000;

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Try to read a JSON error body even on non-2xx so the gateway/Jupiter
    // message can be surfaced; fall back to the status text.
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === "object" && "error" in parsed
          ? String((parsed as { error?: unknown }).error ?? "")
          : "") || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

// Native SOL is swapped as wrapped SOL (wSOL) — the canonical mint Jupiter and
// the Simpl backend expect for the SOL side of a route.
export const SOL_WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type SolanaSwapOrder = {
  // Base64 unsigned VersionedTransaction to deserialize + sign locally.
  transaction: string | null;
  // Opaque id echoed back to /execute so the backend can correlate the order.
  requestId: string | null;
  inputMint?: string;
  outputMint?: string;
  // Base-unit amounts (strings) for the resolved route.
  inAmount?: string | null;
  outAmount?: string | null;
  // Jupiter price impact (fraction string, e.g. "0.0012" = 0.12%).
  priceImpactPct?: number | string | null;
  priceImpact?: number | string | null;
  routePlan?: unknown;
  // Fee transparency. simplFeeApplied=false is NOT an error and must not block.
  simplFeeApplied?: boolean;
  requestedFeeBps?: number | null;
  actualFeeBps?: number | null;
  error?: string | null;
};

export type SolanaSwapExecuteResult = {
  // Transaction signature on success (various field names tolerated).
  signature?: string | null;
  txid?: string | null;
  status?: string | null;
  error?: string | null;
};

// Normalize backend/Jupiter error text into the user-facing copy required by the
// product spec. The Simpl gateway surfaces Jupiter/provider failures in a few
// shapes — a "Provider error" body, a bare 5xx status line ("502 Bad Gateway"),
// or a route-specific message — and we must never leak a raw "Provider error" to
// the user. Unknown, already-human-readable messages still pass through so we
// don't hide a useful reason behind a generic string.
function normalizeSwapError(message: string): string {
  const text = message.toLowerCase();

  // Route/token-specific: Jupiter found no viable route for this pair/amount.
  if (
    text.includes("no route") ||
    text.includes("could not find any route") ||
    text.includes("route not found") ||
    text.includes("no routes")
  ) {
    return "No route found for this swap.";
  }

  if (text.includes("insufficient")) {
    return "Insufficient balance.";
  }

  // Provider / upstream gateway failure (the TROLL / low-liquidity case): the
  // 502 from /order arrives either as a "Provider error" body or a bare status
  // line. Map both to actionable copy instead of a raw error.
  if (
    text.includes("provider error") ||
    text.includes("bad gateway") ||
    text.includes("gateway timeout") ||
    text.includes("service unavailable") ||
    text.includes("upstream") ||
    /\b50[234]\b/u.test(text)
  ) {
    return "No route found or provider unavailable. Try a smaller amount or another token.";
  }

  // Network / timeout (aborted fetch, dropped connection): retryable.
  if (
    text.includes("abort") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("network") ||
    text.includes("failed to fetch") ||
    text.includes("load failed")
  ) {
    return "Could not prepare this swap. Try again.";
  }

  if (!message.trim()) {
    return "Could not prepare this swap. Try again.";
  }
  return message;
}

// POST /v1/solana/swap/order — build a swap order (unsigned transaction + quote)
// for inputMint → outputMint at `amount` base units for `userPublicKey`.
export async function createSolanaSwapOrder(params: {
  inputMint: string;
  outputMint: string;
  amount: string; // base units (string)
  userPublicKey: string; // base58, verbatim
  slippageBps: number;
}): Promise<SolanaSwapOrder> {
  let order: SolanaSwapOrder;
  try {
    order = await postJson<SolanaSwapOrder>("/v1/solana/swap/order", {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      // Backend contract names the wallet address field `taker`. The internal
      // param stays `userPublicKey`; only the wire field is mapped here. Base58
      // address is passed verbatim (never lowercased).
      taker: params.userPublicKey,
      slippageBps: params.slippageBps,
    });
  } catch (error) {
    throw new Error(
      normalizeSwapError(error instanceof Error ? error.message : String(error)),
    );
  }

  if (order?.error) {
    throw new Error(normalizeSwapError(order.error));
  }
  return order;
}

// POST /v1/solana/swap/execute — broadcast the locally-signed transaction. Only
// the signed base64 transaction + the order's requestId are sent.
export async function executeSolanaSwap(params: {
  signedTransaction: string;
  requestId: string;
}): Promise<SolanaSwapExecuteResult> {
  let result: SolanaSwapExecuteResult;
  try {
    result = await postJson<SolanaSwapExecuteResult>(
      "/v1/solana/swap/execute",
      {
        signedTransaction: params.signedTransaction,
        requestId: params.requestId,
      },
    );
  } catch (error) {
    throw new Error(
      normalizeSwapError(error instanceof Error ? error.message : String(error)),
    );
  }

  if (result?.error) {
    throw new Error(normalizeSwapError(result.error));
  }
  return result;
}

// The signature from an execute response, tolerating `signature` / `txid`.
export function getExecuteSignature(
  result: SolanaSwapExecuteResult,
): string | null {
  const sig = result.signature ?? result.txid ?? null;
  return typeof sig === "string" && sig.length > 0 ? sig : null;
}
