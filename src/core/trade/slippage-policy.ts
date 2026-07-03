// src/core/trade/slippage-policy.ts
//
// Slippage + price-impact policy, shared by all swap/bridge flows. Pure.
// Providers/UI use these constants + helpers instead of ad-hoc clamps so a
// single place defines "how much slippage / price impact is safe".

export const DEFAULT_STABLE_SLIPPAGE_BPS = 10; // 0.1% — stable⇄stable
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% — standard
export const DEFAULT_VOLATILE_SLIPPAGE_BPS = 100; // 1% — volatile pairs

// Normal swaps may not exceed this without an explicit danger acknowledgement.
export const HARD_MAX_SLIPPAGE_BPS = 500; // 5%
// Absolute ceiling even WITH acknowledgement (a 50% clamp is never acceptable).
export const ABSOLUTE_MAX_SLIPPAGE_BPS = 1500; // 15%

export type SlippageLevel = "info" | "warning" | "danger" | "blocked";

export type SlippageDecision = {
  allowed: boolean;
  level: SlippageLevel;
  effectiveSlippageBps: number;
  reason?: string;
  requiresAcknowledgement?: boolean;
};

// Clamp a requested slippage into the safe range and classify it. Never returns
// an effective value above ABSOLUTE_MAX_SLIPPAGE_BPS.
export function evaluateSlippage(
  requestedBps: number,
  opts?: { acknowledged?: boolean },
): SlippageDecision {
  const acknowledged = opts?.acknowledged === true;

  if (!Number.isFinite(requestedBps) || requestedBps < 0) {
    return {
      allowed: true,
      level: "info",
      effectiveSlippageBps: DEFAULT_SLIPPAGE_BPS,
      reason: "Using the default slippage.",
    };
  }

  const bps = Math.trunc(requestedBps);

  if (bps > ABSOLUTE_MAX_SLIPPAGE_BPS) {
    return {
      allowed: false,
      level: "blocked",
      effectiveSlippageBps: ABSOLUTE_MAX_SLIPPAGE_BPS,
      reason: `Slippage above ${ABSOLUTE_MAX_SLIPPAGE_BPS / 100}% is not allowed.`,
    };
  }

  if (bps > HARD_MAX_SLIPPAGE_BPS) {
    return {
      allowed: acknowledged,
      level: "danger",
      effectiveSlippageBps: bps,
      reason: `High slippage (${(bps / 100).toFixed(2)}%) — you may lose value to price movement or MEV.`,
      requiresAcknowledgement: !acknowledged,
    };
  }

  if (bps > DEFAULT_VOLATILE_SLIPPAGE_BPS) {
    return {
      allowed: true,
      level: "warning",
      effectiveSlippageBps: bps,
      reason: `Elevated slippage (${(bps / 100).toFixed(2)}%).`,
    };
  }

  return { allowed: true, level: "info", effectiveSlippageBps: bps };
}

// Clamp used by provider adapters (e.g. Pancake) — always within the absolute
// ceiling, never the historical 50%.
export function clampSlippageBps(requestedBps: number | undefined): number {
  if (!Number.isFinite(requestedBps)) return DEFAULT_SLIPPAGE_BPS;
  return Math.min(ABSOLUTE_MAX_SLIPPAGE_BPS, Math.max(1, Math.trunc(requestedBps ?? DEFAULT_SLIPPAGE_BPS)));
}

// ── Price impact ─────────────────────────────────────────────────────────────

export const PRICE_IMPACT_WARN_PCT = 1; // ≥1% → warning
export const PRICE_IMPACT_DANGER_PCT = 5; // ≥5% → danger (ack)
export const PRICE_IMPACT_BLOCK_PCT = 15; // ≥15% → blocked

export type PriceImpactDecision = {
  allowed: boolean;
  level: SlippageLevel;
  reason?: string;
  requiresAcknowledgement?: boolean;
};

export function evaluatePriceImpact(impactPct: number | undefined): PriceImpactDecision {
  if (impactPct === undefined || !Number.isFinite(impactPct)) {
    // Unknown impact is not a hard block, but the UI should surface "unavailable".
    return { allowed: true, level: "info", reason: "Price impact unavailable." };
  }
  const p = Math.abs(impactPct);
  if (p >= PRICE_IMPACT_BLOCK_PCT) {
    return { allowed: false, level: "blocked", reason: `Extreme price impact (${p.toFixed(2)}%).` };
  }
  if (p >= PRICE_IMPACT_DANGER_PCT) {
    return {
      allowed: true,
      level: "danger",
      reason: `High price impact (${p.toFixed(2)}%).`,
      requiresAcknowledgement: true,
    };
  }
  if (p >= PRICE_IMPACT_WARN_PCT) {
    return { allowed: true, level: "warning", reason: `Price impact ${p.toFixed(2)}%.` };
  }
  return { allowed: true, level: "info" };
}
