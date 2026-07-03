// src/core/trade/quote-model.ts
//
// Normalized quote model shared across every swap/bridge provider. Providers
// (0x, Pancake, Jupiter, LI.FI, …) are adapted into a single `SimplQuote` so the
// UI reads ONE shape: fee breakdown, price impact, slippage, expiry, route,
// warnings and simulation status. Pure — no chrome/DOM/provider deps. Unknown
// values are represented explicitly ("unavailable"), never fabricated.

export type TradeKind = "swap" | "bridge";
export type TradeProvider = "zeroex" | "pancake" | "jupiter" | "lifi" | "custom";

export type QuoteToken = {
  address?: string;
  symbol: string;
  decimals: number;
  // Base-unit (wei/lamports/etc.) amount as a decimal string.
  amount: string;
};

export type QuoteToTokenOut = QuoteToken & {
  estimatedAmount: string;
  minAmount?: string;
};

export type QuoteFees = {
  networkFee?: string;
  providerFee?: string;
  simplFee?: string;
  totalFeeUsd?: number;
};

export type WarningLevel = "info" | "warning" | "danger" | "blocked";
export type QuoteWarning = { code: string; level: WarningLevel; message: string };

export type RouteStep = {
  provider: TradeProvider;
  action: "swap" | "bridge" | "approve" | "wrap" | "unwrap";
  fromChainId?: number;
  toChainId?: number;
  label?: string;
};

export type SimulationStatus = {
  status: "not_required" | "passed" | "failed" | "unavailable";
  reason?: string;
};

export type SimplQuote = {
  id: string;
  kind: TradeKind;
  provider: TradeProvider;
  fromChainId: number;
  toChainId: number;
  fromToken: QuoteToken;
  toToken: QuoteToTokenOut;
  fees: QuoteFees;
  priceImpact?: number; // percent, e.g. 1.2 = 1.2%
  slippageBps: number;
  // Epoch ms after which the quote must be refreshed before confirming.
  expiresAt: number;
  route?: RouteStep[];
  warnings: QuoteWarning[];
  simulation?: SimulationStatus;
};

export function isQuoteExpired(quote: Pick<SimplQuote, "expiresAt">, nowMs: number): boolean {
  return Number.isFinite(quote.expiresAt) && nowMs >= quote.expiresAt;
}

export function secondsUntilExpiry(quote: Pick<SimplQuote, "expiresAt">, nowMs: number): number {
  return Math.max(0, Math.floor((quote.expiresAt - nowMs) / 1000));
}

// Minimum received in base units, given an estimated out amount + slippage bps.
// Used when a provider does not return minAmount directly.
export function computeMinReceived(estimatedAmount: string, slippageBps: number): string {
  let est: bigint;
  try {
    est = BigInt(estimatedAmount);
  } catch {
    return estimatedAmount;
  }
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
  return ((est * (10_000n - bps)) / 10_000n).toString();
}

// A quote is confirmable only when it is not expired and carries no blocking
// warning. (Full preflight — balance/gas/approval/etc. — lives in preflight.ts.)
export function isQuoteConfirmable(quote: SimplQuote, nowMs: number): boolean {
  if (isQuoteExpired(quote, nowMs)) return false;
  if (quote.warnings.some((w) => w.level === "blocked")) return false;
  if (quote.simulation?.status === "failed") return false;
  return true;
}

// Highest warning level present, for surfacing an overall banner.
export function highestWarningLevel(quote: SimplQuote): WarningLevel | null {
  const order: WarningLevel[] = ["info", "warning", "danger", "blocked"];
  let idx = -1;
  for (const w of quote.warnings) idx = Math.max(idx, order.indexOf(w.level));
  return idx >= 0 ? order[idx] : null;
}
