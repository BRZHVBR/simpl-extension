// scripts/check-trade.ts
//
// Unit smoke for the swap/bridge reliability layer (Stage 6): quote model, fee
// matrix, slippage/price-impact policy, preflight, error taxonomy, statuses.
// Run: npm run check:trade

import {
  isQuoteExpired,
  computeMinReceived,
  isQuoteConfirmable,
  highestWarningLevel,
  type SimplQuote,
} from "../src/core/trade/quote-model";
import {
  getFeePolicy,
  feeIsProductionSafe,
  isSimplFeeBpsValid,
  FEE_MATRIX,
} from "../src/core/trade/fee-policy";
import {
  evaluateSlippage,
  evaluatePriceImpact,
  clampSlippageBps,
  ABSOLUTE_MAX_SLIPPAGE_BPS,
  HARD_MAX_SLIPPAGE_BPS,
} from "../src/core/trade/slippage-policy";
import { runPreflight, type PreflightContext } from "../src/core/trade/preflight";
import { classifyTradeError, normalizeTradeError } from "../src/core/trade/trade-errors";
import { getTradeStatusInfo } from "../src/core/trade/trade-status";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = 1_000_000;

function makeQuote(over: Partial<SimplQuote> = {}): SimplQuote {
  return {
    id: "q1",
    kind: "swap",
    provider: "zeroex",
    fromChainId: 1,
    toChainId: 1,
    fromToken: { symbol: "USDC", decimals: 6, amount: "1000000" },
    toToken: { symbol: "WETH", decimals: 18, estimatedAmount: "500000000000000", amount: "500000000000000" },
    fees: {},
    slippageBps: 50,
    expiresAt: NOW + 30_000,
    warnings: [],
    simulation: { status: "passed" },
    ...over,
  };
}

console.log("START SWAP/BRIDGE RELIABILITY CHECK\n");

// ── Quote model ──────────────────────────────────────────────────────────────
console.log("Quote model:");
check("fresh quote not expired", !isQuoteExpired(makeQuote(), NOW));
check("past-expiry quote is expired", isQuoteExpired(makeQuote({ expiresAt: NOW - 1 }), NOW));
check("minReceived applies slippage", computeMinReceived("1000000", 50) === "995000");
check("confirmable when fresh + passed", isQuoteConfirmable(makeQuote(), NOW));
check("not confirmable when expired", !isQuoteConfirmable(makeQuote({ expiresAt: NOW - 1 }), NOW));
check("not confirmable with blocked warning",
  !isQuoteConfirmable(makeQuote({ warnings: [{ code: "X", level: "blocked", message: "no" }] }), NOW));
check("not confirmable when simulation failed",
  !isQuoteConfirmable(makeQuote({ simulation: { status: "failed" } }), NOW));
check("highest warning level surfaced",
  highestWarningLevel(makeQuote({ warnings: [{ code: "a", level: "info", message: "" }, { code: "b", level: "danger", message: "" }] })) === "danger");

// ── Fee matrix ───────────────────────────────────────────────────────────────
console.log("\nFee enforcement matrix:");
check("0x swap fee is provider_enforced", getFeePolicy("zeroex", "swap")?.enforcement === "provider_enforced");
check("LI.FI fee is backend_authoritative (NOT client)", getFeePolicy("lifi", "bridge")?.enforcement === "backend_authoritative");
check("Jupiter fee is backend_authoritative", getFeePolicy("jupiter", "swap")?.enforcement === "backend_authoritative");
check("Pancake fee is unsupported (not a monetized route)", getFeePolicy("pancake", "swap")?.enforcement === "unsupported");
check("0x fee is production-safe", feeIsProductionSafe(getFeePolicy("zeroex", "swap")!));
check("LI.FI fee is production-safe", feeIsProductionSafe(getFeePolicy("lifi", "bridge")!));
check("Pancake fee is NOT production-safe", !feeIsProductionSafe(getFeePolicy("pancake", "swap")!));
check("every fee policy requiring production is proxy/provider enforced",
  FEE_MATRIX.filter((p) => p.allowProduction && p.enforcement !== "unsupported")
    .every((p) => p.enforcement === "provider_enforced" || p.enforcement === "backend_authoritative"));
check("fee bps bounds: 50 valid, 5000 invalid", isSimplFeeBpsValid(50) && !isSimplFeeBpsValid(5000));

// ── Slippage / price impact ─────────────────────────────────────────────────
console.log("\nSlippage / price impact:");
check("default slippage → info", evaluateSlippage(50).level === "info");
check("elevated slippage → warning", evaluateSlippage(200).level === "warning");
check("high slippage → danger + requires ack", (() => { const d = evaluateSlippage(800); return d.level === "danger" && d.requiresAcknowledgement === true && !d.allowed; })());
check("high slippage allowed WITH ack", evaluateSlippage(800, { acknowledged: true }).allowed);
check("absurd slippage (50%) → blocked", !evaluateSlippage(5000).allowed && evaluateSlippage(5000).level === "blocked");
check("clamp never exceeds absolute max", clampSlippageBps(5000) === ABSOLUTE_MAX_SLIPPAGE_BPS);
check("clamp floors at ≥1", clampSlippageBps(0) === 1);
check("HARD_MAX < ABSOLUTE_MAX", HARD_MAX_SLIPPAGE_BPS < ABSOLUTE_MAX_SLIPPAGE_BPS);
check("price impact 0.5% → info", evaluatePriceImpact(0.5).level === "info");
check("price impact 2% → warning", evaluatePriceImpact(2).level === "warning");
check("price impact 7% → danger + ack", evaluatePriceImpact(7).requiresAcknowledgement === true);
check("price impact 20% → blocked", !evaluatePriceImpact(20).allowed);
check("unknown price impact → not blocked, unavailable", evaluatePriceImpact(undefined).allowed);

// ── Preflight ────────────────────────────────────────────────────────────────
console.log("\nPreflight:");
const okCtx: PreflightContext = {
  quote: makeQuote(),
  nowMs: NOW,
  walletUnlocked: true,
  watchOnly: false,
  riskPassed: true,
  onCorrectChain: true,
  hasEnoughBalance: true,
  hasEnoughGas: true,
  allowanceSufficient: true,
};
check("clean context passes preflight", runPreflight(okCtx).ok);
check("watch-only blocks", !runPreflight({ ...okCtx, watchOnly: true }).ok);
check("locked blocks", !runPreflight({ ...okCtx, walletUnlocked: false }).ok);
check("risk-not-passed blocks", !runPreflight({ ...okCtx, riskPassed: false }).ok);
check("insufficient gas blocks", !runPreflight({ ...okCtx, hasEnoughGas: false }).ok);
check("expired quote blocks", !runPreflight({ ...okCtx, quote: makeQuote({ expiresAt: NOW - 1 }) }).ok);
check("simulation failed blocks", !runPreflight({ ...okCtx, quote: makeQuote({ simulation: { status: "failed" } }) }).ok);
check("extreme price impact blocks", !runPreflight({ ...okCtx, quote: makeQuote({ priceImpact: 20 }) }).ok);
check("approval-required is a warning, not a block",
  (() => { const r = runPreflight({ ...okCtx, allowanceSufficient: false }); return r.ok && r.warnings.some((w) => w.code === "ALLOWANCE_REQUIRED"); })());
check("bridge invalid destination blocks",
  !runPreflight({ ...okCtx, quote: makeQuote({ kind: "bridge", toChainId: 8453 }), destinationAddressValid: false }).ok);

// ── Error taxonomy ────────────────────────────────────────────────────────────
console.log("\nError taxonomy:");
check("insufficient funds → INSUFFICIENT_BALANCE", classifyTradeError("insufficient funds for transfer") === "INSUFFICIENT_BALANCE");
check("user rejected → TX_REJECTED", classifyTradeError(new Error("User rejected the request")) === "TX_REJECTED");
check("blockhash expired → QUOTE_EXPIRED", classifyTradeError("Blockhash not found") === "QUOTE_EXPIRED");
check("no route → ROUTE_UNAVAILABLE", classifyTradeError("No route found") === "ROUTE_UNAVAILABLE");
check("429 → PROVIDER_RATE_LIMITED", classifyTradeError("HTTP 429 too many requests") === "PROVIDER_RATE_LIMITED");
check("unknown → UNKNOWN_ERROR", classifyTradeError("weird gibberish xyz") === "UNKNOWN_ERROR");
const norm = normalizeTradeError(new Error("execution reverted: 0xdeadbeef secret payload"));
check("normalized message never leaks the raw payload",
  !norm.message.includes("0xdeadbeef") && !norm.technical.includes("0xdeadbeef"));
check("normalized error has a retry strategy", typeof norm.retry === "string");

// ── Statuses ──────────────────────────────────────────────────────────────────
console.log("\nStatuses:");
check("quote_expired can retry", getTradeStatusInfo("quote_expired").canRetry);
check("transaction_confirmed is terminal", getTradeStatusInfo("transaction_confirmed").terminal);
check("bridge_waiting_destination is non-terminal", !getTradeStatusInfo("bridge_waiting_destination").terminal);

console.log("");
if (failures > 0) {
  console.log(`SWAP/BRIDGE RELIABILITY CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("SWAP/BRIDGE RELIABILITY CHECK PASSED");
