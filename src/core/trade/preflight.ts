// src/core/trade/preflight.ts
//
// Pre-confirm validation for swap/bridge. Aggregates every safety gate into one
// PreflightResult the UI uses to enable/disable Confirm and to render blocking
// errors + acknowledgeable warnings. Pure — the caller supplies the observed
// context (balances, allowance, quote, etc.); this module decides.

import { evaluatePriceImpact, evaluateSlippage } from "./slippage-policy";
import { isQuoteExpired, type SimplQuote } from "./quote-model";

export type PreflightError = { code: string; message: string };
export type PreflightWarning = { code: string; message: string; requiresAcknowledgement?: boolean };

export type PreflightResult = {
  ok: boolean;
  blockingErrors: PreflightError[];
  warnings: PreflightWarning[];
};

export type PreflightContext = {
  quote: SimplQuote;
  nowMs: number;
  walletUnlocked: boolean;
  watchOnly: boolean;
  riskPassed: boolean; // from risk-policy (backup/etc.)
  onCorrectChain: boolean;
  hasEnoughBalance: boolean;
  hasEnoughGas: boolean;
  allowanceSufficient: boolean; // false → approval required (a warning, not a block)
  slippageAcknowledged?: boolean;
  priceImpactAcknowledged?: boolean;
  // Bridge-only
  destinationAddressValid?: boolean;
  destinationChainSupported?: boolean;
};

export function runPreflight(ctx: PreflightContext): PreflightResult {
  const errors: PreflightError[] = [];
  const warnings: PreflightWarning[] = [];

  if (!ctx.walletUnlocked) errors.push({ code: "WALLET_LOCKED", message: "Unlock your wallet to continue." });
  if (ctx.watchOnly)
    errors.push({ code: "WATCH_ONLY", message: "Watch-only accounts cannot swap or bridge." });
  if (!ctx.riskPassed)
    errors.push({ code: "RISK_BLOCKED", message: "Back up your recovery phrase before trading." });
  if (!ctx.onCorrectChain) errors.push({ code: "WRONG_CHAIN", message: "Switch to the correct network." });
  if (!ctx.hasEnoughBalance) errors.push({ code: "INSUFFICIENT_BALANCE", message: "Insufficient token balance." });
  if (!ctx.hasEnoughGas)
    errors.push({ code: "INSUFFICIENT_GAS", message: "Not enough native balance for the network fee." });

  if (isQuoteExpired(ctx.quote, ctx.nowMs))
    errors.push({ code: "QUOTE_EXPIRED", message: "Quote expired — refresh before confirming." });

  // Slippage.
  const slip = evaluateSlippage(ctx.quote.slippageBps, { acknowledged: ctx.slippageAcknowledged });
  if (!slip.allowed) {
    errors.push({ code: "SLIPPAGE_TOO_HIGH", message: slip.reason ?? "Slippage too high." });
  } else if (slip.requiresAcknowledgement) {
    warnings.push({ code: "HIGH_SLIPPAGE", message: slip.reason ?? "High slippage.", requiresAcknowledgement: true });
  }

  // Price impact.
  const pi = evaluatePriceImpact(ctx.quote.priceImpact);
  if (!pi.allowed) {
    errors.push({ code: "PRICE_IMPACT_TOO_HIGH", message: pi.reason ?? "Price impact too high." });
  } else if (pi.requiresAcknowledgement && !ctx.priceImpactAcknowledged) {
    warnings.push({ code: "HIGH_PRICE_IMPACT", message: pi.reason ?? "High price impact.", requiresAcknowledgement: true });
  }

  // Simulation.
  if (ctx.quote.simulation?.status === "failed")
    errors.push({ code: "SIMULATION_FAILED", message: "This trade is likely to fail and was not sent." });
  else if (ctx.quote.simulation?.status === "unavailable")
    warnings.push({ code: "SIMULATION_UNAVAILABLE", message: "Could not simulate this trade; proceed with caution." });

  // Quote blocking warnings propagate as errors.
  for (const w of ctx.quote.warnings) {
    if (w.level === "blocked") errors.push({ code: w.code, message: w.message });
    else if (w.level === "danger" || w.level === "warning")
      warnings.push({ code: w.code, message: w.message, requiresAcknowledgement: w.level === "danger" });
  }

  // Approval is a required step, surfaced as a warning (not a hard block).
  if (!ctx.allowanceSufficient)
    warnings.push({ code: "ALLOWANCE_REQUIRED", message: "Approve this token before swapping." });

  // Bridge-specific.
  if (ctx.quote.kind === "bridge") {
    if (ctx.destinationAddressValid === false)
      errors.push({ code: "INVALID_DESTINATION_ADDRESS", message: "The destination address is invalid." });
    if (ctx.destinationChainSupported === false)
      errors.push({ code: "UNSUPPORTED_CHAIN", message: "The destination network is not supported." });
  }

  return { ok: errors.length === 0, blockingErrors: errors, warnings };
}
